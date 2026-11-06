/**
 * Regression tests for 5xx → Jira reporting in the shared error handler.
 *
 * A failing dependency makes the dashboard poll fail every 30s. Without
 * de-duplication every occurrence opened a Jira issue, burying the real
 * incidents in noise. Identical 5xx errors must therefore be reported at most
 * once per reporting window, while every occurrence still gets logged locally.
 */
import { errorHandler } from '../error-handler';

jest.mock('../jira-client', () => ({
  createJiraBug: jest.fn().mockResolvedValue('https://jira.example.com/browse/TEST-1'),
}));

let res: { status: any; json: any };

function mockResponse() {
  res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res;
}

function jiraMock() {
  return require('../jira-client').createJiraBug as jest.Mock;
}

describe('errorHandler — 5xx Jira de-duplication', () => {
  let consoleErrorSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    mockResponse();
    jiraMock().mockClear();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('reports a repeated 5xx to Jira only once inside the reporting window', () => {
    const req = { method: 'GET', path: '/access/recent-dedupe', body: {} } as any;
    const err = new Error('user-service unreachable');

    for (let i = 0; i < 5; i += 1) {
      errorHandler(err, req, res as any, jest.fn());
    }

    expect(jiraMock()).toHaveBeenCalledTimes(1);
  });

  it('still logs every occurrence locally', () => {
    const req = { method: 'GET', path: '/access/recent-logging', body: {} } as any;
    const err = new Error('user-service unreachable');

    for (let i = 0; i < 5; i += 1) {
      errorHandler(err, req, res as any, jest.fn());
    }

    const logged = consoleErrorSpy.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('/access/recent-logging'),
    );
    expect(logged).toHaveLength(5);
  });

  it('reports distinct errors separately', () => {
    const req = { method: 'GET', path: '/access/recent-distinct', body: {} } as any;

    errorHandler(new Error('failure A'), req, res as any, jest.fn());
    errorHandler(new Error('failure B'), req, res as any, jest.fn());

    expect(jiraMock()).toHaveBeenCalledTimes(2);
  });

  it('reports again after the reporting window and carries the occurrence count', () => {
    const nowSpy = jest.spyOn(Date, 'now');
    const req = { method: 'GET', path: '/access/recent-window', body: {} } as any;
    const err = new Error('user-service unreachable');

    nowSpy.mockReturnValue(1_700_000_000_000);
    errorHandler(err, req, res as any, jest.fn());

    nowSpy.mockReturnValue(1_700_000_000_000 + 11 * 60 * 1000);
    errorHandler(err, req, res as any, jest.fn());

    expect(jiraMock()).toHaveBeenCalledTimes(2);
    const secondReport = jiraMock().mock.calls[1][0];
    expect(secondReport.description).toContain('2');
  });

  it('does not create Jira issues for 4xx errors', () => {
    const req = { method: 'GET', path: '/access/recent-client-error', body: {} } as any;

    errorHandler({ statusCode: 404, message: 'Not found' }, req, res as any, jest.fn());

    expect(jiraMock()).not.toHaveBeenCalled();
  });
});
