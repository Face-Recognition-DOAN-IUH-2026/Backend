"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
exports.sanitizeInput = sanitizeInput;
exports.verifyToken = verifyToken;
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const http_proxy_middleware_1 = require("http-proxy-middleware");
const config_1 = require("./config");
const swagger_ui_express_1 = __importDefault(require("swagger-ui-express"));
const swagger_1 = require("./config/swagger");
const xss_1 = __importDefault(require("xss"));
let unifiedSpec = swagger_1.swaggerSpec;
const error_handler_1 = require("../../shared/error-handler");
const jira_client_1 = require("../../shared/jira-client");
const app = (0, express_1.default)();
exports.app = app;
const corsOrigin = config_1.config.corsOrigins.length > 0 ? config_1.config.corsOrigins : false;
// Security headers
app.use((0, helmet_1.default)());
app.use((0, cookie_parser_1.default)());
app.use((0, cors_1.default)({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
}));
// Global rate limit per IP. In local/dev this is intentionally high because
// dashboards, SSE reconnects, and camera pages can share one browser IP.
const globalLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.config.rateLimit.windowMs,
    max: config_1.config.rateLimit.max,
    skip: (req) => {
        if (config_1.config.nodeEnv === 'production')
            return false;
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
// Auth rate limiter — relaxed during development
const authLimiter = (0, express_rate_limit_1.default)({
    windowMs: config_1.config.nodeEnv === 'production' ? 15 * 60 * 1000 : 60 * 1000,
    max: config_1.config.nodeEnv === 'production' ? 20 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many login attempts', detail: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau' },
});
// Face rate limiter — active only in production
const faceLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000,
    max: 100,
    skip: (req) => config_1.config.nodeEnv !== 'production',
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many face recognition attempts', detail: 'Quá nhiều lần nhận diện, vui lòng thử lại sau' },
});
// Error report rate limiter — prevent spam
const errorReportLimiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 reports per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many error reports', detail: 'Quá nhiều báo lỗi, vui lòng thử lại sau' },
});
function sanitizeInput(input) {
    if (!input)
        return '';
    return (0, xss_1.default)(input, {
        whiteList: {},
        stripIgnoreTag: true,
        stripIgnoreTagBody: ['script', 'style'],
    });
}
function verifyToken(req, res, next) {
    let token = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
    }
    else if (req.cookies?.access_token) {
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
        const payload = jsonwebtoken_1.default.verify(token, secret);
        req.user = payload;
        next();
    }
    catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
}
app.use(globalLimiter);
const preserveOriginalPath = (_path, req) => req.originalUrl || req.url;
const stripApiPrefixFromOriginalPath = (_path, req) => {
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
app.use('/auth', authLimiter, (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: preserveOriginalPath,
}));
app.use('/api/auth/face-login', faceLimiter, (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.faceRecognitionApi,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// Auth routes: /api/auth/login, /api/auth/register, /api/auth/refresh
app.use('/api/auth', authLimiter, (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // /api/auth/login → /auth/login
}));
// Patron auth routes: login, register
app.use('/api/patrons/login', authLimiter, (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // → /patrons/login
}));
app.use('/api/patrons/register', authLimiter, (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // → /patrons/register
}));
// Patron self-info routes: /patrons/me, /patrons/:id/password
app.use('/api/patrons/me', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // → /patrons/me
}));
app.use('/api/patrons/:id/password', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // → /patrons/:id/password
}));
app.use('/api/patrons/:id/restore', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // → /patrons/:id/restore
}));
app.use('/api/patrons/:id/card', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // → /patrons/:id/card/*
}));
// User self-info: /users/me
app.use('/users/me', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: preserveOriginalPath,
}));
// ---- BORROW-SERVICE ----
app.use('/api/borrow', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.borrowService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // /api/borrow → /borrow
}));
app.use('/api/library', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.borrowService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // /api/library → /library
}));
app.use('/api/schedules', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.scheduleService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// ---- FACE-RECOGNITION-SERVICE ----
// Face operations
app.use('/api/face', faceLimiter, (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.faceRecognitionApi,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// Kiosk operations
app.use('/api/kiosk', faceLimiter, (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.faceRecognitionApi,
    changeOrigin: true,
    timeout: 60000,
    proxyTimeout: 60000,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// Camera operations
app.use('/api/camera', faceLimiter, (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.faceRecognitionApi,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// Async tasks
app.use('/api/tasks', faceLimiter, (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.faceRecognitionApi,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// Access logs and realtime stream
const accessProxy = (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.accessService,
    changeOrigin: true,
    ws: true,
    timeout: 0,
    proxyTimeout: 0,
    pathRewrite: stripApiPrefixFromOriginalPath,
});
app.use('/api/access', faceLimiter, accessProxy);
app.use('/api/ai', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.aiService,
    changeOrigin: true,
    timeout: 120000,
    proxyTimeout: 120000,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// Patron stats from user-service (must be before catch-all /api/patrons)
app.use('/api/patrons/stats', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// Check student code + email existence from user-service
app.use('/api/patrons/check-exists', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// Check student code existence from user-service (legacy)
app.use('/api/patrons/check-code', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// Patron CRUD + face enrollment (must be after specific routes above)
app.use('/api/patrons', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.faceRecognitionApi,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath,
}));
// ---- NOTIFICATION-SERVICE ----
const notificationProxy = (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.notificationService,
    changeOrigin: true,
    ws: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // /api/notifications → /notifications
});
app.use('/api/notifications', notificationProxy);
// ---- AUTOMATION-SERVICE ----
app.use('/api/automation', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.automationService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // /api/automation → /automation
}));
// Users admin routes (list/delete patrons with face status)
// Specific routes first, then catch-all
app.use('/api/users/me', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // /api/users/me → /users/me
}));
app.use('/api/users/:id', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.userService,
    changeOrigin: true,
    pathRewrite: stripApiPrefixFromOriginalPath, // /api/users/:id → /users/:id
}));
app.use('/api/users', (0, http_proxy_middleware_1.createProxyMiddleware)({
    target: config_1.config.services.faceRecognitionApi,
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
            userService: config_1.config.services.userService,
            faceRecognitionApi: config_1.config.services.faceRecognitionApi,
            borrowService: config_1.config.services.borrowService,
            scheduleService: config_1.config.services.scheduleService,
            accessService: config_1.config.services.accessService,
            aiService: config_1.config.services.aiService,
        },
    });
});
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'api-gateway', timestamp: new Date().toISOString() });
});
// ---- Swagger docs (dev only) — setup swagger.json endpoint early ----
if (config_1.config.nodeEnv !== 'production') {
    // ---- /api-docs/swagger.json: fetch specs on demand (with 10s cache) ----
    // This avoids the race condition where gateway starts before other services are ready.
    let specCache = null;
    const SPEC_CACHE_TTL_MS = 10000; // 10 seconds
    async function getUnifiedSpec() {
        const now = Date.now();
        if (specCache && (now - specCache.fetchedAt) < SPEC_CACHE_TTL_MS) {
            return specCache.spec;
        }
        try {
            const merged = await (0, swagger_1.fetchAndMergeSpecs)();
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
        }
        catch (err) {
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
    app.use('/swagger-ui-dist', express_1.default.static(swaggerUiDistPath, { index: false }));
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
    const targetUrl = new URL(req.originalUrl, config_1.config.frontendUrl);
    const options = {
        hostname: targetUrl.hostname,
        port: parseInt(targetUrl.port) || 80,
        path: targetUrl.pathname + targetUrl.search,
        method: req.method,
        headers: {},
    };
    const skipHeaders = ['host', 'connection'];
    for (const [key, value] of Object.entries(req.headers)) {
        if (!skipHeaders.includes(key.toLowerCase())) {
            options.headers[key] = value;
        }
    }
    const proxyReq = http_1.default.request({ ...options, timeout: 0 }, (proxyRes) => {
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
app.post('/errors/report', errorReportLimiter, verifyToken, express_1.default.json({ limit: '100kb' }), async (req, res) => {
    try {
        const { title, description, priority, labels, service, endpoint, method, stacktrace, requestBody } = req.body;
        if (!title) {
            res.status(400).json({ error: 'title is required' });
            return;
        }
        const issueUrl = await (0, jira_client_1.createJiraBug)({
            title: sanitizeInput(title),
            description: sanitizeInput(description || title),
            priority: priority || 'Medium',
            labels: [...(labels || []), 'client-report'],
            service: service || 'frontend',
            endpoint,
            method,
            stacktrace,
            requestBody,
            userId: req.user?.userId || req.user?.sub,
            timestamp: new Date().toISOString(),
        });
        if (issueUrl) {
            res.json({ success: true, issueUrl });
        }
        else {
            res.json({ success: false, message: 'Jira disabled or rate limited' });
        }
    }
    catch (err) {
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
        const issue = await (0, jira_client_1.getJiraIssue)(req.params.key);
        if (issue) {
            res.json(issue);
        }
        else {
            res.status(404).json({ error: 'Issue not found or Jira disabled' });
        }
    }
    catch (err) {
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
        const issues = await (0, jira_client_1.searchJiraIssues)(jql, parseInt(maxResults) || 50);
        res.json({ issues, total: issues.length });
    }
    catch (err) {
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
        const transitions = await (0, jira_client_1.getIssueTransitions)(req.params.key);
        res.json({ transitions });
    }
    catch (err) {
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
app.post('/api/jira/issue/:key/transition', express_1.default.json(), async (req, res) => {
    try {
        const { transitionId } = req.body;
        if (!transitionId) {
            res.status(400).json({ error: 'transitionId is required' });
            return;
        }
        const success = await (0, jira_client_1.transitionIssue)(req.params.key, transitionId);
        if (success) {
            res.json({ success: true });
        }
        else {
            res.status(500).json({ error: 'Failed to transition issue' });
        }
    }
    catch (err) {
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
app.post('/api/jira/issue/:key/comment', express_1.default.json(), async (req, res) => {
    try {
        const { body } = req.body;
        if (!body) {
            res.status(400).json({ error: 'body is required' });
            return;
        }
        const success = await (0, jira_client_1.addComment)(req.params.key, body);
        if (success) {
            res.json({ success: true });
        }
        else {
            res.status(500).json({ error: 'Failed to add comment' });
        }
    }
    catch (err) {
        console.error('[API-Gateway] Jira comment failed:', err.message);
        res.status(500).json({ error: 'Failed to add comment' });
    }
});
// ---- 404 handler ----
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});
// ---- Error handler ----
app.use(error_handler_1.errorHandler);
const PORT = config_1.config.port;
(0, error_handler_1.setupProcessErrorHandlers)();
function setupServerHandlers(server) {
    server.on('upgrade', (req, socket, head) => {
        if (req.url?.startsWith('/api/access/ws')) {
            accessProxy.upgrade(req, socket, head);
            return;
        }
        if (req.url?.startsWith('/notifications/ws')) {
            notificationProxy.upgrade(req, socket, head);
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
if (config_1.config.nodeEnv !== 'test') {
    // In development: fetch spec, THEN setup swagger, THEN start server
    // This ensures swagger-ui-init.js has all 134 paths
    if (config_1.config.nodeEnv !== 'production') {
        (0, swagger_1.fetchAndMergeSpecs)()
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
            app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(unifiedSpec, {
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
            app.use('/api-docs', swagger_ui_express_1.default.serve, swagger_ui_express_1.default.setup(unifiedSpec, {
                swaggerUrl: '/api-docs/swagger.json',
            }));
            const server = app.listen(PORT, '0.0.0.0', () => {
                console.log(`🚀 API Gateway running on port ${PORT}`);
            });
            setupServerHandlers(server);
        });
    }
    else {
        // production / test: no swagger, just start server
        const server = app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 API Gateway running on port ${PORT}`);
            if (config_1.config.nodeEnv !== 'production') {
                console.log('Routing: auth=user-service, borrow=borrow-service, access=access-service, face/camera=face-recognition-service');
            }
        });
        setupServerHandlers(server);
    }
}
