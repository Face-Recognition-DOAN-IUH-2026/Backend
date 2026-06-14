import express from 'express';
import http from 'http';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from './config';

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true,
}));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// Global rate limit: 200 req/min per IP
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', detail: 'Vượt quá giới hạn request, vui lòng thử lại sau' },
});

// Strict rate limit for face endpoints: 30 req/min per IP (compute-heavy)
const faceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', detail: 'Vượt quá giới hạn request cho face recognition' },
});

app.use(globalLimiter);

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
//   /api/access/*       → face-recognition-service
//   /api/tasks/*        → face-recognition-service
//   /api/users/*        → face-recognition-service (admin: list/delete patrons)
//   /api/patrons/*      → face-recognition-service (CRUD + face enrollment)
//   /docs/*             → face-recognition-service (swagger docs)
// ============================================================================

// ---- USER-SERVICE (Auth, Patron Auth, User Info) ----

// Auth routes: /api/auth/login, /api/auth/register, /api/auth/refresh
app.use('/api/auth/login', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },  // /api/auth/login → /auth/login
}));

app.use('/api/auth/register', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
}));

app.use('/api/auth/refresh', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
}));

// Patron auth routes: login, register
app.use('/api/patrons/login', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },  // → /patrons/login
}));

app.use('/api/patrons/register', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },  // → /patrons/register
}));

// Patron self-info routes: /patrons/me, /patrons/:id/password
app.use('/api/patrons/me', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },  // → /patrons/me
}));

app.use('/api/patrons/:id/password', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },  // → /patrons/:id/password
}));

// User self-info: /users/me
app.use('/users/me', createProxyMiddleware({
  target: config.services.userService,
  changeOrigin: true,
}));

// ---- BORROW-SERVICE ----
app.use('/api/borrow', createProxyMiddleware({
  target: config.services.borrowService,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },  // /api/borrow → /borrow
}));

// ---- FACE-RECOGNITION-SERVICE ----

// Face-login (special route under /api/auth/ — strict rate limit)
app.use('/api/auth/face-login', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },  // → /auth/face-login
}));

// Face operations (with strict rate limit)
app.use('/api/face', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
}));

// Kiosk operations (with strict rate limit)
app.use('/api/kiosk', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
}));

// Camera operations (with strict rate limit)
app.use('/api/camera', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
}));

// Async tasks (with strict rate limit)
app.use('/api/tasks', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
}));

// Access logs
app.use('/api/access', faceLimiter, createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
}));

// Patron CRUD + face enrollment (must be after specific routes above)
app.use('/api/patrons', createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
}));

// Users admin routes (list/delete patrons with face status)
app.use('/api/users', createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
  pathRewrite: { '^/api': '' },
}));

// Swagger docs
app.use('/docs', createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
}));

app.use('/docs/*', createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
}));

app.use('/openapi.json', createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
}));

app.use('/redoc', createProxyMiddleware({
  target: config.services.faceRecognitionApi,
  changeOrigin: true,
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
    },
  });
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

const PORT = config.port;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
  console.log('📋 Routing rules:');
  console.log('   /api/auth/*          → user-service');
  console.log('   /api/patrons/login   → user-service');
  console.log('   /api/patrons/register → user-service');
  console.log('   /api/patrons/me      → user-service');
  console.log('   /api/patrons/:id/password → user-service');
  console.log('   /users/me            → user-service');
  console.log('   /api/borrow/*        → borrow-service');
  console.log('   /api/face/*          → face-recognition-service');
  console.log('   /api/kiosk/*         → face-recognition-service');
  console.log('   /api/camera/*        → face-recognition-service');
  console.log('   /api/access/*        → face-recognition-service');
  console.log('   /api/tasks/*         → face-recognition-service');
  console.log('   /api/patrons/*       → face-recognition-service');
  console.log('   /api/users/*         → face-recognition-service');
});

server.timeout = 30000;       // 30s request timeout (was 0 = infinite)
server.keepAliveTimeout = 60000; // 60s keep-alive