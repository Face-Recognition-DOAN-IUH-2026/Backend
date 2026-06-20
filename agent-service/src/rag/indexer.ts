import fs from 'fs';
import path from 'path';
import { getCollection, resetCollection } from '../clients/chromadb';
import { chunkText } from './embedder';
import { v4 as uuidv4 } from 'uuid';

interface DocMetadata {
  source: string;
  doc_title: string;
}

function getDocTitle(filePath: string): string {
  const fileName = path.basename(filePath, '.md');
  const titles: Record<string, string> = {
    'gio-mo-cua': 'Giờ Mở Cửa',
    'quy-dinh-muon-tra': 'Quy Định Mượn Trả',
    'vi-tri-tang': 'Vị Trí Tầng',
    'cau-hoi-thuong-gap': 'Câu Hỏi Thường Gặp',
    'the-loai-sach': 'Thể Loại Sách',
    'quy-dinh-the': 'Quy Định Thẻ',
    'chinh-sach-phat': 'Chính Sách Phạt',
  };
  return titles[fileName] || fileName;
}

function extractFrontmatter(content: string): { metadata: Record<string, string>; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (frontmatterMatch) {
    const metadata: Record<string, string> = {};
    const frontmatterLines = frontmatterMatch[1].split('\n');
    for (const line of frontmatterLines) {
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        metadata[key] = value;
      }
    }
    return { metadata, body: frontmatterMatch[2] };
  }
  return { metadata: {}, body: content };
}

export async function indexDocuments(): Promise<void> {
  console.log('Starting document indexing...');

  const docsPath = path.join(__dirname, '..', '..', 'src', 'docs');
  const files = fs.readdirSync(docsPath).filter(f => f.endsWith('.md'));

  if (files.length === 0) {
    console.log('No documents found to index');
    return;
  }

  console.log(`Found ${files.length} documents to index`);

  const collection = await resetCollection();

  let totalChunks = 0;

  for (const file of files) {
    const filePath = path.join(docsPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { body } = extractFrontmatter(content);
    const docTitle = getDocTitle(filePath);
    const chunks = chunkText(body);

    console.log(`Processing "${docTitle}": ${chunks.length} chunks`);

    if (chunks.length > 0) {
      const ids = chunks.map(() => uuidv4());
      const metadatas: DocMetadata[] = chunks.map(() => ({
        source: file,
        doc_title: docTitle,
      }));

      await collection.add({
        ids,
        documents: chunks,
        metadatas: metadatas as any,
      });

      totalChunks += chunks.length;
    }
  }

  console.log(`Indexing complete: ${totalChunks} total chunks from ${files.length} documents`);
}

export default { indexDocuments };