"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retrieve = retrieve;
const chromadb_1 = require("../clients/chromadb");
async function retrieve(query, topK = 5) {
    const collection = await (0, chromadb_1.getCollection)();
    try {
        const results = await collection.query({
            queryTexts: [query],
            nResults: topK,
            include: ['documents', 'metadatas', 'distances'],
        });
        const documents = [];
        if (results.documents && results.documents.length > 0) {
            const docs = results.documents[0];
            const metadatas = results.metadatas?.[0] || [];
            const distances = results.distances?.[0] || [];
            const ids = results.ids?.[0] || [];
            for (let i = 0; i < docs.length; i++) {
                const metadata = metadatas[i] || {};
                documents.push({
                    id: ids[i] || String(i),
                    content: docs[i] || '',
                    source: metadata.source || '',
                    docTitle: metadata.doc_title || '',
                    distance: distances[i],
                });
            }
        }
        return documents;
    }
    catch {
        const allDocs = await collection.get({
            include: ['documents', 'metadatas'],
        });
        const queryLower = query.toLowerCase();
        const scored = [];
        if (allDocs.documents && allDocs.metadatas && allDocs.ids) {
            for (let i = 0; i < allDocs.documents.length; i++) {
                const doc = allDocs.documents[i] || '';
                const meta = (allDocs.metadatas[i] || {});
                const docLower = doc.toLowerCase();
                const words = queryLower.split(/\s+/).filter(w => w.length > 2);
                let score = 0;
                for (const word of words) {
                    if (docLower.includes(word))
                        score++;
                }
                if (score > 0) {
                    scored.push({
                        id: allDocs.ids[i] || String(i),
                        content: doc,
                        source: meta.source || '',
                        docTitle: meta.doc_title || '',
                        distance: 1 - score / words.length,
                    });
                }
            }
        }
        scored.sort((a, b) => (a.distance ?? 1) - (b.distance ?? 1));
        return scored.slice(0, topK);
    }
}
exports.default = { retrieve };
