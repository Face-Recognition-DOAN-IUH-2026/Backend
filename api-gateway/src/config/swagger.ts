import axios from 'axios';
import swaggerJsdoc from 'swagger-jsdoc';
import { config } from '../config';

export interface ServiceEntry {
  name: string;
  url: string;
  prefix: string;
}

export const SERVICE_REGISTRY: ServiceEntry[] = [
  { name: 'user-service', url: config.services.userService, prefix: '/user' },
  { name: 'borrow-service', url: config.services.borrowService, prefix: '/borrow' },
  { name: 'schedule-service', url: config.services.scheduleService, prefix: '/schedule' },
  { name: 'access-service', url: config.services.accessService, prefix: '/access' },
  { name: 'ai-service', url: config.services.aiService, prefix: '/ai' },
  { name: 'notification-service', url: config.services.notificationService, prefix: '/notification' },
  { name: 'automation-service', url: config.services.automationService, prefix: '/automation' },
  { name: 'face-recognition-api', url: config.services.faceRecognitionApi, prefix: '/face' },
];

export async function fetchAndMergeSpecs(): Promise<any> {
  const mergedPaths: Record<string, any> = {};
  const mergedSchemas: Record<string, any> = {};
  const tags: { name: string }[] = [];

  const results = await Promise.allSettled(
    SERVICE_REGISTRY.map(async (svc) => {
      const res = await axios.get(`${svc.url}/api-docs/swagger.json`, { timeout: 5000 });
      return { svc, spec: res.data };
    })
  );

  for (const result of results) {
    if (result.status === 'rejected') continue;
    const { svc, spec } = result.value;

    tags.push({ name: svc.name });

    if (spec.paths) {
      for (const [path, methods] of Object.entries(spec.paths) as [string, any][]) {
        mergedPaths[`${svc.prefix}${path}`] = methods;
      }
    }

    if (spec.components?.schemas) {
      Object.assign(mergedSchemas, spec.components.schemas);
    }
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'IUH Library System — Unified API',
      version: '1.0.0',
      description: 'Unified API documentation for all IUH Library microservices',
    },
    servers: [{ url: '/', description: 'Local' }],
    tags,
    paths: mergedPaths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: mergedSchemas,
    },
    security: [{ bearerAuth: [] }],
  };
}

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'api-gateway API',
      version: '1.0.0',
      description: 'API documentation for API Gateway — proxy routing, Jira integration',
    },
    servers: [{ url: '/', description: 'Local' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/index.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
