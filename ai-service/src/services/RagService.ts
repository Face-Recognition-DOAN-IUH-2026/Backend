import { createHash, randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { getCollection } from '../clients/chromadb';
import { chunkText } from '../rag/embedder';

export interface RAGDocumentSummary {
  source: string;
  docTitle: string;
  audience: 'public' | 'staff_only';
  chunksCount: number;
  uploadedAt?: string;
  fileSize?: string;
  roles?: string;
}

export interface StoredUploadedDoc extends RAGDocumentSummary {
  rawText: string;
  chunks: string[];
  targetRoles: Array<'patron' | 'staff' | 'admin'>;
}

function resolveAiServiceRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const UPLOADED_KB_DIR = path.join(resolveAiServiceRoot(), 'data', 'uploaded-kb');

function docStorageFilePath(source: string): string {
  const hash = createHash('sha256').update(source).digest('hex').slice(0, 24);
  return path.join(UPLOADED_KB_DIR, `${hash}.json`);
}

function decodeXmlEntities(xmlText: string): string {
  return xmlText
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)));
}

function extractEntryFromZip(buffer: Buffer, targetFileName: string): Buffer | null {
  // 1. Parse Central Directory via End of Central Directory record (handles streaming data descriptors too)
  const minEocdOffset = Math.max(0, buffer.length - 65557);
  for (let i = buffer.length - 22; i >= minEocdOffset; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      const totalEntries = buffer.readUInt16LE(i + 10);
      const cdOffset = buffer.readUInt32LE(i + 16);
      let cursor = cdOffset;

      for (let entryIdx = 0; entryIdx < totalEntries && cursor + 46 <= buffer.length; entryIdx++) {
        if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
        const compressionMethod = buffer.readUInt16LE(cursor + 10);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const fileNameLen = buffer.readUInt16LE(cursor + 28);
        const extraLen = buffer.readUInt16LE(cursor + 30);
        const commentLen = buffer.readUInt16LE(cursor + 32);
        const localHeaderOffset = buffer.readUInt32LE(cursor + 42);

        const nameStart = cursor + 46;
        const entryName = buffer.toString('utf-8', nameStart, nameStart + fileNameLen);
        cursor = nameStart + fileNameLen + extraLen + commentLen;

        if (entryName !== targetFileName) continue;
        if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
          continue;
        }
        const localNameLen = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
        const compressedSlice = buffer.subarray(dataStart, dataStart + compressedSize);

        if (compressionMethod === 0) return compressedSlice;
        if (compressionMethod === 8) return zlib.inflateRawSync(compressedSlice);
        throw new Error(`Unsupported ZIP compression method (${compressionMethod}) for ${targetFileName}`);
      }
    }
  }

  // 2. Fallback: scan local file headers sequentially
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const entryName = buffer.toString('utf-8', nameStart, nameStart + fileNameLen);
    const dataStart = nameStart + fileNameLen + extraLen;

    if (entryName === targetFileName && compressedSize > 0 && dataStart + compressedSize <= buffer.length) {
      const compressedSlice = buffer.subarray(dataStart, dataStart + compressedSize);
      if (compressionMethod === 0) return compressedSlice;
      if (compressionMethod === 8) return zlib.inflateRawSync(compressedSlice);
    }

    if (compressedSize === 0) break;
    offset = dataStart + compressedSize;
  }

  return null;
}

export function extractDocxText(buffer: Buffer): string {
  const xmlBuffer = extractEntryFromZip(buffer, 'word/document.xml');
  if (!xmlBuffer) {
    throw new Error('Không tìm thấy nội dung word/document.xml bên trong tệp DOCX.');
  }

  const xml = xmlBuffer.toString('utf-8');
  const withBreaks = xml
    .replace(/<w:br[^>]*\/?>/gi, '\n')
    .replace(/<w:cr[^>]*\/?>/gi, '\n')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<\/w:tr>/gi, '\n')
    .replace(/<w:tab[^>]*\/?>/gi, ' ')
    .replace(/<\/w:tc>/gi, ' ')
    .replace(/<[^>]+>/g, '');

  return decodeXmlEntities(withBreaks)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hasControlBinaryGarbage(text: string): boolean {
  if (!text) return false;
  if (text.includes('\x00')) return true;
  let controlCount = 0;
  const sampleLen = Math.min(text.length, 4096);
  for (let i = 0; i < sampleLen; i++) {
    const code = text.charCodeAt(i);
    if ((code >= 0 && code <= 8) || (code >= 14 && code <= 31)) {
      controlCount++;
    }
  }
  return controlCount > Math.max(5, sampleLen * 0.02);
}

