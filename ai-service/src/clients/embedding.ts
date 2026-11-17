import { IEmbeddingFunction } from 'chromadb';

export const DIMENSION = 384;

const VIETNAMESE_STOP_WORDS = new Set([
  'cho', 'toi', 'minh', 'ban', 'hoi', 'la', 'gi', 'nhu', 'the', 'nao',
  'cua', 'trong', 'voi', 'cac', 'nhung', 'duoc', 'khong', 'co', 'va', 'o',
  'tai', 've', 'mot', 'nay', 'kia', 'do', 'thi', 'ma', 'se', 'da', 'dang',
  'bi', 'tu', 'den', 'bang', 'hay', 'hoac', 'neu', 'khi', 'vi', 'nen',
  'de', 'nhieu', 'bao', 'xin', 'vui', 'long',
]);

/** Fold Vietnamese diacritics to ASCII lowercase while preserving digits and spaces. */
export function foldVietnamese(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/**
 * Normalize Unicode (NFC), strip punctuation/symbols, and split into meaningful tokens.
 * Keeps numbers (including single digits) and tokens with length >= 2 outside stop-words.
 */
export function tokenizeVietnamese(text: string, filterStopWords: boolean = true): string[] {
  const cleaned = text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ');

  const rawTokens = cleaned.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];

  for (const token of rawTokens) {
    const isNumeric = /^\d+$/.test(token);
    if (!isNumeric && token.length < 2) continue;
    if (filterStopWords && !isNumeric && VIETNAMESE_STOP_WORDS.has(foldVietnamese(token))) {
      continue;
    }
    tokens.push(token);
  }

  return tokens;
}

function fnv1aHash(str: string, seed: number): number {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

function addWeightedFeature(vec: number[], feature: string, weight: number): void {
  // Project each feature across 4 deterministic bins with signed +/- weights (CountSketch)
  for (let probe = 0; probe < 4; probe++) {
    const h = fnv1aHash(feature, 0x9e3779b9 * (probe + 1));
    const idx = h % DIMENSION;
    const sign = ((h >>> 31) === 0) ? 1 : -1;
    vec[idx] += sign * weight;
  }
}

export function textToEmbedding(text: string): number[] {
  const embedding = new Array<number>(DIMENSION).fill(0);
  const tokens = tokenizeVietnamese(text, true);
  // Fallback to unfiltered tokens if every word happened to be a stop-word
  const activeTokens = tokens.length > 0 ? tokens : tokenizeVietnamese(text, false);

  for (let i = 0; i < activeTokens.length; i++) {
    const word = activeTokens[i];
    const folded = foldVietnamese(word);

    addWeightedFeature(embedding, `u:${word}`, 1.0);
    addWeightedFeature(embedding, `uf:${folded}`, 0.7);

    if (i + 1 < activeTokens.length) {
      const nextWord = activeTokens[i + 1];
      const nextFolded = foldVietnamese(nextWord);
      addWeightedFeature(embedding, `b:${word}_${nextWord}`, 1.3);
      addWeightedFeature(embedding, `bf:${folded}_${nextFolded}`, 0.9);
    }
  }

  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < DIMENSION; i++) {
      embedding[i] /= norm;
    }
  } else {
    embedding[0] = 1;
  }

  return embedding;
}

export class HashEmbeddingFunction implements IEmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    return texts.map(text => textToEmbedding(text));
  }
}

export const hashEmbeddingFn = new HashEmbeddingFunction();
