import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import config from './config';
import { getCollection } from './clients/chromadb';
import { indexDocuments } from './rag/indexer';
import chatRouter from './routes/chat';
import confirmRouter from './routes/confirm';
import healthRouter from './routes/health';
import { auth } from './middlewares/auth';

async function main(): Promise<void> {
  console.log('Starting agent-service...');

  console.log('Connecting to ChromaDB...');
  try {
    const collection = await getCollection();
    const count = await collection.count();
    console.log(`ChromaDB connected. Collection "${config.chromaCollection}" has ${count} documents.`);
  } catch (error) {
    console.warn('ChromaDB connection warning:', error instanceof Error ? error.message : error);
    console.log('Continuing without ChromaDB connection...');
  }

  console.log('Indexing knowledge base documents...');
  try {
    await indexDocuments();
  } catch (error) {
    console.warn('Document indexing warning:', error instanceof Error ? error.message : error);
    console.log('Continuing without document indexing...');
  }

  const app = express();

  app.use(cors());
  app.use(express.json());

  app.use('/health', healthRouter);
  app.use('/chat', auth, chatRouter);
  app.use('/confirm', auth, confirmRouter);

  const server = app.listen(config.port, () => {
    console.log(`agent-service running on port ${config.port}`);
    console.log(`NVIDIA Model: ${config.nvidiaModel}`);
    console.log(`Embed Model: ${config.nvidiaEmbedModel}`);
    console.log(`ChromaDB: ${config.chromaDbUrl}`);
  });

  const shutdown = () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
      process.exit(0);
    });
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(error => {
  console.error('Fatal error during startup:', error);
  process.exit(1);
});