export class RagService {
  private uploadedCache = new Map<string, StoredUploadedDoc>();
  private cacheLoadedFromDisk = false;

  private loadPersistedDocs(): StoredUploadedDoc[] {
    if (!this.cacheLoadedFromDisk) {
      this.cacheLoadedFromDisk = true;
      try {
        if (fs.existsSync(UPLOADED_KB_DIR)) {
          const files = fs.readdirSync(UPLOADED_KB_DIR).filter(f => f.endsWith('.json'));
          for (const file of files) {
            try {
              const raw = fs.readFileSync(path.join(UPLOADED_KB_DIR, file), 'utf-8');
              const parsed = JSON.parse(raw) as StoredUploadedDoc;
              if (parsed?.source && Array.isArray(parsed.chunks) && !this.uploadedCache.has(parsed.source)) {
                this.uploadedCache.set(parsed.source, parsed);
              }
            } catch (err: any) {
              console.warn(`[RagService] Failed to read persisted KB doc ${file}:`, err.message);
            }
          }
        }
      } catch (err: any) {
        console.warn('[RagService] Could not scan persisted KB directory:', err.message);
      }
    }
    return Array.from(this.uploadedCache.values());
  }

  private persistUploadedDoc(doc: StoredUploadedDoc): void {
    this.uploadedCache.set(doc.source, doc);
    try {
      fs.mkdirSync(UPLOADED_KB_DIR, { recursive: true });
      fs.writeFileSync(docStorageFilePath(doc.source), JSON.stringify(doc, null, 2), 'utf-8');
    } catch (err: any) {
      console.warn(`[RagService] Could not persist KB doc "${doc.source}" to disk:`, err.message);
    }
  }

  private removePersistedDoc(source: string): void {
    this.uploadedCache.delete(source);
    try {
      const filePath = docStorageFilePath(source);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err: any) {
      console.warn(`[RagService] Could not remove persisted KB doc "${source}":`, err.message);
    }
  }

  getUploadedDocs(): StoredUploadedDoc[] {
    return this.loadPersistedDocs();
  }

  async extractText(file: { originalname: string; buffer: Buffer; mimetype?: string }): Promise<string> {
    const ext = path.extname(file.originalname).toLowerCase();
    const isPdfMagic = file.buffer.length >= 5 && file.buffer.subarray(0, 5).toString('ascii') === '%PDF-';
    const isZipMagic =
      file.buffer.length >= 4 &&
      file.buffer[0] === 0x50 &&
      file.buffer[1] === 0x4b &&
      file.buffer[2] === 0x03 &&
      file.buffer[3] === 0x04;
    const isOle2Magic =
      file.buffer.length >= 4 &&
      file.buffer[0] === 0xd0 &&
      file.buffer[1] === 0xcf &&
      file.buffer[2] === 0x11 &&
      file.buffer[3] === 0xe0;

    const isPdf = ext === '.pdf' || file.mimetype === 'application/pdf' || isPdfMagic;
    const isDocx =
      ext === '.docx' ||
      file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      isZipMagic;
    const isLegacyDoc = ext === '.doc' || file.mimetype === 'application/msword' || isOle2Magic;

    if (isPdf) {
      try {
        const pdfPkg = require('pdf-parse');
        let extracted = '';
        if (typeof pdfPkg === 'function') {
          const parsed = await pdfPkg(file.buffer);
          extracted = (parsed.text || '').trim();
        } else if (pdfPkg.PDFParse) {
          const parser = new pdfPkg.PDFParse({ data: file.buffer });
          const textResult = await parser.getText();
          extracted = (typeof textResult === 'string' ? textResult : (textResult?.text || '')).trim();
        }
        if (extracted.length >= 5 && !hasControlBinaryGarbage(extracted)) {
          return extracted;
        }
      } catch (err: any) {
        console.warn('[RagService] PDF extraction error:', err.message);
      }
      throw new Error('Không thể trích xuất văn bản từ tệp PDF (tệp trống, bị hỏng hoặc là bản scan ảnh).');
    }

    if (isDocx) {
      try {
        const extracted = extractDocxText(file.buffer);
        if (extracted.length >= 5 && !hasControlBinaryGarbage(extracted)) {
          return extracted;
        }
      } catch (err: any) {
        console.warn('[RagService] DOCX extraction error:', err.message);
      }
      throw new Error('Không thể trích xuất nội dung văn bản từ tệp DOCX.');
    }

    if (isLegacyDoc) {
      throw new Error(
        'Định dạng .doc nhị phân cũ chưa được hỗ trợ trích xuất trực tiếp. Vui lòng chuyển sang .docx, .pdf, .txt hoặc .md.',
      );
    }

    const decoded = file.buffer.toString('utf-8').replace(/^\uFEFF/, '').trim();
    if (hasControlBinaryGarbage(decoded)) {
      throw new Error('Tệp tải lên chứa dữ liệu nhị phân không hợp lệ.');
    }
    return decoded;
  }

