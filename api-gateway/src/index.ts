import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from './config';
import xss from 'xss';
import { errorHandler, setupProcessErrorHandlers } from '../../shared/error-handler';
import {
  createJiraBug,
  getJiraIssue,
  searchJiraIssues,
  getIssueTransitions,
  transitionIssue,
  addComment,
} from '../../shared/jira-client';
const app = express();
app.set('trust proxy', 1);

const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (config.corsOrigins.includes('*')) return true;
  const configured = config.corsOrigins.map((o) => o.trim()).filter(Boolean);
  if (configured.includes(origin)) return true;
  // Allow all Vercel domains (*.vercel.app)
  if (/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/i.test(origin)) return true;
  // Allow DuckDNS domains (*.duckdns.org)
  if (/^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.duckdns\.org(:\d+)?$/i.test(origin)) return true;
  // Allow localhost & local IP
  if (/^https?:\/\/localhost(:\d+)?$/i.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/i.test(origin)) return true;
  return false;
};

// Security headers
app.use(helmet());
app.use(cookieParser());

app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  credentials: true,
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
      '/api/auth/refresh',
      '/api/patrons/login',
    ].some((path) => req.path === path);
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', detail: 'Vượt quá giới hạn request, vui lòng thử lại sau' },
});

// Auth rate limiter — relaxed during development
const authLimiter = rateLimit({
  windowMs: config.nodeEnv === 'production' ? 15 * 60 * 1000 : 60 * 1000,
  max: config.nodeEnv === 'production' ? 20 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts', detail: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau' },
});

// Face rate limiter — active only in production
const faceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  skip: (req) => config.nodeEnv !== 'production',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many face recognition attempts', detail: 'Quá nhiều lần nhận diện, vui lòng thử lại sau' },
});

// Error report rate limiter — prevent spam
const errorReportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                    // 10 reports per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many error reports', detail: 'Quá nhiều báo lỗi, vui lòng thử lại sau' },
});

export function sanitizeInput(input: string): string {
  if (!input) return '';
  return xss(input, {
    whiteList: {},
    stripIgnoreTag: true,
    stripIgnoreTagBody: ['script', 'style'],
  });
}

export function verifyToken(req: express.Request, res: express.Response, next: express.NextFunction) {
  let token: string | null = null;
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.cookies?.access_token) {
    token = req.cookies.access_token;
  }

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const secret = process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
    if (!secret) {
      res.status(500).json({ error: 'JWT secret not configured' });
      return;
    }
    const payload = jwt.verify(token, secret) as any;
    (req as any).user = payload;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

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
//   /api/auth/*         → user-service (login, refresh)
//   /api/patrons/login  → user-service (patron login)
//   /api/patrons/template, /import → user-service (librarian batch Excel import)
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

// Patron auth routes: login
app.use('/api/patrons/login', authLimiter, createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // → /patrons/login
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

app.use('/api/patrons/:id/restore', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // → /patrons/:id/restore
}));

app.use('/api/patrons/:id/card', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,  // → /patrons/:id/card/*
}));

// User self-info: /users/me
app.use('/users/me', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: preserveOriginalPath,
}));

// Permissions routes: /api/permissions and /permissions → user-service
app.use('/api/permissions', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath, // /api/permissions/* → /permissions/*
}));

app.use('/permissions', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: preserveOriginalPath,
}));

// ---- BORROW-SERVICE ----
// Direct callback aliases for payment providers without /api prefix
app.use('/borrow/sepay', createProxyMiddleware({
  target: config.services.borrowService,
  changeOrigin: true,
  pathRewrite: preserveOriginalPath,
}));

app.use('/borrow/payments', createProxyMiddleware({
  target: config.services.borrowService,
  changeOrigin: true,
  pathRewrite: preserveOriginalPath,
}));

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

const aiProxyOpts = {
  target: config.services.aiService,
  changeOrigin: true,
  timeout: 120000,
  proxyTimeout: 120000,
  pathRewrite: stripApiPrefixFromOriginalPath,
};

const aiSSEProxyOpts = {
  target: config.services.aiService,
  changeOrigin: true,
  timeout: 0,
  proxyTimeout: 0,
  pathRewrite: stripApiPrefixFromOriginalPath,
  on: {
    proxyReq: (proxyReq: any) => {
      proxyReq.setHeader('X-Legacy-Routed', 'true');
    },
  },
};

const patronAiLimiter = rateLimit({ windowMs: 60000, max: 60, message: { error: 'Too many requests from patron' } });
const staffAiLimiter = rateLimit({ windowMs: 60000, max: 120, message: { error: 'Too many requests from staff' } });
const adminAiLimiter = rateLimit({ windowMs: 60000, max: 200, message: { error: 'Too many requests from admin' } });

app.use('/api/ai/companion/stream', createProxyMiddleware(aiSSEProxyOpts));
app.use('/api/ai/patrons', patronAiLimiter, createProxyMiddleware(aiProxyOpts));
app.use('/api/ai/staff', staffAiLimiter, createProxyMiddleware(aiProxyOpts));
app.use('/api/ai/admin', adminAiLimiter, createProxyMiddleware(aiProxyOpts));

// AI catch-all — all /api/ai/* requests route to ai-service with legacy-routed header
app.use('/api/ai', createProxyMiddleware({
  ...aiProxyOpts,
  on: {
    proxyReq: (proxyReq) => {
      proxyReq.setHeader('X-Legacy-Routed', 'true');
    },
  },
}));

