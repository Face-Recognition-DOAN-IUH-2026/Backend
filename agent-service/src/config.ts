import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

interface Config {
  port: number;
  nvidiaApiKey: string;
  nvidiaModel: string;
  nvidiaEmbedModel: string;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  chromaDbUrl: string;
  chromaCollection: string;
  accessServiceUrl: string;
  borrowServiceUrl: string;
  scheduleServiceUrl: string;
  userServiceUrl: string;
  internalApiKey: string;
}

function getRequiredEnvVar(name: string, defaultValue?: string): string {
  const value = process.env[name] || defaultValue;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getOptionalEnvVar(name: string, defaultValue: string): string {
  return process.env[name] || defaultValue;
}

const config: Config = {
  port: parseInt(getOptionalEnvVar('PORT', '3005'), 10),
  nvidiaApiKey: getOptionalEnvVar('NVIDIA_API_KEY', ''),
  nvidiaModel: getOptionalEnvVar('NVIDIA_MODEL', 'meta/llama-3.1-70b-instruct'),
  nvidiaEmbedModel: getOptionalEnvVar('NVIDIA_EMBED_MODEL', 'nvidia/nv-embedqa-e5-v5'),
  openrouterApiKey: getOptionalEnvVar('OPENROUTER_API_KEY', ''),
  openrouterBaseUrl: getOptionalEnvVar('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
  chromaDbUrl: getOptionalEnvVar('CHROMA_DB_URL', 'http://localhost:8000'),
  chromaCollection: getOptionalEnvVar('CHROMA_COLLECTION', 'library-kb'),
  accessServiceUrl: getRequiredEnvVar('ACCESS_SERVICE_URL'),
  borrowServiceUrl: getRequiredEnvVar('BORROW_SERVICE_URL'),
  scheduleServiceUrl: getRequiredEnvVar('SCHEDULE_SERVICE_URL'),
  userServiceUrl: getRequiredEnvVar('USER_SERVICE_URL'),
  internalApiKey: getRequiredEnvVar('INTERNAL_API_KEY'),
};

export default config;