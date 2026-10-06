import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from './config';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec, fetchAndMergeSpecs } from './config/swagger';
import xss from 'xss';

let unifiedSpec: Record<string, any> = swaggerSpec;
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
const corsOrigin = config.corsOrigins.includes('*') ? true : config.corsOrigins.length > 0 ? config.corsOrigins : false;

// Security headers
app.use(helmet());
app.use(cookieParser());

app.use(cors({
  origin: corsOrigin,
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

// ---- Swagger docs (dev only) — setup swagger.json endpoint early ----
if (config.nodeEnv !== 'production') {
  // ---- /api-docs/swagger.json: fetch specs on demand (with 10s cache) ----
  // This avoids the race condition where gateway starts before other services are ready.
  let specCache: { spec: any; fetchedAt: number } | null = null;
  const SPEC_CACHE_TTL_MS = 10_000; // 10 seconds

  async function getUnifiedSpec() {
    const now = Date.now();
    if (specCache && (now - specCache.fetchedAt) < SPEC_CACHE_TTL_MS) {
      return specCache.spec;
    }
    try {
      const merged = await fetchAndMergeSpecs();
      // Patch the in-memory spec used by swagger-ui middleware
      unifiedSpec.openapi = merged.openapi;
      unifiedSpec.info = merged.info;
      unifiedSpec.servers = merged.servers;
      unifiedSpec.tags = merged.tags;
      unifiedSpec.paths = merged.paths;
      unifiedSpec.components = merged.components;
      unifiedSpec.security = merged.security;
      specCache = { spec: merged, fetchedAt: now };
      return merged;
    } catch (err) {
      // Return stale cache if available, otherwise return current unifiedSpec
      return specCache?.spec ?? unifiedSpec;
    }
  }

  app.get('/api-docs/swagger.json', async (_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const spec = await getUnifiedSpec();
    res.json(spec);
  });

  // Manual reload endpoint — forces re-fetch bypassing cache
  app.get('/api-docs/reload', async (_req, res) => {
    specCache = null; // invalidate cache
    const spec = await getUnifiedSpec();
    res.json({ ok: true, paths: Object.keys(spec.paths).length, message: `Reloaded — ${Object.keys(spec.paths).length} paths merged` });
  });

  // Bypass CSP for swagger resources (dev-only)
  app.use('/api-docs', (_req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    next();
  });
  app.use('/swagger-ui-dist', (_req, res, next) => {
    res.removeHeader('Content-Security-Policy');
    next();
  });

  // Serve swagger-ui-dist static files (JS, CSS, favicons)
  const swaggerUiDistPath = require('swagger-ui-dist').getAbsoluteFSPath();
  app.use('/swagger-ui-dist', express.static(swaggerUiDistPath, { index: false }));

  // Custom premium Swagger UI — dark theme, persistent auth, IUH Library branding
  app.get('/api-docs', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IUH Library API — Unified Swagger</title>
  <link rel="stylesheet" href="/swagger-ui-dist/swagger-ui.css" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>
    :root {
      --iuh-primary: #1a73e8;
      --iuh-primary-dark: #1557b0;
      --iuh-accent: #34a853;
      --iuh-bg: #0f172a;
      --iuh-surface: #1e293b;
      --iuh-surface2: #273549;
      --iuh-border: #334155;
      --iuh-text: #e2e8f0;
      --iuh-text-muted: #94a3b8;
      --iuh-danger: #ef4444;
      --iuh-warning: #f59e0b;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--iuh-bg); font-family: 'Inter', -apple-system, sans-serif; color: var(--iuh-text); }
    .iuh-header { background: linear-gradient(135deg, #1a1f3a 0%, #0f172a 40%, #1a2744 100%); border-bottom: 1px solid var(--iuh-border); padding: 0 24px; display: flex; align-items: center; gap: 16px; height: 64px; position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 24px rgba(0,0,0,0.4); }
    .iuh-header-logo { width: 36px; height: 36px; background: linear-gradient(135deg, var(--iuh-primary), var(--iuh-accent)); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; color: white; flex-shrink: 0; }
    .iuh-header-title { flex: 1; }
    .iuh-header-title h1 { margin: 0; font-size: 17px; font-weight: 700; color: var(--iuh-text); letter-spacing: -0.3px; }
    .iuh-header-title p { margin: 0; font-size: 12px; color: var(--iuh-text-muted); }
    .iuh-badge { background: rgba(52,168,83,0.15); border: 1px solid rgba(52,168,83,0.3); color: var(--iuh-accent); padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; letter-spacing: 0.5px; }
    .iuh-auth-bar { background: var(--iuh-surface); border-bottom: 1px solid var(--iuh-border); padding: 12px 24px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .iuh-auth-label { font-size: 12px; font-weight: 600; color: var(--iuh-text-muted); text-transform: uppercase; letter-spacing: 0.5px; white-space: nowrap; }
    .iuh-token-input { flex: 1; min-width: 280px; background: var(--iuh-bg); border: 1px solid var(--iuh-border); border-radius: 8px; padding: 8px 12px; color: var(--iuh-text); font-family: 'JetBrains Mono', monospace; font-size: 12px; outline: none; transition: border-color 0.2s; }
    .iuh-token-input:focus { border-color: var(--iuh-primary); }
    .iuh-token-input::placeholder { color: var(--iuh-text-muted); }
    .iuh-btn { background: var(--iuh-primary); color: white; border: none; border-radius: 8px; padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background 0.2s, transform 0.1s; white-space: nowrap; }
    .iuh-btn:hover { background: var(--iuh-primary-dark); }
    .iuh-btn:active { transform: scale(0.97); }
    .iuh-btn-secondary { background: transparent; border: 1px solid var(--iuh-border); color: var(--iuh-text-muted); border-radius: 8px; padding: 8px 14px; font-size: 13px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
    .iuh-btn-secondary:hover { border-color: var(--iuh-text-muted); color: var(--iuh-text); }
    .iuh-auth-status { font-size: 12px; padding: 4px 10px; border-radius: 20px; font-weight: 600; white-space: nowrap; }
    .iuh-auth-status.active { background: rgba(52,168,83,0.15); border: 1px solid rgba(52,168,83,0.3); color: var(--iuh-accent); }
    .iuh-auth-status.inactive { background: rgba(100,116,139,0.1); border: 1px solid var(--iuh-border); color: var(--iuh-text-muted); }
    .iuh-guide { background: rgba(26,115,232,0.08); border-left: 3px solid var(--iuh-primary); margin: 16px 24px; padding: 12px 16px; border-radius: 0 8px 8px 0; font-size: 13px; color: var(--iuh-text-muted); display: flex; gap: 24px; flex-wrap: wrap; }
    .iuh-guide-item { display: flex; align-items: center; gap: 6px; }
    .iuh-guide-item code { background: rgba(255,255,255,0.08); padding: 2px 6px; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--iuh-text); }
    /* Dark theme overrides */
    #swagger-ui { padding: 0 8px 32px; }
    .swagger-ui { color: var(--iuh-text) !important; }
    .swagger-ui .topbar { display: none !important; }
    .swagger-ui .info .title { color: var(--iuh-text) !important; font-family: 'Inter', sans-serif !important; }
    .swagger-ui .info .description, .swagger-ui .info p, .swagger-ui .info li, .swagger-ui .info table { color: var(--iuh-text-muted) !important; }
    .swagger-ui .info h1, .swagger-ui .info h2, .swagger-ui .info h3 { color: var(--iuh-text) !important; }
    .swagger-ui .scheme-container, .swagger-ui .wrapper { background: transparent !important; padding: 0 !important; }
    .swagger-ui .opblock-tag { color: var(--iuh-text) !important; border-bottom: 1px solid var(--iuh-border) !important; font-family: 'Inter', sans-serif !important; font-size: 16px !important; font-weight: 600 !important; }
    .swagger-ui .opblock-tag:hover { background: rgba(255,255,255,0.03) !important; }
    .swagger-ui .opblock { background: var(--iuh-surface) !important; border: 1px solid var(--iuh-border) !important; border-radius: 8px !important; margin: 6px 0 !important; }
    .swagger-ui .opblock .opblock-summary { border-radius: 8px !important; }
    .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #2563eb !important; }
    .swagger-ui .opblock.opblock-get .opblock-summary-method { background: #16a34a !important; }
    .swagger-ui .opblock.opblock-put .opblock-summary-method { background: #ca8a04 !important; }
    .swagger-ui .opblock.opblock-delete .opblock-summary-method { background: #dc2626 !important; }
    .swagger-ui .opblock.opblock-patch .opblock-summary-method { background: #7c3aed !important; }
    .swagger-ui .opblock-summary-method { border-radius: 6px !important; font-family: 'JetBrains Mono', monospace !important; font-size: 11px !important; font-weight: 700 !important; min-width: 60px !important; }
    .swagger-ui .opblock-summary-path { color: var(--iuh-text) !important; font-family: 'JetBrains Mono', monospace !important; font-size: 13px !important; }
    .swagger-ui .opblock-summary-description { color: var(--iuh-text-muted) !important; font-size: 13px !important; }
    .swagger-ui .opblock-body, .swagger-ui .opblock-section { background: var(--iuh-surface2) !important; }
    .swagger-ui .model-box, .swagger-ui .model { background: var(--iuh-surface2) !important; }
    .swagger-ui .model-title, .swagger-ui .model-toggle { color: var(--iuh-text) !important; }
    .swagger-ui textarea, .swagger-ui input[type=text], .swagger-ui input[type=password] { background: var(--iuh-bg) !important; color: var(--iuh-text) !important; border: 1px solid var(--iuh-border) !important; border-radius: 6px !important; }
    .swagger-ui .btn { background: var(--iuh-primary) !important; color: white !important; border: none !important; border-radius: 6px !important; }
    .swagger-ui .btn.cancel { background: transparent !important; border: 1px solid var(--iuh-border) !important; color: var(--iuh-text-muted) !important; }
    .swagger-ui .btn.authorize { background: var(--iuh-accent) !important; }
    .swagger-ui select { background: var(--iuh-bg) !important; color: var(--iuh-text) !important; border: 1px solid var(--iuh-border) !important; }
    .swagger-ui .parameter__name, .swagger-ui .parameter__type { color: var(--iuh-text) !important; }
    .swagger-ui table thead tr td, .swagger-ui table thead tr th { color: var(--iuh-text-muted) !important; border-bottom: 1px solid var(--iuh-border) !important; }
    .swagger-ui .response-col_status { color: var(--iuh-text) !important; }
    .swagger-ui .response-col_description { color: var(--iuh-text-muted) !important; }
    .swagger-ui .highlight-code { background: var(--iuh-bg) !important; border-radius: 6px !important; }
    .swagger-ui .auth-container { background: var(--iuh-surface2) !important; border: 1px solid var(--iuh-border) !important; border-radius: 8px !important; }
    .swagger-ui .dialog-ux .modal-ux { background: var(--iuh-surface) !important; border: 1px solid var(--iuh-border) !important; border-radius: 12px !important; box-shadow: 0 20px 60px rgba(0,0,0,0.6) !important; }
    .swagger-ui .dialog-ux .modal-ux-header { background: var(--iuh-surface2) !important; border-bottom: 1px solid var(--iuh-border) !important; border-radius: 12px 12px 0 0 !important; }
    .swagger-ui .dialog-ux .modal-ux-header h3 { color: var(--iuh-text) !important; }
    .swagger-ui section h3 { color: var(--iuh-text) !important; }
    .swagger-ui .prop-type { color: #60a5fa !important; }
    .swagger-ui .prop-format { color: var(--iuh-text-muted) !important; }
    .swagger-ui .example-value-wrapper { background: var(--iuh-bg) !important; border-radius: 6px !important; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: var(--iuh-surface); }
    ::-webkit-scrollbar-thumb { background: var(--iuh-border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--iuh-text-muted); }
  </style>
</head>
<body>
  <div class="iuh-header">
    <div class="iuh-header-logo">📚</div>
    <div class="iuh-header-title">
      <h1>IUH Library System — API Reference</h1>
      <p>Unified documentation for all microservices · API Gateway v1.0</p>
    </div>
    <span class="iuh-badge">DEV</span>
  </div>
  <div class="iuh-auth-bar">
    <span class="iuh-auth-label">🔑 Bearer Token</span>
    <input id="token-input" class="iuh-token-input" type="text" placeholder="Paste your JWT token here (from POST /api/auth/login or POST /api/patrons/login)" autocomplete="off" />
    <button class="iuh-btn" onclick="applyToken()">Authorize All</button>
    <button class="iuh-btn-secondary" onclick="clearToken()">Clear</button>
    <span id="auth-status" class="iuh-auth-status inactive">Not authorized</span>
  </div>
  <div class="iuh-guide">
    <span style="color: var(--iuh-text); font-weight: 600; white-space: nowrap;">Quick Start:</span>
    <span class="iuh-guide-item">1️⃣ <code>POST /api/auth/login</code> → copy accessToken</span>
    <span class="iuh-guide-item">2️⃣ Paste token above → click "Authorize All"</span>
    <span class="iuh-guide-item">3️⃣ Click any endpoint → "Try it out" → Execute</span>
    <span class="iuh-guide-item">🤖 AI Chat: <code>POST /api/ai/chat</code> → <code>{"message":"Xin chào"}</code></span>
  </div>
  <div id="swagger-ui"></div>
  <script src="/swagger-ui-dist/swagger-ui-bundle.js" charset="UTF-8"></script>
  <script src="/swagger-ui-dist/swagger-ui-standalone-preset.js" charset="UTF-8"></script>
  <script>
    let swaggerUiInstance = null;
    window.onload = function() {
      swaggerUiInstance = SwaggerUIBundle({
        url: '/api-docs/swagger.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: false,
        defaultModelsExpandDepth: 1,
        defaultModelExpandDepth: 2,
        docExpansion: 'none',
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl],
        layout: 'StandaloneLayout',
        validatorUrl: null,
        requestInterceptor: function(request) {
          const savedToken = localStorage.getItem('iuh_swagger_token');
          if (savedToken && !request.headers['Authorization']) {
            request.headers['Authorization'] = 'Bearer ' + savedToken;
          }
          return request;
        }
      });
      const saved = localStorage.getItem('iuh_swagger_token');
      if (saved) {
        document.getElementById('token-input').value = saved;
        updateAuthStatus(true);
        setTimeout(() => authorizeSwaggerUi(saved), 1500);
      }
    };
    function applyToken() {
      const token = document.getElementById('token-input').value.trim();
      if (!token) { alert('Please enter a JWT token'); return; }
      localStorage.setItem('iuh_swagger_token', token);
      authorizeSwaggerUi(token);
      updateAuthStatus(true);
    }
    function clearToken() {
      localStorage.removeItem('iuh_swagger_token');
      document.getElementById('token-input').value = '';
      updateAuthStatus(false);
    }
    function authorizeSwaggerUi(token) {
      if (swaggerUiInstance) swaggerUiInstance.preauthorizeApiKey('bearerAuth', token);
    }
    function updateAuthStatus(active) {
      const el = document.getElementById('auth-status');
      el.className = 'iuh-auth-status ' + (active ? 'active' : 'inactive');
      el.textContent = active ? '✓ Authorized' : 'Not authorized';
    }
  </script>
</body>
</html>`);
  });
}

// Frontend - proxy all other requests to Next.js dev server
app.all('/*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found', message: `API route ${req.path} not configured in gateway` });
  }

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
  // In development: fetch spec, THEN setup swagger, THEN start server
  // This ensures swagger-ui-init.js has all 134 paths
  if (config.nodeEnv !== 'production') {
    fetchAndMergeSpecs()
      .then((merged) => {
        unifiedSpec.openapi = merged.openapi;
        unifiedSpec.info = merged.info;
        unifiedSpec.servers = merged.servers;
        unifiedSpec.tags = merged.tags;
        unifiedSpec.paths = merged.paths;
        unifiedSpec.components = merged.components;
        unifiedSpec.security = merged.security;
        console.log(`[Swagger] Unified spec loaded — ${Object.keys(merged.paths).length} paths`);
        return merged;
      })
      .then(() => {
        app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(unifiedSpec, {
          swaggerUrl: '/api-docs/swagger.json',
        }));
      })
      .then(() => {
        const server = app.listen(PORT, '0.0.0.0', () => {
          console.log(`🚀 API Gateway running on port ${PORT}`);
          console.log('Routing: auth=user-service, borrow=borrow-service, access=access-service, face/camera=face-recognition-service');
        });
        setupServerHandlers(server);
      })
      .catch((err) => {
        console.error('[Swagger] Failed to load spec:', err instanceof Error ? err.message : String(err));
        app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(unifiedSpec, {
          swaggerUrl: '/api-docs/swagger.json',
        }));
        const server = app.listen(PORT, '0.0.0.0', () => {
          console.log(`🚀 API Gateway running on port ${PORT}`);
        });
        setupServerHandlers(server);
      });
  } else {
    // production / test: no swagger, just start server
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 API Gateway running on port ${PORT}`);
      if (config.nodeEnv !== 'production') {
        console.log('Routing: auth=user-service, borrow=borrow-service, access=access-service, face/camera=face-recognition-service');
      }
    });
    setupServerHandlers(server);
  }
}

export { app };
