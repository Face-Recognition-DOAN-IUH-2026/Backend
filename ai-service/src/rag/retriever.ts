import { getCollection } from '../clients/chromadb';
import { foldVietnamese, textToEmbedding, tokenizeVietnamese } from '../clients/embedding';
import { ragService } from '../services/RagService';

export interface RetrievedDocument {
  id: string;
  content: string;
  source: string;
  docTitle: string;
  distance?: number;
}

interface CandidateChunk {
  id: string;
  content: string;
  source: string;
  docTitle: string;
  audience?: string;
  uploadedAt?: string;
  vectorDistance?: number;
}

function dotProduct(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    sum += a[i] * b[i];
  }
  return sum;
}

function scoreCandidate(
  queryTokens: string[],
  queryFoldedTokens: string[],
  queryBigrams: string[],
  queryFoldedBigrams: string[],
  queryVec: number[],
  candidate: CandidateChunk,
): number {
  const fullText = `${candidate.docTitle || ''} ${candidate.source || ''} ${candidate.content || ''}`;
  const docTokens = tokenizeVietnamese(fullText, false);
  const docTokenSet = new Set(docTokens);
  const docFoldedSet = new Set(docTokens.map(foldVietnamese));

  const titleTokens = tokenizeVietnamese(`${candidate.docTitle || ''} ${candidate.source || ''}`, false);
  const titleTokenSet = new Set(titleTokens);
  const titleFoldedSet = new Set(titleTokens.map(foldVietnamese));

  const docBigramSet = new Set<string>();
  const docFoldedBigramSet = new Set<string>();
  for (let i = 0; i + 1 < docTokens.length; i++) {
    docBigramSet.add(`${docTokens[i]}_${docTokens[i + 1]}`);
    docFoldedBigramSet.add(`${foldVietnamese(docTokens[i])}_${foldVietnamese(docTokens[i + 1])}`);
  }

  let unigramHits = 0;
  let titleHits = 0;
  for (let i = 0; i < queryTokens.length; i++) {
    const qTok = queryTokens[i];
    const qFold = queryFoldedTokens[i];
    if (docTokenSet.has(qTok)) {
      unigramHits += 1.0;
    } else if (docFoldedSet.has(qFold)) {
      unigramHits += 0.8;
    }

    if (titleTokenSet.has(qTok)) {
      titleHits += 1.0;
    } else if (titleFoldedSet.has(qFold)) {
      titleHits += 0.8;
    }
  }

  const lexicalScore = queryTokens.length > 0 ? Math.min(1, unigramHits / queryTokens.length) : 0;
  const titleScore = queryTokens.length > 0 ? Math.min(1, titleHits / queryTokens.length) : 0;

  let bigramHits = 0;
  for (let i = 0; i < queryBigrams.length; i++) {
    if (docBigramSet.has(queryBigrams[i])) {
      bigramHits += 1.0;
    } else if (docFoldedBigramSet.has(queryFoldedBigrams[i])) {
      bigramHits += 0.75;
    }
  }
  const bigramScore = queryBigrams.length > 0 ? Math.min(1, bigramHits / queryBigrams.length) : 0;

  let vectorSim: number;
  if (typeof candidate.vectorDistance === 'number' && !Number.isNaN(candidate.vectorDistance)) {
    vectorSim = 1 / (1 + Math.max(0, candidate.vectorDistance));
  } else {
    const chunkVec = textToEmbedding(fullText);
    const cos = Math.max(0, dotProduct(queryVec, chunkVec));
    vectorSim = cos;
  }

  let combined =
    vectorSim * 0.35 +
    lexicalScore * 0.45 +
    bigramScore * 0.25 +
    titleScore * 0.25;

  if (candidate.uploadedAt && (lexicalScore > 0 || vectorSim > 0.45)) {
    combined += 0.25;
  }

  return combined;
}

