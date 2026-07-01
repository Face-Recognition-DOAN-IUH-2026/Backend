import { Request, Response, NextFunction } from 'express';
import { createJiraBug, JiraIssueParams } from './jira-client';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

function getServiceName(): string {
  const port = process.env.PORT || '3000';
  const serviceMap: Record<string, string> = {
    '3001': 'user-service',
    '3002': 'schedule-service',
    '3003': 'access-service',
    '3004': 'ai-service',
    '3006': 'notification-service',
    '3007': 'automation-service',
    '8000': 'borrow-service',
    '80': 'api-gateway',
  };
  return serviceMap[port] || `service-${port}`;
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';
  const serviceName = getServiceName();

  // Log to console
  console.error(`[${serviceName}] ${req.method} ${req.path} - ${statusCode} - ${message}`);
  if (statusCode >= 500 && err.stack) {
    console.error(err.stack);
  }

  // Report 5xx errors to Jira
  if (statusCode >= 500) {
    const jiraParams: JiraIssueParams = {
      title: `[${serviceName}] ${req.method} ${req.path} - ${message}`,
      description: message,
      priority: statusCode >= 500 ? 'High' : 'Medium',
      labels: [serviceName, `${statusCode}-error`],
      service: serviceName,
      endpoint: req.path,
      method: req.method,
      stacktrace: err.stack,
      userId: (req as any).user?.userId || (req as any).user?.sub,
      requestBody: req.body ? JSON.stringify(req.body).substring(0, 2000) : undefined,
      timestamp: new Date().toISOString(),
    };

    createJiraBug(jiraParams).catch((e) => {
      console.error('[JiraClient] Failed to report error:', e);
    });
  }

  // Send response
  if (statusCode >= 500) {
    res.status(statusCode).json({
      error: message,
    });
  } else {
    res.status(statusCode).json({
      error: message,
      detail: err.detail || undefined,
    });
  }
}

// Catch uncaught exceptions and unhandled rejections
export function setupProcessErrorHandlers() {
  const serviceName = getServiceName();

  process.on('uncaughtException', (error: Error) => {
    console.error(`[${serviceName}] Uncaught Exception:`, error);
    createJiraBug({
      title: `[${serviceName}] Uncaught Exception - ${error.message}`,
      description: error.message,
      priority: 'Highest',
      labels: [serviceName, 'uncaught-exception', 'critical'],
      service: serviceName,
      stacktrace: error.stack,
      timestamp: new Date().toISOString(),
    }).catch(() => {}).finally(() => process.exit(1));
  });

  process.on('unhandledRejection', (reason: any) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    console.error(`[${serviceName}] Unhandled Rejection:`, reason);
    createJiraBug({
      title: `[${serviceName}] Unhandled Rejection - ${message}`,
      description: message,
      priority: 'High',
      labels: [serviceName, 'unhandled-rejection'],
      service: serviceName,
      stacktrace: stack,
      timestamp: new Date().toISOString(),
    }).catch(() => {}).finally(() => process.exit(1));
  });
}
