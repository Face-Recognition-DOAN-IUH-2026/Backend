import axios from 'axios';
import config from '../config';

const CHUNK_SIZE = 500;

interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
  }>;
}

export function chunkText(text: string, chunkSize: number = CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let currentChunk = '';

  for (const sentence of sentences) {
    if ((currentChunk + sentence).length <= chunkSize) {
      currentChunk += sentence;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = sentence;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

export async function embedText(text: string): Promise<number[]> {
  const response = await axios.post<EmbeddingResponse>(
    'https://integrate.api.nvidia.com/v1/embeddings',
    {
      input: text,
      model: config.nvidiaEmbedModel,
    },
    {
      headers: {
        'Authorization': `Bearer ${config.nvidiaApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    }
  );

  if (response.data.data && response.data.data.length > 0) {
    return response.data.data[0].embedding;
  }

  throw new Error('No embedding returned from NVIDIA API');
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const response = await axios.post<EmbeddingResponse>(
    'https://integrate.api.nvidia.com/v1/embeddings',
    {
      input: texts,
      model: config.nvidiaEmbedModel,
    },
    {
      headers: {
        'Authorization': `Bearer ${config.nvidiaApiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 120000,
    }
  );

  if (response.data.data && response.data.data.length > 0) {
    return response.data.data.map(item => item.embedding);
  }

  throw new Error('No embeddings returned from NVIDIA API');
}

export default { chunkText, embedText, embedTexts };