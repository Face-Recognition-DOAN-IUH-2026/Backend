import { IEmbeddingFunction } from 'chromadb';

const DIMENSION = 384;

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

function textToEmbedding(text: string): number[] {
  const embedding: number[] = [];
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);

  for (let i = 0; i < DIMENSION; i++) {
    let val = 0;
    for (let j = 0; j < words.length; j++) {
      const word = words[j];
      val += Math.sin(simpleHash(word + '_' + i) * 0.001) * 0.5;
      val += Math.cos(simpleHash(word + '_' + i + '_2') * 0.001) * 0.3;
    }
    embedding.push(val);
  }

  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) {
    for (let i = 0; i < embedding.length; i++) {
      embedding[i] /= norm;
    }
  }

  return embedding;
}

export class HashEmbeddingFunction implements IEmbeddingFunction {
  async generate(texts: string[]): Promise<number[][]> {
    return texts.map(text => textToEmbedding(text));
  }
}

export const hashEmbeddingFn = new HashEmbeddingFunction();
