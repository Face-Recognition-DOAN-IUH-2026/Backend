import { ChromaClient, Collection } from 'chromadb';
import { config } from '../config';
import { hashEmbeddingFn } from './embedding';

let chromaClient: ChromaClient | null = null;
const collections = new Map<string, Collection>();

export function getChromaClient(): ChromaClient {
  if (!chromaClient) {
    chromaClient = new ChromaClient({
      path: config.chromaDbUrl,
    });
  }
  return chromaClient;
}

function getCollectionName(role: string): string {
  return `${config.chromaCollection}-${role}`;
}

export async function getCollection(role: string): Promise<Collection> {
  const key = role || 'patron';
  let col = collections.get(key);
  if (!col) {
    const client = getChromaClient();
    const name = getCollectionName(key);
    try {
      col = await client.getCollection({
        name,
        embeddingFunction: hashEmbeddingFn as any,
      });
    } catch {
      col = await client.createCollection({
        name,
        embeddingFunction: hashEmbeddingFn as any,
      });
    }
    collections.set(key, col);
  }
  return col;
}

export async function resetCollection(role: string): Promise<Collection> {
  const client = getChromaClient();
  const name = getCollectionName(role);
  try {
    await client.deleteCollection({ name });
  } catch {
  }
  collections.delete(role);
  const col = await client.createCollection({
    name,
    embeddingFunction: hashEmbeddingFn as any,
  });
  collections.set(role, col);
  return col;
}

export async function resetAllCollections(): Promise<void> {
  for (const role of ['patron', 'staff', 'admin']) {
    await resetCollection(role);
  }
}

export default { getChromaClient, getCollection, resetCollection, resetAllCollections };
