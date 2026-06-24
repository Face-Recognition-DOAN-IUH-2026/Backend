import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from './config';
import { errorHandler, setupProcessErrorHandlers } from '../shared/error-handler';
import {
  createJiraBug,
  getJiraIssue,
  searchJiraIssues,
  getIssueTransitions,
  transitionIssue,
  addComment,
} from '../shared/jira-client';
const app = express();
const corsOrigin = config.corsOrigins.length > 0 ? config.corsOrigins : false;

// Security headers
app.use(helmet());

app.use(cors({
  origin: corsOrigin,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}));

// Global rate limit per IP. In local/dev this is intentionally high because
// dashboards, SSE reconnects, and camera pages can share one browser IP.
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  skip: (req) => {
    if (config.nodeEnv === 'production') return false;
    return [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/refresh',
      '/api/patrons/login',
      '/api/patrons/register',
    ].some((path) => req.path === path);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', detail: 'Vượt quá giới hạn request, vui lòng thử lại sau' },
});

// Auth rate limiter — stricter, always active even in dev mode
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts', detail: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau 15 phút' },
});

// Face rate limiter — stricter than global, always active in production
const faceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,                    // 30 attempts per window
  skip: (req) => config.nodeEnv !== 'production',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many face recognition attempts', detail: 'Quá nhiều lần nhận diện, vui lòng thử lại sau' },
});

app.use(globalLimiter);

const preserveOriginalPath = (_path: string, req: any) => req.originalUrl || req.url;
const stripApiPrefixFromOriginalPath = (_path: string, req: any) => {
  const originalPath = req.originalUrl || req.url;
  return originalPath.replace(/^\/api/, '') || '/';
};

// ============================================================================
// CLEAN PREFIX-BASED ROUTING
// ============================================================================
// Rules:
//   /api/auth/*         → user-service (login, register, refresh)
//   /api/patrons/login  → user-service (patron login)
//   /api/patrons/register → user-service (patron register)
//   /api/patrons/me     → user-service (current patron)
//   /api/patrons/:id/password → user-service (change password)
//   /users/me           → user-service (current user)
//   /api/borrow/*       → borrow-service
//   /api/face/*         → face-recognition-service
//   /api/kiosk/*        → face-recognition-service
//   /api/camera/*       → face-recognition-service
//   /api/access/*       → access-service
//   /api/tasks/*        → face-recognition-service
//   /api/users/*        → face-recognition-service (admin: list/delete patrons)
//   /api/patrons/*      → face-recognition-service (CRUD + face enrollment)
//   /docs/*             → face-recognition-service (swagger docs)
// ============================================================================

// ---- USER-SERVICE (Auth, Patron Auth, User Info) ----

// Backward-compatible auth routes: /auth/login, /auth/register, /auth/refresh
app.use('/auth', authLimiter, createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: preserveOriginalPath,
}));

app.use('/api/auth/face-login', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// Auth routes: /api/auth/login, /api/auth/register, /api/auth/refresh
app.use('/api/auth', authLimiter, createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // /api/auth/login → /auth/login
}));

// Patron auth routes: login, register
app.use('/api/patrons/login', authLimiter, createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // → /patrons/login
}));

app.use('/api/patrons/register', authLimiter, createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // → /patrons/register
}));

// Patron self-info routes: /patrons/me, /patrons/:id/password
app.use('/api/patrons/me', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // → /patrons/me
}));

app.use('/api/patrons/:id/password', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // → /patrons/:id/password
}));

// User self-info: /users/me
app.use('/users/me', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: preserveOriginalPath,
}));

// ---- BORROW-SERVICE ----
app.use('/api/borrow', createProxyMiddleware({
  target: config.services.borrowService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // /api/borrow → /borrow
}));

app.use('/api/library', createProxyMiddleware({
  target: config.services.borrowService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // /api/library → /library
}));