  private async deleteDocumentFromChroma(source: string): Promise<void> {
    const roles: Array<'patron' | 'staff' | 'admin'> = ['patron', 'staff', 'admin'];

    for (const role of roles) {
      try {
        const collection = await getCollection(role);
        const existing = await collection.get({
          where: { source: { $eq: source } } as any,
        });

        if (existing.ids && existing.ids.length > 0) {
          await collection.delete({ ids: existing.ids });
        } else {
          const fallback = await collection.get({
            where: { source } as any,
          });
          if (fallback.ids && fallback.ids.length > 0) {
            await collection.delete({ ids: fallback.ids });
          }
        }
      } catch (err: any) {
        console.warn(`[RagService] Could not delete "${source}" from ${role} collection:`, err.message);
      }
    }
  }

  async uploadDocument(
    file: { originalname: string; buffer: Buffer; mimetype?: string; size: number },
    audience: 'public' | 'staff_only' = 'public',
  ): Promise<RAGDocumentSummary> {
    const rawText = await this.extractText(file);
    if (!rawText || rawText.length < 5) {
      throw new Error('Tài liệu không chứa nội dung văn bản hợp lệ hoặc không thể trích xuất.');
    }

    const docTitle = path.basename(file.originalname, path.extname(file.originalname));
    const rawChunks = chunkText(rawText);
    if (rawChunks.length === 0) {
      throw new Error('Không thể phân đoạn văn bản từ tài liệu.');
    }

    const titleLower = docTitle.toLowerCase();
    const contextualizedChunks = rawChunks.map(chunk =>
      chunk.toLowerCase().includes(titleLower) ? chunk : `[${docTitle}] ${chunk}`,
    );

    const targetRoles: Array<'patron' | 'staff' | 'admin'> =
      audience === 'public' ? ['patron', 'staff', 'admin'] : ['staff', 'admin'];

    const uploadedAt = new Date().toISOString();
    const fileSizeStr = `${(file.size / 1024).toFixed(1)} KB`;
    const rolesStr = targetRoles.join(', ');

    // Remove previous chunks of the same document before indexing updated content
    await this.deleteDocumentFromChroma(file.originalname);

    const storedDoc: StoredUploadedDoc = {
      source: file.originalname,
      docTitle,
      audience,
      chunksCount: contextualizedChunks.length,
      uploadedAt,
      fileSize: fileSizeStr,
      roles: rolesStr,
      rawText,
      chunks: contextualizedChunks,
      targetRoles,
    };
    this.persistUploadedDoc(storedDoc);

    // Always index into ChromaDB using the collection's unified 384-dim hashEmbeddingFn
    for (const role of targetRoles) {
      const collection = await getCollection(role);
      const ids = contextualizedChunks.map(() => randomUUID());
      const metadatas = contextualizedChunks.map((_, idx) => ({
        source: file.originalname,
        doc_title: docTitle,
        audience,
        chunk_index: String(idx),
        roles: rolesStr,
        uploaded_at: uploadedAt,
        file_size: fileSizeStr,
      }));

      await collection.add({
        ids,
        documents: contextualizedChunks,
        metadatas: metadatas as any,
      });
    }

    return {
      source: file.originalname,
      docTitle,
      audience,
      chunksCount: contextualizedChunks.length,
      uploadedAt,
      fileSize: fileSizeStr,
      roles: rolesStr,
    };
  }

