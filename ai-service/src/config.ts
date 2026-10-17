import dotenv from 'dotenv';
dotenv.config();
import { requireServiceSecret } from '../../shared/config';

// Validate required secrets at startup
const jwtSecret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
const serviceJwtSecret = requireServiceSecret(process.env.SERVICE_JWT_SECRET, process.env.NODE_ENV || 'development');

if (!jwtSecret) {
  throw new Error('[Config] JWT_SECRET or JWT_ACCESS_SECRET must be set');
}

export const config = {
  port: parseInt(process.env.PORT || '3004', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret,
  jwtIssuer: process.env.JWT_ISSUER || 'face-recognition',
  jwtAudience: process.env.JWT_AUDIENCE || 'face-recognition-users',
  serviceJwtSecret,

  // Service URLs
  accessServiceUrl: process.env.ACCESS_SERVICE_URL || 'http://access-service:3003',
  borrowServiceUrl: process.env.BORROW_SERVICE_URL || 'http://borrow-service:8000',
  scheduleServiceUrl: process.env.SCHEDULE_SERVICE_URL || 'http://schedule-service:3002',
  userServiceUrl: process.env.USER_SERVICE_URL || 'http://user-service:3001',

  // OpenRouter (for AI Command Center)
  openRouter: {
    apiKey: process.env.OPENROUTER_API_KEY || '',
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4.1-mini',
    baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
  },

  // NVIDIA NIM (for Agent Chat)
  nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
  nvidiaModel: process.env.NVIDIA_MODEL || 'meta/llama-3.1-70b-instruct',
  nvidiaEmbedModel: process.env.NVIDIA_EMBED_MODEL || 'nvidia/nv-embedqa-e5-v5',

  // ChromaDB (for RAG)
  chromaDbUrl: process.env.CHROMA_DB_URL || 'http://localhost:8000',
  chromaCollection: process.env.CHROMA_COLLECTION || 'library-kb',

  // AI Command Center settings
  ai: {
    refreshMinutes: parseInt(process.env.AI_REFRESH_MINUTES || '15', 10),
    mockMode: (process.env.AI_MOCK_MODE || 'false').toLowerCase() === 'true',
  },

  // Database
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'aidb',
    schema: process.env.DB_SCHEMA || 'ai',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },

  corsOrigins: process.env.CORS_ORIGINS?.split(',') || [],

  // TTS (Text-to-Speech)
  tts: {
    provider: process.env.TTS_PROVIDER || 'mock',
    apiKey: process.env.TTS_API_KEY || '',
  },

  // ASR (Automatic Speech Recognition)
  asr: {
    provider: process.env.ASR_PROVIDER || 'mock',
    apiKey: process.env.ASR_API_KEY || '',
  },
};
