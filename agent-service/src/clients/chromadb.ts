import { ChromaClient, Collection } from 'chromadb';
import config from '../config';
import { hashEmbeddingFn } from './embedding';

let chromaClient: ChromaClient | null = null;
let collection: Collection | null = null;

export function getChromaClient(): ChromaClient {
  if (!chromaClient) {
    chromaClient = new ChromaClient({
      path: config.chromaDbUrl,
    });
  }
  return chromaClient;
}

export async function getCollection(): Promise<Collection> {
  if (!collection) {
    const client = getChromaClient();
    try {
      collection = await client.getCollection({
        name: config.chromaCollection,
        embeddingFunction: hashEmbeddingFn as any,
      });
    } catch {
      collection = await client.createCollection({
        name: config.chromaCollection,
        embeddingFunction: hashEmbeddingFn as any,
      });
    }
  }
  return collection;
}

export async function resetCollection(): Promise<Collection> {
  const client = getChromaClient();
  try {
    await client.deleteCollection({ name: config.chromaCollection });
  } catch {
  }
  collection = await client.createCollection({
    name: config.chromaCollection,
    embeddingFunction: hashEmbeddingFn as any,
  });
  return collection;
}

export default { getChromaClient, getCollection, resetCollection };