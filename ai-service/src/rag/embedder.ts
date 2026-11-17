import axios from 'axios';
import { config } from '../config';

const CHUNK_SIZE = 500;

interface EmbeddingResponse {
  data: Array<{
    embedding: number[];
  }>;
}

function splitLongSegment(segment: string, chunkSize: number): string[] {
  const trimmed = segment.trim();
  if (!trimmed) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  const words = trimmed.split(/\s+/);
  const parts: string[] = [];
  let current = '';

  for (const word of words) {
    if (word.length > chunkSize) {
      if (current) {
        parts.push(current.trim());
        current = '';
      }
      for (let i = 0; i < word.length; i += chunkSize) {
        parts.push(word.slice(i, i + chunkSize));
      }
      continue;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= chunkSize) {
      current = candidate;
    } else {
      if (current) parts.push(current.trim());
      current = word;
    }
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

function splitBlockToSegments(block: string, chunkSize: number): string[] {
  const trimmed = block.trim();
  if (!trimmed) return [];
  if (trimmed.length <= chunkSize) return [trimmed];

  const segments: string[] = [];
  const lines = trimmed.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.length <= chunkSize) {
      segments.push(line);
      continue;
    }

    // Split by sentence punctuation while always keeping any trailing text without punctuation.
    const sentences = line.split(/(?<=[.!?…])\s+/);
    for (const sentence of sentences) {
      const s = sentence.trim();
      if (!s) continue;
      if (s.length <= chunkSize) {
        segments.push(s);
      } else {
        segments.push(...splitLongSegment(s, chunkSize));
      }
    }
  }

  return segments;
}

export function chunkText(text: string, chunkSize: number = CHUNK_SIZE): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n{2,}|(?=\n#{1,6}\s)/)
    .map(b => b.trim())
    .filter(Boolean);

  const segments: string[] = [];
  for (const block of blocks) {
    segments.push(...splitBlockToSegments(block, chunkSize));
  }

  const chunks: string[] = [];
  let currentChunk = '';

  for (const segment of segments) {
    const separator = currentChunk ? '\n' : '';
    if ((currentChunk + separator + segment).length <= chunkSize) {
      currentChunk = currentChunk + separator + segment;
    } else {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = segment;
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