// Patron search from face-recognition-service (converts camelCase → snake_case)
app.use('/api/patrons/search', createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// Patron stats from user-service (must be before catch-all /api/patrons)
app.use('/api/patrons/stats', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

// Patron batch import Excel template & execution from user-service
app.use('/api/patrons/template', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

app.use('/api/patrons/import/preview', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath,
}));

app.use('/api/patrons/import', createProxyMiddleware({
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
// Specific routes first, then catch-all
app.use('/api/users/me', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath, // /api/users/me → /users/me
}));
app.use('/api/users/:id', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: stripApiPrefixFromOriginalPath, // /api/users/:id → /users/:id
}));
app.use('/api/users', createProxyMiddleware({
  target: config.services.userService,
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

app.get('/api/healthz', (_req, res) => {
  res.json({ status: 'ok', gateway: 'Node.js-API-Gateway', timestamp: new Date().toISOString() });
});

// ---- POST /errors/report — frontend/mobile error reporting endpoint ----
/**
 * @swagger
 * /errors/report:
 *   post:
 *     summary: Report frontend/mobile errors
 *     tags: [Error Reporting]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - service
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               priority:
 *                 type: string
 *                 enum: [Highest, High, Medium, Low]
 *               service:
 *                 type: string
 *               endpoint:
 *                 type: string
 *               method:
 *                 type: string
 *               stacktrace:
 *                 type: string
 *               requestBody:
 *                 type: string
 *     responses:
 *       200:
 *         description: Error reported and Jira bug created
 *       400:
 *         description: Missing required fields
 */
app.post('/errors/report', errorReportLimiter, verifyToken, express.json({ limit: '100kb' }), async (req, res) => {
  try {
    const { title, description, priority, labels, service, endpoint, method, stacktrace, requestBody } = req.body;
    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    const issueUrl = await createJiraBug({
      title: sanitizeInput(title),
      description: sanitizeInput(description || title),
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
/**
 * @swagger
 * /api/jira/issue/{key}:
 *   get:
 *     summary: Get Jira issue details
 *     tags: [Jira]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *         example: LIB-235
 *     responses:
 *       200:
 *         description: Issue details
 *       404:
 *         description: Issue not found
 */
app.get('/api/jira/issue/:key', verifyToken, async (req, res) => {
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
/**
 * @swagger
 * /api/jira/search:
 *   get:
 *     summary: Search Jira issues with JQL
 *     tags: [Jira]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: jql
 *         required: true
 *         schema:
 *           type: string
 *         example: "project = LIB AND status = Done"
 *       - in: query
 *         name: maxResults
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Search results
 *       400:
 *         description: Missing jql parameter
 */
app.get('/api/jira/search', verifyToken, async (req, res) => {
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
/**
 * @swagger
 * /api/jira/issue/{key}/transitions:
 *   get:
 *     summary: Get available transitions for a Jira issue
 *     tags: [Jira]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of available transitions
 */
app.get('/api/jira/issue/:key/transitions', verifyToken, async (req, res) => {
  try {
    const transitions = await getIssueTransitions(req.params.key);
    res.json({ transitions });
  } catch (err: any) {
    console.error('[API-Gateway] Jira transitions fetch failed:', err.message);
    res.status(500).json({ error: 'Failed to fetch transitions' });
  }
});

// POST /api/jira/issue/:key/transition - Transition issue status
/**
 * @swagger
 * /api/jira/issue/{key}/transition:
 *   post:
 *     summary: Transition a Jira issue to a new status
 *     tags: [Jira]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - transitionId
 *             properties:
 *               transitionId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Transition successful
 *       400:
 *         description: Missing transitionId
 */
app.post('/api/jira/issue/:key/transition', verifyToken, express.json(), async (req, res) => {
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
/**
 * @swagger
 * /api/jira/issue/{key}/comment:
 *   post:
 *     summary: Add a comment to a Jira issue
 *     tags: [Jira]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: key
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - body
 *             properties:
 *               body:
 *                 type: string
 *     responses:
 *       200:
 *         description: Comment added
 *       400:
 *         description: Missing body
 */
app.post('/api/jira/issue/:key/comment', verifyToken, express.json(), async (req, res) => {
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

// Resolve the frontend proxy target. Refuses anything that would leave the
// configured frontend origin: protocol-relative (`//host/x`) and
// backslash-normalized paths resolve off-origin under `new URL`.
function resolveFrontendTarget(originalUrl: string, frontendUrl: string): URL | null {
  if (!originalUrl || !originalUrl.startsWith('/') || originalUrl.startsWith('//')) return null;
  try {
    const base = new URL(frontendUrl);
    const target = new URL(originalUrl, base);
    return target.origin === base.origin ? target : null;
  } catch {
    return null;
  }
}

// Frontend - proxy all other requests to Next.js dev server.
// Registered AFTER all explicit routes (/errors/report, /api/jira/*) so the
// catch-all cannot shadow them.
app.all('/*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found', message: `API route ${req.path} not configured in gateway` });
  }

  const targetUrl = resolveFrontendTarget(req.originalUrl, config.frontendUrl);
  if (!targetUrl) {
    return res.status(400).json({ error: 'Invalid target path' });
  }

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

// ---- 404 handler ----
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// ---- Error handler ----
app.use(errorHandler);

const PORT = config.port;
setupProcessErrorHandlers();

function setupServerHandlers(server: ReturnType<typeof app.listen>) {
  server.setMaxListeners(50);
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
  server.keepAliveTimeout = 120000;
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
}

if (config.nodeEnv !== 'test') {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 API Gateway running on port ${PORT}`);
    if (config.nodeEnv !== 'production') {
      console.log('Routing: auth=user-service, borrow=borrow-service, access=access-service, face/camera=face-recognition-service');
    }
  });
  setupServerHandlers(server);
}

export { app };
