import { createProxyMiddleware } from 'http-proxy-middleware';
import { config } from './config';

export const setupProxy = (app: any) => {
  app.use((req: any, res: any, next: any) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl || req.url}`);
    next();
  });

  // User Service proxy - use originalUrl to preserve full path
  app.use('/users', createProxyMiddleware({
    target: config.services.userService,
    changeOrigin: true,
    pathRewrite: (path: string, req: any) => {
      // Use originalUrl which has the full path before Express strips mount point
      const originalPath = req.originalUrl || req.url;
      console.log(`  User proxy: ${originalPath}`);
      return originalPath;
    },
  }));

  // Face API proxy
  app.use('/api', createProxyMiddleware({
    target: config.services.faceRecognitionApi,
    changeOrigin: true,
    pathRewrite: (path: string, req: any) => {
      const originalPath = req.originalUrl || req.url;
      // Strip /api prefix and use the rest
      const newPath = originalPath.replace(/^\/api/, '') || '/';
      console.log(`  Face API proxy: ${originalPath} -> ${newPath}`);
      return newPath;
    },
  }));

  app.use('/docs', createProxyMiddleware({
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

  app.get('/healthz', (req: any, res: any) => {
    res.json({ status: 'ok', gateway: 'Node.js-API-Gateway', timestamp: new Date().toISOString() });
  });

  app.get('/', (req: any, res: any) => {
    res.json({
      name: 'Face Recognition Platform API Gateway',
      version: '1.0.0',
      gateway: 'Node.js',
    });
  });
};