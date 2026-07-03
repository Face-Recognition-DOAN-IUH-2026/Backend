"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const config_1 = require("./config");
const data_source_1 = require("./data-source");
const ai_routes_1 = __importDefault(require("./routes/ai.routes"));
const chat_1 = __importDefault(require("./routes/chat"));
const confirm_1 = __importDefault(require("./routes/confirm"));
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_1 = require("./config/swagger");
const error_handler_1 = require("../../shared/error-handler");
const shared_1 = require("../../shared");
const chromadb_1 = require("./clients/chromadb");
const indexer_1 = require("./rag/indexer");
const sessions_1 = require("./sessions");
const auth = (0, shared_1.createAuth)({
    jwtSecret: config_1.config.jwtSecret,
    jwtAudience: config_1.config.jwtAudience,
    jwtIssuer: config_1.config.jwtIssuer,
});
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: config_1.config.corsOrigins.includes('*') ? true : config_1.config.corsOrigins, credentials: true }));
app.use(express_1.default.json({ limit: '1mb' }));
// Health check (no auth) - both /health and /ai/health
app.get('/health', async (_req, res) => {
    let chromaOk = false;
    let chromaCount = 0;
    try {
        const collection = await (0, chromadb_1.getCollection)();
        chromaCount = await collection.count();
        chromaOk = true;
    }
    catch { }
    res.json({
        status: 'ok',
        service: 'ai-service',
        mockMode: config_1.config.ai.mockMode,
        chromadb: { connected: chromaOk, documents: chromaCount },
    });
});
app.get('/ai/health', async (_req, res) => {
    let chromaOk = false;
    let chromaCount = 0;
    try {
        const collection = await (0, chromadb_1.getCollection)();
        chromaCount = await collection.count();
        chromaOk = true;
    }
    catch { }
    res.json({
        status: 'ok',
        service: 'ai-service',
        mockMode: config_1.config.ai.mockMode,
        chromadb: { connected: chromaOk, documents: chromaCount },
    });
});
// Agent chat routes (authenticated users) - /ai/chat, /ai/confirm, /ai/chat/sessions/*
// Must be BEFORE /ai to avoid requireRole middleware in aiRoutes blocking patron access
app.use('/ai/chat', auth, chat_1.default);
app.use('/ai/confirm', auth, confirm_1.default);
// AI Command Center routes (admin/staff only) - /ai/command-center/*, /ai/insights/*, /ai/recommendations/*
app.use('/ai', auth, ai_routes_1.default);
// Session retrieval - /ai/sessions/:sessionId
app.get('/ai/sessions/:sessionId', auth, (req, res) => {
    const session = sessions_1.sessionStore.get(req.params.sessionId);
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
app.use('/chat', auth, chat_1.default);
app.use('/confirm', auth, confirm_1.default);
if (config_1.config.nodeEnv !== 'production') {
    app.get('/api-docs/swagger.json', (_req, res) => {
        res.json(swagger_1.swaggerSpec);
    });
    app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(swagger_1.swaggerSpec));
}
app.use(error_handler_1.errorHandler);
async function start() {
    try {
        // Initialize PostgreSQL
        console.log('Connecting to PostgreSQL...');
        await data_source_1.AppDataSource.initialize();
        console.log('PostgreSQL connected');
        // Initialize ChromaDB
        console.log('Connecting to ChromaDB...');
        try {
            const collection = await (0, chromadb_1.getCollection)();
            const count = await collection.count();
            console.log(`ChromaDB connected. Collection "${config_1.config.chromaCollection}" has ${count} documents.`);
        }
        catch (error) {
            console.warn('ChromaDB connection warning:', error instanceof Error ? error.message : error);
            console.log('Continuing without ChromaDB connection...');
        }
        // Index knowledge base documents
        console.log('Indexing knowledge base documents...');
        try {
            await (0, indexer_1.indexDocuments)();
        }
        catch (error) {
            console.warn('Document indexing warning:', error instanceof Error ? error.message : error);
            console.log('Continuing without document indexing...');
        }
        (0, error_handler_1.setupProcessErrorHandlers)();
        const server = app.listen(config_1.config.port, '0.0.0.0', () => {
            console.log(`AI service running on port ${config_1.config.port}`);
            console.log(`  Command Center: /ai/command-center/*`);
            console.log(`  Agent Chat: /chat, /confirm`);
            console.log(`  LLM (OpenRouter): ${config_1.config.openRouter.model}`);
            console.log(`  LLM (NVIDIA NIM): ${config_1.config.nvidiaModel}`);
        });
        const shutdown = async () => {
            console.log('SIGTERM received, shutting down gracefully');
            server.close(async () => {
                await data_source_1.AppDataSource.destroy();
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
    }
    catch (error) {
        console.error('Failed to start ai-service:', error);
        process.exit(1);
    }
}
start();
