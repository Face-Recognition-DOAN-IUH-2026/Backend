import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { getCollection, resetCollection } from '../clients/chromadb';
import { chunkText } from './embedder';

interface DocMetadata {
  source: string;
  doc_title: string;
  roles: string;
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
    'quy-dinh-nhan-vien': 'Quy Định Nhân Viên',
    'bao-cao-tai-chinh': 'Báo Cáo Tài Chính',
    'noi-quy-thu-vien': 'Nội Quy Thư Viện',
  };
  return titles[fileName] || fileName;
}

function extractFrontmatter(content: string): { metadata: Record<string, string>; body: string } {
  // Handle both LF and CRLF (Windows) line endings
  const normalized = content.replace(/\r\n/g, '\n');
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
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
  return { metadata: { roles: 'patron' }, body: normalized };
}

function parseRoles(rolesStr: string): string[] {
  return rolesStr
    .split(',')
    .map(r => r.trim())
    .filter(r => r.length > 0 && ['patron', 'staff', 'admin'].includes(r));
}

export async function indexDocuments(): Promise<void> {
  console.log('Starting document indexing...');

  const docsPath = path.join(__dirname, '..', '..', '..', '..', 'src', 'docs');
  const files = fs.readdirSync(docsPath).filter(f => f.endsWith('.md'));

  if (files.length === 0) {
    console.log('No documents found to index');
    return;
  }

  console.log(`Found ${files.length} documents to index`);

  const roleCollections = ['patron', 'staff', 'admin'];

  for (const role of roleCollections) {
    await resetCollection(role);
  }

  let totalChunks = 0;

  for (const file of files) {
    const filePath = path.join(docsPath, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { metadata, body } = extractFrontmatter(content);
    const docTitle = getDocTitle(filePath);
    const roles = parseRoles(metadata.roles || '');

    console.log(`Processing "${docTitle}": roles=${roles.join(', ') || 'none'}`);

    if (roles.length === 0) {
      console.log(`  => Skipped (no roles assigned)`);
      continue;
    }

    const chunks = chunkText(body);
    console.log(`  => ${chunks.length} chunks`);

    if (chunks.length === 0) continue;

    for (const role of roles) {
      const collection = await getCollection(role);
      const ids = chunks.map(() => randomUUID());
      const metadatas: DocMetadata[] = chunks.map(() => ({
        source: file,
        doc_title: docTitle,
        roles: roles.join(', '),
      }));

      await collection.add({
        ids,
        documents: chunks,
        metadatas: metadatas as any,
      });

      console.log(`  => Indexed into "${role}_kb": ${chunks.length} chunks`);
      totalChunks += chunks.length;
    }
  }

  console.log(`Indexing complete: ${totalChunks} total chunks indexed across ${roleCollections.length} collections`);
}

export default { indexDocuments };
