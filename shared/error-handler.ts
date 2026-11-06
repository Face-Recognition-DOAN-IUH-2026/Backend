import { Request, Response, NextFunction } from 'express';
import { createJiraBug, JiraIssueParams } from './jira-client';

// multer is a soft dependency: only services that do file uploads have it
// installed. Lazy-require so importing this handler never crashes a service
// that lacks multer (MulterError handling simply no-ops there).
let multerModule: any;
function getMulter(): any {
  if (multerModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      multerModule = require('multer');
    } catch {
      multerModule = null;
    }
  }
  return multerModule;
}

const SENSITIVE_FIELDS = ['password', 'pass', 'code', 'token', 'secret', 'authorization', 'otp', 'otpCode', 'resetCode', 'verificationCode'];

function stripSensitiveFields(body: Record<string, any>): Record<string, any> {
  if (!body || typeof body !== 'object') return body;
  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_FIELDS.some(f => key.toLowerCase().includes(f))) {
      sanitized[key] = '***REDACTED***';
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = stripSensitiveFields(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string, public code?: string) {
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

/**
 * A failing dependency makes the clients poll fail over and over (the dashboard
 * polls every 30s). Reporting every occurrence to Jira buries the real
 * incidents, so identical 5xx errors are reported at most once per window.
 * Further occurrences are counted and logged locally instead.
 */
const JIRA_REPORT_WINDOW_MS = 10 * 60 * 1000;
const jiraReportState = new Map<string, { lastReportedAt: number; totalCount: number }>();

function pruneJiraReportState(now: number): void {
  if (jiraReportState.size < 500) return;
  for (const [key, state] of jiraReportState) {
    if (now - state.lastReportedAt > JIRA_REPORT_WINDOW_MS) jiraReportState.delete(key);
  }
}

/**
 * Registers one 5xx occurrence and decides whether it should be reported to
 * Jira. `occurrence` is the cumulative number of times this exact error has
 * been seen, so the created issue carries the impact of the failure.
 */
function registerJiraReport(key: string): { report: boolean; occurrence: number } {
  const now = Date.now();
  pruneJiraReportState(now);

  const state = jiraReportState.get(key);
  if (!state) {
    jiraReportState.set(key, { lastReportedAt: now, totalCount: 1 });
    return { report: true, occurrence: 1 };
  }

  state.totalCount += 1;
  if (now - state.lastReportedAt < JIRA_REPORT_WINDOW_MS) {
    return { report: false, occurrence: state.totalCount };
  }

  state.lastReportedAt = now;
  return { report: true, occurrence: state.totalCount };
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  // Zod validation errors → 400
  if (err?.name === 'ZodError') {
    res.status(400).json({
      error: 'Validation Error',
      detail: err.issues || err.errors || [{ message: err.message }],
    });
    return;
  }

  // Multer file upload errors → 400
  const multer = getMulter();
  if (multer && err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: 'File too large' });
      return;
    }
    res.status(400).json({ error: 'File upload error' });
    return;
  }

  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Internal Server Error';
  const serviceName = getServiceName();

  // Log to console
  console.error(`[${serviceName}] ${req.method} ${req.path} - ${statusCode} - ${message}`);
  if (statusCode >= 500 && err.stack) {
    console.error(err.stack);
  }

  // Report 5xx errors to Jira (de-duplicated per reporting window)
  if (statusCode >= 500) {
    const reportKey = `${serviceName}|${req.method}|${req.path}|${statusCode}|${message}`;
    const { report, occurrence } = registerJiraReport(reportKey);

    if (!report) {
      console.warn(
        `[${serviceName}] Jira report suppressed for ${req.method} ${req.path} ` +
        `(occurrence #${occurrence} within ${JIRA_REPORT_WINDOW_MS / 60000} min window)`
      );
    } else {
      const jiraParams: JiraIssueParams = {
        title: `[${serviceName}] ${req.method} ${req.path} - ${message}`,
        description: `${message}\n\nOccurrence count: ${occurrence}`,
        priority: statusCode >= 500 ? 'High' : 'Medium',
        labels: [serviceName, `${statusCode}-error`],
        service: serviceName,
        endpoint: req.path,
        method: req.method,
        stacktrace: err.stack,
        userId: (req as any).user?.userId || (req as any).user?.sub,
        requestBody: req.body ? JSON.stringify(stripSensitiveFields(req.body)).substring(0, 2000) : undefined,
        timestamp: new Date().toISOString(),
      };

      createJiraBug(jiraParams).catch((e) => {
        console.error('[JiraClient] Failed to report error:', e);
      });
    }
  }

  // Send response — 5xx bodies stay generic; details live in logs/Jira only
  if (statusCode >= 500) {
    res.status(statusCode).json({
      error: 'Internal server error',
    });
  } else {
    res.status(statusCode).json({
      error: message,
      detail: err.detail || undefined,
      code: err.code || undefined,
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
