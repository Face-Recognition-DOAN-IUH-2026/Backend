import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import { config } from './config';
import { AppDataSource } from './data-source';
import aiRoutes from './routes/ai.routes';
import chatRouter from './routes/chat';
import confirmRouter from './routes/confirm';
import cardParserRouter from './routes/card-parser';
import patronChatRouter from './routes/chat.patron';
import staffChatRouter from './routes/chat.staff';
import adminChatRouter from './routes/chat.admin';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger';
import { errorHandler, setupProcessErrorHandlers } from '../../shared/error-handler';
import { createAuth, requireRole } from '../../shared';
import { getCollection } from './clients/chromadb';
import { indexDocuments } from './rag/indexer';
import { sessionStore } from './sessions';

const auth = createAuth({
  jwtSecret: config.jwtSecret,
  jwtAudience: config.jwtAudience,
  jwtIssuer: config.jwtIssuer,
});

const app = express();

app.use(cors({ origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));

// Health check (no auth) - both /health and /ai/health
app.get('/health', async (_req, res) => {
  let chromaOk = false;
  let chromaCount = 0;
  try {
    const collection = await getCollection('patron');
    chromaCount = await collection.count();
    chromaOk = true;
  } catch {}
  res.json({
    status: 'ok',
    service: 'ai-service',
    mockMode: config.ai.mockMode,
    chromadb: { connected: chromaOk, documents: chromaCount },
  });
});

app.get('/ai/health', async (_req, res) => {
  let chromaOk = false;
  let chromaCount = 0;
  try {
    const collection = await getCollection('patron');
    chromaCount = await collection.count();
    chromaOk = true;
  } catch {}
  res.json({
    status: 'ok',
    service: 'ai-service',
    mockMode: config.ai.mockMode,
    chromadb: { connected: chromaOk, documents: chromaCount },
  });
});

// Role-specific chat routes (NEW: role-isolated tool registries)
app.use('/ai/patrons/chat', auth, requireRole(['patron']), patronChatRouter);
app.use('/ai/staff/chat', auth, requireRole(['admin', 'staff']), staffChatRouter);
app.use('/ai/admin/chat', auth, requireRole(['admin']), adminChatRouter);

// Legacy routes (backward compatibility — same endpoints, same auth)
app.use('/ai/chat', auth, chatRouter);
app.use('/ai/confirm', auth, confirmRouter);

// Card text parsing (OCR result -> structured data via LLM)
app.use('/ai', auth, cardParserRouter);

// AI Command Center routes (admin/staff only) - /ai/command-center/*, /ai/insights/*, /ai/recommendations/*
app.use('/ai', auth, aiRoutes);

// Session retrieval - /ai/sessions/:sessionId
app.get('/ai/sessions/:sessionId', auth, (req, res) => {
  const session = sessionStore.get(req.params.sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({
    sessionId: session.id,
    patronId: session.patronId,
    messages: session.messages,
    pendingConfirmation: session.pendingConfirmation,
  });
});

// Backward compat: /chat, /confirm
app.use('/chat', auth, chatRouter);
app.use('/confirm', auth, confirmRouter);

if (config.nodeEnv !== 'production') {
  app.get('/api-docs/swagger.json', (_req, res) => {
    res.json(swaggerSpec);
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
}

app.use(errorHandler);

async function start() {
  try {
    // Initialize PostgreSQL
    console.log('Connecting to PostgreSQL...');
    await AppDataSource.initialize();
    console.log('PostgreSQL connected');

    // Initialize ChromaDB
    console.log('Connecting to ChromaDB...');
    try {
      const collection = await getCollection('patron');
      const count = await collection.count();
      console.log(`ChromaDB connected. Collection "${config.chromaCollection}" has ${count} documents.`);
    } catch (error) {
      console.warn('ChromaDB connection warning:', error instanceof Error ? error.message : error);
      console.log('Continuing without ChromaDB connection...');
    }

    // Index knowledge base documents
    console.log('Indexing knowledge base documents...');
    try {
      await indexDocuments();
    } catch (error) {
      console.warn('Document indexing warning:', error instanceof Error ? error.message : error);
      console.log('Continuing without document indexing...');
    }

    setupProcessErrorHandlers();
    const server = app.listen(config.port, '0.0.0.0', () => {
      console.log(`AI service running on port ${config.port}`);
      console.log(`  Patron Chat:   /ai/patrons/chat (requireRole: patron)`);
      console.log(`  Staff Chat:    /ai/staff/chat (requireRole: admin, staff)`);
      console.log(`  Admin Chat:    /ai/admin/chat (requireRole: admin)`);
      console.log(`  Legacy Chat:   /ai/chat (backward compat)`);
      console.log(`  Command Center: /ai/command-center/*`);
      console.log(`  LLM (OpenRouter): ${config.openRouter.model}`);
      console.log(`  LLM (NVIDIA NIM): ${config.nvidiaModel}`);
    });

    const shutdown = async () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(async () => {
        await AppDataSource.destroy();
        console.log('Database connections closed');
        process.exit(0);
      });
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (error) {
    console.error('Failed to start ai-service:', error);
    process.exit(1);
  }
}

start();
