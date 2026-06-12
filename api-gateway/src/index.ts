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

  const skipHeaders = ['host', 'connection'];
  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipHeaders.includes(key.toLowerCase())) {
      (options.headers as any)[key] = value;
    }
  }
  
  const headers = options.headers as Record<string, string>;
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

// ===== USER-SERVICE ROUTES =====

// Auth routes (login, register, refresh) -> user-service
app.all('/api/auth/login', (req, res) => proxyRequest('/auth/login', req, res, config.services.userService));
app.all('/api/auth/register', (req, res) => proxyRequest('/auth/register', req, res, config.services.userService));
app.all('/api/auth/refresh', (req, res) => proxyRequest('/auth/refresh', req, res, config.services.userService));
app.all('/auth/login', (req, res) => proxyRequest('/auth/login', req, res, config.services.userService));
app.all('/auth/register', (req, res) => proxyRequest('/auth/register', req, res, config.services.userService));
app.all('/auth/refresh', (req, res) => proxyRequest('/auth/refresh', req, res, config.services.userService));

// User info routes -> user-service
app.all('/users/me', (req, res) => proxyRequest('/users/me', req, res, config.services.userService));

// ===== FACE-RECOGNITION-API ROUTES =====

// Face-login stays on face-recognition-api (needs Milvus + face processing)
app.all('/api/auth/face-login', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));

// Face API routes
app.all('/api/face', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/face/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));

// Tasks routes
app.all('/api/tasks', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/tasks/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));

// Patrons, Access, Kiosk, Camera routes
app.all('/api/patrons', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/patrons/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/access', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/access/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/kiosk', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/kiosk/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/camera', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/camera/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));

// Users admin routes (list + delete with has_face status) — still on face-recognition-api
app.all('/api/users', (req, res) => proxyRequest('/users', req, res, config.services.faceRecognitionApi));
app.all('/api/users/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/users', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/users/*', (req, res) => {
  // Skip users/me (already routed to user-service above)
  if (req.path === '/users/me' || req.path.startsWith('/users/me/')) {
    return proxyRequest('/users/me', req, res, config.services.userService);
  }
  proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi);
});

// Swagger docs
app.all('/docs', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/docs/*', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/openapi.json', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/redoc', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));

// Non-prefixed routes for Access, Kiosk, Camera
app.all('/access', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/access/*', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/kiosk', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/kiosk/*', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/camera', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));
app.all('/camera/*', (req, res) => proxyRequest(req.originalUrl, req, res, config.services.faceRecognitionApi));

// Auth catch-all for face-recognition-api (face-login, any other auth)
app.all('/api/auth', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/api/auth/*', (req, res) => proxyRequest(req.originalUrl.replace(/^\/api/, '') || '/', req, res, config.services.faceRecognitionApi));
app.all('/auth', (req, res) => proxyRequest(req.originalUrl || '/', req, res, config.services.faceRecognitionApi));
app.all('/auth/*', (req, res) => proxyRequest(req.originalUrl || '/', req, res, config.services.faceRecognitionApi));

// Generic API catch-all
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