app.use('/api/schedules', createProxyMiddleware({
  target: config.services.scheduleService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// ---- FACE-RECOGNITION-SERVICE ----

// Face operations
app.use('/api/face', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// Kiosk operations
app.use('/api/kiosk', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  timeout: 60000,
  proxyTimeout: 60000,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// Camera operations
app.use('/api/camera', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// Async tasks
app.use('/api/tasks', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// Access logs and realtime stream
const accessProxy = createProxyMiddleware({
  target: config.services.accessService,
  changeOrigin: true,
  ws: true,
  timeout: 0,
  proxyTimeout: 0,
  pathRewrite: stripApiPrefixFromOriginalPath,
});

app.use('/api/access', faceLimiter, accessProxy);

app.use('/api/ai', createProxyMiddleware({
  target: config.services.aiService,
  changeOrigin: true,
  timeout: 120000,
  proxyTimeout: 120000,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// Patron stats from user-service (must be before catch-all /api/patrons)
app.use('/api/patrons/stats', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// Patron CRUD + face enrollment (must be after specific routes above)
app.use('/api/patrons', createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// ---- NOTIFICATION-SERVICE ----
const notificationProxy = createProxyMiddleware({
  target: config.services.notificationService,
  changeOrigin: true,
  ws: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // /api/notifications → /notifications
});

app.use('/api/notifications', notificationProxy);

// ---- AUTOMATION-SERVICE ----
app.use('/api/automation', createProxyMiddleware({
  target: config.services.automationService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // /api/automation → /automation
}));

// Users admin routes (list/delete patrons with face status)
app.use('/api/users', createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// ============================================================================
// HEALTH CHECK & FRONTEND FALLBACK
// ============================================================================

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', gateway: 'Node.js-API-Gateway', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({
    name: 'Face Recognition Platform API Gateway',
    version: '1.0.0',
    gateway: 'Node.js',
    services: {
      userService: config.services.userService,
      faceRecognitionApi: config.services.faceRecognitionApi,
      borrowService: config.services.borrowService,
      scheduleService: config.services.scheduleService,
      accessService: config.services.accessService,
      aiService: config.services.aiService,
    },
  });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});

// Frontend - proxy all other requests to Next.js dev server
app.all('/*', (req, res) => {
  const targetUrl = new URL(req.originalUrl, config.frontendUrl);
  const options: http.RequestOptions = {
    hostname: targetUrl.hostname,
    port: parseInt(targetUrl.port) || 80,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {} as any,
  };

  const skipHeaders = ['host', 'connection'];
  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipHeaders.includes(key.toLowerCase())) {
      (options.headers as any)[key] = value;
    }
  }

  const proxyReq = http.request({ ...options, timeout: 0 }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error(`  Frontend proxy error: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Bad gateway', message: err.message });
    }
  });

  req.pipe(proxyReq, { end: true });
});

// ---- POST /errors/report — frontend/mobile error reporting endpoint ----
app.post('/errors/report', express.json({ limit: '100kb' }), async (req, res) => {
  try {
    const { title, description, priority, labels, service, endpoint, method, stacktrace, requestBody } = req.body;
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const issueUrl = await createJiraBug({
      title,
      description: description || title,
      priority: priority || 'Medium',
      labels: [...(labels || []), 'client-report'],
      service: service || 'frontend',
      endpoint,
      method,
      stacktrace,
      requestBody,
      userId: (req as any).user?.userId || (req as any).user?.sub,
      timestamp: new Date().toISOString(),
    });
    if (issueUrl) {
      res.json({ success: true, issueUrl });
    } else {
      res.json({ success: false, message: 'Jira disabled or rate limited' });
    }
  } catch (err: any) {
    console.error('[API-Gateway] Error report failed:', err.message);
    res.status(500).json({ error: 'Failed to report error' });
  }
});

// ---- JIRA READ ROUTES ----

// GET /api/jira/issue/:key - Get issue details
app.get('/api/jira/issue/:key', async (req, res) => {
  try {
    const issue = await getJiraIssue(req.params.key);
    if (issue) {
      res.json(issue);
    } else {
      res.status(404).json({ error: 'Issue not found or Jira disabled' });
    }
  } catch (err: any) {
    console.error('[API-Gateway] Jira issue fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch Jira issue' });
  }
});

// GET /api/jira/search - Search issues with JQL
app.get('/api/jira/search', async (req, res) => {
  try {
    const { jql, maxResults } = req.query;
    if (!jql) {
      res.status(400).json({ error: 'jql query parameter is required' });
      return;
    }
    const issues = await searchJiraIssues(jql as string, parseInt(maxResults as string) || 50);
    res.json({ issues, total: issues.length });
  } catch (err: any) {
    console.error('[API-Gateway] Jira search failed:', err.message);
    res.status(500).json({ error: 'Failed to search Jira issues' });
  }
});

// GET /api/jira/issue/:key/transitions - Get available transitions
app.get('/api/jira/issue/:key/transitions', async (req, res) => {
  try {
    const transitions = await getIssueTransitions(req.params.key);
    res.json({ transitions });
  } catch (err: any) {
    console.error('[API-Gateway] Jira transitions fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch transitions' });
  }
});

// POST /api/jira/issue/:key/transition - Transition issue status
app.post('/api/jira/issue/:key/transition', express.json(), async (req, res) => {
  try {
    const { transitionId } = req.body;
    if (!transitionId) {
      res.status(400).json({ error: 'transitionId is required' });
      return;
    }
    const success = await transitionIssue(req.params.key, transitionId);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to transition issue' });
    }
  } catch (err: any) {
    console.error('[API-Gateway] Jira transition failed:', err.message);
    res.status(500).json({ error: 'Failed to transition issue' });
  }
});

// POST /api/jira/issue/:key/comment - Add comment to issue
app.post('/api/jira/issue/:key/comment', express.json(), async (req, res) => {
  try {
    const { body } = req.body;
    if (!body) {
      res.status(400).json({ error: 'body is required' });
      return;
    }
    const success = await addComment(req.params.key, body);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to add comment' });
    }
  } catch (err: any) {
    console.error('[API-Gateway] Jira comment failed:', err.message);
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// ---- 404 handler ----
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// ---- Error handler ----
app.use(errorHandler);

const PORT = config.port;
setupProcessErrorHandlers();

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  if (config.nodeEnv !== 'production') {
    console.log('Routing: auth=user-service, borrow=borrow-service, access=access-service, face/camera=face-recognition-service');
  }
});

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/api/access/ws')) {
    accessProxy.upgrade(req, socket as any, head);
    return;
  }
  if (req.url?.startsWith('/notifications/ws')) {
    notificationProxy.upgrade(req, socket as any, head);
    return;
  }
  socket.destroy();
});

server.keepAliveTimeout = 120000; // 120s keep-alive (up from 60s to accommodate SSE keepalive)

const shutdown = async () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