export async function retrieve(query: string, topK: number = 5, role?: string): Promise<RetrievedDocument[]> {
  const normalizedRole = role || 'patron';
  const isPatron = normalizedRole === 'patron';
  const candidateMap = new Map<string, CandidateChunk>();

  const upsertCandidate = (chunk: CandidateChunk) => {
    if (isPatron && chunk.audience === 'staff_only') {
      return;
    }
    const dedupKey = chunk.source && chunk.content
      ? `${chunk.source}::${chunk.content}`
      : chunk.id;
    const existing = candidateMap.get(dedupKey);
    if (!existing) {
      candidateMap.set(dedupKey, chunk);
    } else if (chunk.vectorDistance !== undefined && existing.vectorDistance === undefined) {
      existing.vectorDistance = chunk.vectorDistance;
    }
  };

  try {
    const collection = await getCollection(normalizedRole);

    // 1. Vector candidates from ChromaDB
    try {
      const results = await collection.query({
        queryTexts: [query],
        nResults: Math.max(topK * 3, 15),
        include: ['documents', 'metadatas', 'distances'] as any,
      });

      if (results?.documents && results.documents.length > 0) {
        const docs = results.documents[0] || [];
        const metadatas = results.metadatas?.[0] || [];
        const distances = results.distances?.[0] || [];
        const ids = results.ids?.[0] || [];

        for (let i = 0; i < docs.length; i++) {
          const content = docs[i] || '';
          if (!content) continue;
          const metadata = (metadatas[i] || {}) as Record<string, string>;
          upsertCandidate({
            id: ids[i] || String(i),
            content,
            source: metadata.source || '',
            docTitle: metadata.doc_title || '',
            audience: metadata.audience,
            uploadedAt: metadata.uploaded_at,
            vectorDistance: typeof distances[i] === 'number' ? distances[i] : undefined,
          });
        }
      }
    } catch (err: any) {
      console.warn('[Retriever] ChromaDB query error, continuing with full scan / cache:', err?.message);
    }

    // 2. Full collection scan for lexical & hybrid re-ranking (ensures exact Vietnamese keyword hits never miss top-K)
    try {
      const allDocs = await collection.get({
        include: ['documents', 'metadatas'] as any,
      });

      if (allDocs?.documents && allDocs.metadatas && allDocs.ids) {
        for (let i = 0; i < allDocs.documents.length; i++) {
          const content = allDocs.documents[i] || '';
          if (!content) continue;
          const meta = (allDocs.metadatas[i] || {}) as Record<string, string>;
          upsertCandidate({
            id: allDocs.ids[i] || `all_${i}`,
            content,
            source: meta.source || '',
            docTitle: meta.doc_title || '',
            audience: meta.audience,
            uploadedAt: meta.uploaded_at,
          });
        }
      }
    } catch (err: any) {
      console.warn('[Retriever] ChromaDB get error, relying on query results and uploaded cache:', err?.message);
    }
  } catch (err: any) {
    console.warn('[Retriever] getCollection failed, using persisted uploaded KB fallback:', err?.message);
  }

  // 3. Always include persisted Admin-uploaded documents allowed for the caller's role (offline/degraded fallback + deduped)
  for (const uploaded of ragService.getUploadedDocs()) {
    if (isPatron && uploaded.audience === 'staff_only') continue;
    uploaded.chunks.forEach((chunkContent, idx) => {
      upsertCandidate({
        id: `uploaded_${uploaded.source}_${idx}`,
        content: chunkContent,
        source: uploaded.source,
        docTitle: uploaded.docTitle,
        audience: uploaded.audience,
        uploadedAt: uploaded.uploadedAt,
      });
    });
  }

  const rawTokens = tokenizeVietnamese(query, true);
  const queryTokens = rawTokens.length > 0 ? rawTokens : tokenizeVietnamese(query, false);
  const queryFoldedTokens = queryTokens.map(foldVietnamese);

  const queryBigrams: string[] = [];
  const queryFoldedBigrams: string[] = [];
  for (let i = 0; i + 1 < queryTokens.length; i++) {
    queryBigrams.push(`${queryTokens[i]}_${queryTokens[i + 1]}`);
    queryFoldedBigrams.push(`${queryFoldedTokens[i]}_${queryFoldedTokens[i + 1]}`);
  }
  const queryVec = textToEmbedding(query);

  const scored = Array.from(candidateMap.values()).map(candidate => {
    const score = scoreCandidate(
      queryTokens,
      queryFoldedTokens,
      queryBigrams,
      queryFoldedBigrams,
      queryVec,
      candidate,
    );
    return {
      id: candidate.id,
      content: candidate.content,
      source: candidate.source,
      docTitle: candidate.docTitle,
      distance: Math.max(0, 1 - Math.min(1, score)),
      _score: score,
    };
  });

  scored.sort((a, b) => b._score - a._score);

  return scored.slice(0, topK).map(({ _score, ...doc }) => doc);
}

export default { retrieve };
