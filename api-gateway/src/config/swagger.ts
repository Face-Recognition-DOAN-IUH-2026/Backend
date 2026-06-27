import axios from 'axios';
import swaggerJsdoc from 'swagger-jsdoc';
import { config } from '../config';

export interface ServiceEntry {
  name: string;
  url: string;
  /** Path prefix that the gateway adds before each service-internal path.
   *  Each service already has its own segment prefix internally:
   *  - user-service:          /auth/..., /patrons/..., /users/...  → gateway: /api/auth/..., /api/patrons/...
   *  - borrow-service:        /borrow/..., /library/...            → gateway: /api/borrow/..., /api/library/...
   *  - ai-service:            /ai/chat, /ai/confirm, /ai/...       → gateway: /api/ai/...
   *  - schedule-service:      /schedules/...                       → gateway: /api/schedules/...
   *  - access-service:        /access/...                          → gateway: /api/access/...
   *  - notification-service:  /notifications/...                   → gateway: /api/notifications/...
   *  - automation-service:    /automation/...                      → gateway: /api/automation/...
   *  - face-recognition-api:  /face/..., /kiosk/..., /patrons/...  → gateway: /api/face/..., /api/patrons/... (overridden by user-service above)
   */
  prefix: string;
  tag: string;
  description: string;
}

export const SERVICE_REGISTRY: ServiceEntry[] = [
  {
    name: 'user-service',
    url: config.services.userService,
    prefix: '/api',
    tag: 'Auth & Patrons',
    description: 'Authentication and patron management — login, register, token refresh, patron CRUD',
  },
  {
    name: 'borrow-service',
    url: config.services.borrowService,
    prefix: '/api',
    tag: 'Books & Borrowing',
    description: 'Book catalog, borrow records, slips, returns, overdue tracking, Excel import',
  },
  {
    name: 'schedule-service',
    url: config.services.scheduleService,
    prefix: '/api',
    tag: 'Schedules',
    description: 'Library operating hours and staff duty schedules',
  },
  {
    name: 'access-service',
    url: config.services.accessService,
    prefix: '/api',
    tag: 'Access Control',
    description: 'Physical gate access logs, real-time events, patron inside-library status',
  },
  {
    name: 'ai-service',
    url: config.services.aiService,
    prefix: '/api',
    tag: 'AI Assistant',
    description: 'AI chatbot powered by NVIDIA NIM — send messages, retrieve sessions, confirm pending actions',
  },
  {
    name: 'notification-service',
    url: config.services.notificationService,
    prefix: '/api',
    tag: 'Notifications',
    description: 'In-app and push notifications for patrons and staff',
  },
  {
    name: 'automation-service',
    url: config.services.automationService,
    prefix: '/api',
    tag: 'Automation',
    description: 'Automated library tasks — overdue reminders, membership expiry alerts, scheduled jobs',
  },
  {
    name: 'face-recognition-api',
    url: config.services.faceRecognitionApi,
    prefix: '/api',
    tag: 'Face Recognition',
    description: 'Face enrollment, kiosk check-in, camera operations, patron face management',
  },
];