  /**
   * Snapshot any Admin-uploaded documents currently stored in ChromaDB's persistent admin
   * collection before startup resetCollection() wipes them (handles container rebuilds without a local data mount).
   */
  async snapshotUploadedDocsFromChroma(): Promise<number> {
    this.loadPersistedDocs();
    try {
      const collection = await getCollection('admin');
      const all = await collection.get({
        include: ['documents', 'metadatas'] as any,
      });

      if (!all?.documents || !all?.metadatas) return 0;

      const grouped = new Map<string, { meta: Record<string, string>; items: Array<{ index: number; text: string }> }>();

      for (let i = 0; i < all.documents.length; i++) {
        const text = all.documents[i] || '';
        const meta = (all.metadatas[i] || {}) as Record<string, string>;
        if (!text || !meta.uploaded_at || !meta.source) continue;

        if (!grouped.has(meta.source)) {
          grouped.set(meta.source, { meta, items: [] });
        }
        const chunkIdx = Number.isFinite(Number(meta.chunk_index)) ? Number(meta.chunk_index) : i;
        grouped.get(meta.source)!.items.push({ index: chunkIdx, text });
      }

      let recovered = 0;
      for (const [source, group] of grouped.entries()) {
        group.items.sort((a, b) => a.index - b.index);
        const chunks = group.items.map(item => item.text);
        const audience: 'public' | 'staff_only' =
          group.meta.audience === 'staff_only' ? 'staff_only' : 'public';
        const targetRoles: Array<'patron' | 'staff' | 'admin'> =
          audience === 'public' ? ['patron', 'staff', 'admin'] : ['staff', 'admin'];

        if (!this.uploadedCache.has(source)) {
          this.persistUploadedDoc({
            source,
            docTitle: group.meta.doc_title || path.basename(source, path.extname(source)),
            audience,
            chunksCount: chunks.length,
            uploadedAt: group.meta.uploaded_at,
            fileSize: group.meta.file_size,
            roles: group.meta.roles || targetRoles.join(', '),
            rawText: chunks.join('\n'),
            chunks,
            targetRoles,
          });
          recovered++;
        }
      }
      return recovered;
    } catch (err: any) {
      console.warn('[RagService] snapshotUploadedDocsFromChroma skipped:', err.message);
      return 0;
    }
  }

  async rehydrateUploadedDocuments(): Promise<number> {
    const docs = this.loadPersistedDocs();
    let totalChunks = 0;

    for (const doc of docs) {
      const targetRoles: Array<'patron' | 'staff' | 'admin'> =
        doc.audience === 'public' ? ['patron', 'staff', 'admin'] : ['staff', 'admin'];

      for (const role of targetRoles) {
        const collection = await getCollection(role);
        const ids = doc.chunks.map(() => randomUUID());
        const metadatas = doc.chunks.map((_, idx) => ({
          source: doc.source,
          doc_title: doc.docTitle,
          audience: doc.audience,
          chunk_index: String(idx),
          roles: doc.roles || targetRoles.join(', '),
          uploaded_at: doc.uploadedAt || new Date().toISOString(),
          file_size: doc.fileSize || '0.0 KB',
        }));

        await collection.add({
          ids,
          documents: doc.chunks,
          metadatas: metadatas as any,
        });
        totalChunks += doc.chunks.length;
      }
    }

    if (docs.length > 0) {
      console.log(`[RagService] Rehydrated ${docs.length} uploaded documents (${totalChunks} role chunks) into ChromaDB.`);
    }
    return docs.length;
  }

  async listDocuments(): Promise<RAGDocumentSummary[]> {
    const docMap = new Map<string, RAGDocumentSummary>();

    try {
      // Admin collection contains all documents (both public and staff_only)
      const collection = await getCollection('admin');
      const all = await collection.get({
        include: ['metadatas'] as any,
      });

      if (all.metadatas && all.metadatas.length > 0) {
        for (const meta of all.metadatas) {
          if (!meta) continue;
          const source = (meta.source as string) || 'unknown';
          if (!docMap.has(source)) {
            docMap.set(source, {
              source,
              docTitle: (meta.doc_title as string) || source,
              audience: ((meta.audience as string) || 'public') as 'public' | 'staff_only',
              chunksCount: 1,
              uploadedAt: meta.uploaded_at as string | undefined,
              fileSize: meta.file_size as string | undefined,
              roles: meta.roles as string | undefined,
            });
          } else {
            docMap.get(source)!.chunksCount++;
          }
        }
      }
    } catch (err: any) {
      console.warn('[RagService] ChromaDB listDocuments failed, falling back to persisted docs:', err.message);
    }

    for (const stored of this.loadPersistedDocs()) {
      if (!docMap.has(stored.source)) {
        docMap.set(stored.source, {
          source: stored.source,
          docTitle: stored.docTitle,
          audience: stored.audience,
          chunksCount: stored.chunksCount,
          uploadedAt: stored.uploadedAt,
          fileSize: stored.fileSize,
          roles: stored.roles,
        });
      }
    }

    return Array.from(docMap.values());
  }

  async deleteDocument(source: string): Promise<{ deleted: boolean; source: string }> {
    await this.deleteDocumentFromChroma(source);
    this.removePersistedDoc(source);
    return { deleted: true, source };
  }
}

export const ragService = new RagService();

