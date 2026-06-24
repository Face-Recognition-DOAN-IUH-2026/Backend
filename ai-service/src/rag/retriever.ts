import { getCollection } from '../clients/chromadb';

export interface RetrievedDocument {
  id: string;
  content: string;
  source: string;
  docTitle: string;
  distance?: number;
}

export async function retrieve(query: string, topK: number = 5): Promise<RetrievedDocument[]> {
  const collection = await getCollection();

  try {
    const results = await collection.query({
      queryTexts: [query],
      nResults: topK,
      include: ['documents', 'metadatas', 'distances'] as any,
    });

    const documents: RetrievedDocument[] = [];

    if (results.documents && results.documents.length > 0) {
      const docs = results.documents[0];
      const metadatas = results.metadatas?.[0] || [];
      const distances = results.distances?.[0] || [];
      const ids = results.ids?.[0] || [];

      for (let i = 0; i < docs.length; i++) {
        const metadata = metadatas[i] as Record<string, string> || {};
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
  } catch {
    const allDocs = await collection.get({
      include: ['documents', 'metadatas'] as any,
    });

    const queryLower = query.toLowerCase();
    const scored: RetrievedDocument[] = [];

    if (allDocs.documents && allDocs.metadatas && allDocs.ids) {
      for (let i = 0; i < allDocs.documents.length; i++) {
        const doc = allDocs.documents[i] || '';
        const meta = (allDocs.metadatas[i] || {}) as Record<string, string>;
        const docLower = doc.toLowerCase();

        const words = queryLower.split(/\s+/).filter(w => w.length > 2);
        let score = 0;
        for (const word of words) {
          if (docLower.includes(word)) score++;
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

export default { retrieve };