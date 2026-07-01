"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.indexDocuments = indexDocuments;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const chromadb_1 = require("../clients/chromadb");
const embedder_1 = require("./embedder");
const uuid_1 = require("uuid");
function getDocTitle(filePath) {
    const fileName = path_1.default.basename(filePath, '.md');
    const titles = {
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
function extractFrontmatter(content) {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (frontmatterMatch) {
        const metadata = {};
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
async function indexDocuments() {
    console.log('Starting document indexing...');
    const docsPath = path_1.default.join(__dirname, '..', '..', 'src', 'docs');
    const files = fs_1.default.readdirSync(docsPath).filter(f => f.endsWith('.md'));
    if (files.length === 0) {
        console.log('No documents found to index');
        return;
    }
    console.log(`Found ${files.length} documents to index`);
    const collection = await (0, chromadb_1.resetCollection)();
    let totalChunks = 0;
    for (const file of files) {
        const filePath = path_1.default.join(docsPath, file);
        const content = fs_1.default.readFileSync(filePath, 'utf-8');
        const { body } = extractFrontmatter(content);
        const docTitle = getDocTitle(filePath);
        const chunks = (0, embedder_1.chunkText)(body);
        console.log(`Processing "${docTitle}": ${chunks.length} chunks`);
        if (chunks.length > 0) {
            const ids = chunks.map(() => (0, uuid_1.v4)());
            const metadatas = chunks.map(() => ({
                source: file,
                doc_title: docTitle,
            }));
            await collection.add({
                ids,
                documents: chunks,
                metadatas: metadatas,
            });
            totalChunks += chunks.length;
        }
    }
    console.log(`Indexing complete: ${totalChunks} total chunks from ${files.length} documents`);
}
exports.default = { indexDocuments };
