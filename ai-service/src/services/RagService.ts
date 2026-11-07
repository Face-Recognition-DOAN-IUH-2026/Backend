import { randomUUID } from 'crypto';
import path from 'path';
import { getCollection } from '../clients/chromadb';
import { chunkText, embedTexts } from '../rag/embedder';

export interface RAGDocumentSummary {
  source: string;
  docTitle: string;
  audience: 'public' | 'staff_only';
  chunksCount: number;
  uploadedAt?: string;
  fileSize?: string;
  roles?: string;
}

export class RagService {
  async extractText(file: { originalname: string; buffer: Buffer; mimetype?: string }): Promise<string> {
    const ext = path.extname(file.originalname).toLowerCase();
    const isPdf = ext === '.pdf' || file.mimetype === 'application/pdf';

    if (isPdf) {
      try {
        const pdfPkg = require('pdf-parse');
        if (typeof pdfPkg === 'function') {
          const parsed = await pdfPkg(file.buffer);
          return (parsed.text || '').trim();
        }
        if (pdfPkg.PDFParse) {
          const parser = new pdfPkg.PDFParse({ data: file.buffer });
          const textResult = await parser.getText();
          const extracted = typeof textResult === 'string' ? textResult : (textResult?.text || '');
          if (extracted && extracted.trim().length > 0) {
            return extracted.trim();
          }
        }
      } catch (err: any) {
        console.warn('[RagService] PDF extraction error, falling back to text buffer:', err.message);
      }
    }

    return file.buffer.toString('utf-8').trim();
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
    const chunks = chunkText(rawText);
    if (chunks.length === 0) {
      throw new Error('Không thể phân đoạn văn bản từ tài liệu.');
    }

    // Attempt NVIDIA NIM embeddings if configured; fallback gracefully
    let embeddings: number[][] = [];
    try {
      embeddings = await embedTexts(chunks);
    } catch (e: any) {
      console.warn('[RagService] NVIDIA embedding failed or skipped, relying on ChromaDB collection embedding function:', e.message);
      embeddings = [];
    }

    const targetRoles: Array<'patron' | 'staff' | 'admin'> =
      audience === 'public' ? ['patron', 'staff', 'admin'] : ['staff', 'admin'];

    const uploadedAt = new Date().toISOString();
    const fileSizeStr = `${(file.size / 1024).toFixed(1)} KB`;

    for (const role of targetRoles) {
      const collection = await getCollection(role);
      const ids = chunks.map(() => randomUUID());
      const metadatas = chunks.map((_, idx) => ({
        source: file.originalname,
        doc_title: docTitle,
        audience,
        chunk_index: String(idx),
        roles: targetRoles.join(', '),
        uploaded_at: uploadedAt,
        file_size: fileSizeStr,
      }));

      const addPayload: any = {
        ids,
        documents: chunks,
        metadatas,
      };

      if (embeddings.length === chunks.length) {
        addPayload.embeddings = embeddings;
      }

      await collection.add(addPayload);
    }

    return {
      source: file.originalname,
      docTitle,
      audience,
      chunksCount: chunks.length,
      uploadedAt,
      fileSize: fileSizeStr,
      roles: targetRoles.join(', '),
    };
  }

  async listDocuments(): Promise<RAGDocumentSummary[]> {
    // Admin collection contains all documents (both public and staff_only)
    const collection = await getCollection('admin');
    const all = await collection.get({
      include: ['metadatas'] as any,
    });

    const docMap = new Map<string, RAGDocumentSummary>();

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

    return Array.from(docMap.values());
  }

  async deleteDocument(source: string): Promise<{ deleted: boolean; source: string }> {
    const roles: Array<'patron' | 'staff' | 'admin'> = ['patron', 'staff', 'admin'];

    for (const role of roles) {
      try {
        const collection = await getCollection(role);
        // Find matching IDs first for maximum ChromaDB version compatibility
        const existing = await collection.get({
          where: { source: { $eq: source } } as any,
        });

        if (existing.ids && existing.ids.length > 0) {
          await collection.delete({ ids: existing.ids });
        } else {
          // Fallback simple query
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

    return { deleted: true, source };
  }
}

export const ragService = new RagService();