export async function fetchAndMergeSpecs(): Promise<any> {
  const mergedPaths: Record<string, any> = {};
  const mergedSchemas: Record<string, any> = {};

  const baseTags: { name: string; description: string }[] = [
    { name: 'Auth', description: 'Admin/staff authentication — login, register, token refresh, password reset' },
    { name: 'Patrons', description: 'Library patron management — register, login, profile, card operations' },
    { name: 'Borrow', description: 'Book borrowing operations — create borrow, return, overdue tracking' },
    { name: 'Books', description: 'Book catalog — search, CRUD, copies, cover images, Excel/ISBN import' },
    { name: 'Library', description: 'Library-wide stats and operations' },
    { name: 'Schedules', description: 'Library operating hours and staff duty schedules' },
    { name: 'AI Assistant', description: 'AI chatbot — send messages, session history, confirm pending actions' },
    { name: 'Access Control', description: 'Gate access logs and patron inside-library status' },
    { name: 'Notifications', description: 'Push and in-app notifications' },
    { name: 'Automation', description: 'Automated tasks — overdue reminders, scheduled jobs' },
    { name: 'Face Recognition', description: 'Face enrollment, kiosk, camera operations' },
    { name: 'Jira', description: 'Internal Jira integration — issue lookup, transitions, comments (dev only)' },
    { name: 'Error Reporting', description: 'Client-side error reporting — creates Jira bugs automatically' },
  ];

  const results = await Promise.allSettled(
    SERVICE_REGISTRY.map(async (svc) => {
      const res = await axios.get(`${svc.url}/api-docs/swagger.json`, { timeout: 5000 });
      return { svc, spec: res.data };
    })
  );

  let successCount = 0;
  for (const result of results) {
    if (result.status === 'rejected') {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      console.warn(`[Swagger] Skipped service — ${reason.split('\n')[0]}`);
      continue;
    }
    const { svc, spec } = result.value;
    successCount++;

    if (spec.paths) {
      for (const [path, methods] of Object.entries(spec.paths) as [string, any][]) {
        // Each service's internal route already has its own prefix segment
        // (e.g. /auth/login, /borrow/books, /ai/chat)
        // The gateway maps /api/<that-segment> to the service.
        // So the full gateway path is: /api + internal_path
        const fullPath = `${svc.prefix}${path}`;
        // Avoid overwriting a more specific route already added (e.g. user-service vs face-recognition-api for /patrons)
        if (!mergedPaths[fullPath]) {
          mergedPaths[fullPath] = methods;
        }
      }
    }

    if (spec.components?.schemas) {
      Object.assign(mergedSchemas, spec.components.schemas);
    }
  }

  console.log(`[Swagger] Merged ${Object.keys(mergedPaths).length} paths from ${successCount}/${SERVICE_REGISTRY.length} services`);

  return {
    openapi: '3.0.0',
    info: {
      title: 'IUH Library System — Unified API',
      version: '1.0.0',
      description: `
## IUH Library System — Unified API Reference

This document covers **all microservices** routed through the API Gateway at \`http://localhost:3000\`.

### Authentication
Most endpoints require a **Bearer JWT token** in the Authorization header:
\`\`\`
Authorization: Bearer <token>
\`\`\`
Obtain a token via:
- **Staff/Admin**: \`POST /api/auth/login\`
- **Patron (mobile)**: \`POST /api/patrons/login\`

### Gateway Routing
| Service | Gateway Prefix | Internal Routes |
|---|---|---|
| user-service | \`/api/auth/*\`, \`/api/patrons/*\`, \`/api/users/*\` | Auth & patron management |
| borrow-service | \`/api/borrow/*\`, \`/api/library/*\` | Books, copies, borrow records |
| ai-service | \`/api/ai/*\` | AI chatbot, session management |
| schedule-service | \`/api/schedules/*\` | Operating hours, schedules |
| access-service | \`/api/access/*\` | Gate access logs |
| notification-service | \`/api/notifications/*\` | Push notifications |
| face-recognition-api | \`/api/face/*\`, \`/api/kiosk/*\`, \`/api/camera/*\` | Face recognition |
      `.trim(),
    },
    servers: [
      { url: '/', description: 'API Gateway (same origin)' },
    ],
    tags: baseTags,
    paths: mergedPaths,
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas: {
        Error: {
          type: 'object',
          description: 'Standard error response',
          properties: {
            error: { type: 'string', example: 'Unauthorized' },
            message: { type: 'string', example: 'Token không hợp lệ hoặc đã hết hạn' },
          },
        },
        ValidationError: {
          type: 'object',
          description: 'Validation error response',
          properties: {
            error: { type: 'string', example: 'Validation failed' },
            details: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
        ...mergedSchemas,
      },
    },
    security: [{ bearerAuth: [] }],
  };
}

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Gateway — Native Routes',
      version: '1.0.0',
      description: 'Routes handled natively by the API Gateway (Jira integration, error reporting)',
    },
    servers: [{ url: '/', description: 'API Gateway (same origin)' }],
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
