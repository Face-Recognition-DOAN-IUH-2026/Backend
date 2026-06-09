import express from 'express';
import http from 'http';
import cors from 'cors';
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

const proxyRequest = (path: string, req: any, res: any, targetBase: string) => {
  const targetUrl = new URL(path, targetBase);

  const options: http.RequestOptions = {
    hostname: targetUrl.hostname,
    port: parseInt(targetUrl.port) || 80,
    path: targetUrl.pathname + targetUrl.search,
    method: req.method,
    headers: {} as any,
  };

  const skipHeaders = ['host', 'connection', 'transfer-encoding'];
  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipHeaders.includes(key.toLowerCase())) {
      (options.headers as any)[key] = value;
    }
  }

  console.log(`  -> ${options.method} ${options.hostname}:${options.port}${options.path}`);

  const proxyReq = http.request({ ...options, timeout: 0 }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', (err) => {
    console.error(`  Proxy error: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Bad gateway', message: err.message });
    }
  });

  proxyReq.on('timeout', () => {
    console.error(`  Proxy timeout`);
    proxyReq.destroy();
    if (!res.headersSent) {
      res.status(504).json({ error: 'Gateway timeout' });
    }
  });

  req.pipe(proxyReq, { end: true });
};

// User Service routes - use full path (user-service has routes at /users/*)
app.all('/api/users', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, ''), req, res, config.services.userService));
app.all('/api/users/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, ''), req, res, config.services.userService));
app.all('/users', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.userService));
app.all('/users/*', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.userService));

// Special: face-login goes to face-recognition-api (not user-service)
app.all('/api/auth/face-login', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/auth/face-login', (req, res) => proxyRequest(req.originalUrl || '/', req, res, config.services.faceRecognitionApi));

// Auth routes go to user-service (user-service mounts userRoutes at /users, so /auth/* -> /users/*)
app.all('/api/auth', (req, res) => proxyRequest(req.originalUrl.replace('/api/auth', '/users'), req, res, config.services.userService));
app.all('/api/auth/*', (req, res) => proxyRequest(req.originalUrl.replace('/api/auth', '/users'), req, res, config.services.userService));

// Also handle /auth/* (direct, without /api prefix) - go to user-service as /users/*
app.all('/auth', (req, res) => proxyRequest(req.originalUrl.replace('/auth', '/users'), req, res, config.services.userService));
app.all('/auth/*', (req, res) => proxyRequest(req.originalUrl.replace('/auth', '/users'), req, res, config.services.userService));

// Face API routes - strip /api prefix (for face operations only, not auth)
app.all('/api/face', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/face/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));

// Tasks routes - proxy to face-recognition-api
app.all('/api/tasks', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/tasks/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));

// Swagger docs - no prefix stripping needed
app.all('/docs', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/docs/*', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/openapi.json', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/redoc', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));

// New routes: Patrons, Access, Kiosk - proxy to face-recognition-api
app.all('/api/patrons', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/patrons/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/access', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/access/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/kiosk', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/kiosk/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));

// Generic API catch-all - any remaining /api/* -> face-recognition-api
app.all('/api/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', gateway: 'Node.js-API-Gateway', timestamp: new Date().toISOString() });
});

// Frontend - proxy all other requests to Next.js dev server
app.all('/*', (req, res) => {
  proxyRequest(req.originalUrl, req, res, config.frontendUrl);
});

const PORT = config.port;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API Gateway running on port ${PORT}`);
});

server.timeout = 0;
server.keepAliveTimeout = 0;
