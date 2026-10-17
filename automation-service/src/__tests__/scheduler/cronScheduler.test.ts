import { AppDataSource } from '../../data-source';
import { accessClient } from '../../clients/serviceClients';
import { CronScheduler } from '../../scheduler/CronScheduler';

jest.mock('../../data-source', () => ({
  AppDataSource: { getRepository: jest.fn() },
}));

describe('CronScheduler.executeTask failure recording (#20)', () => {
  let runSaves: any[];
  let runRepoMock: { create: jest.Mock; save: jest.Mock };
  let taskRepoMock: { save: jest.Mock; find: jest.Mock };

  beforeEach(() => {
    runSaves = [];
    runRepoMock = {
      create: jest.fn((x: any) => ({ ...x })),
      save: jest.fn(async (r: any) => {
        runSaves.push({ ...r });
        return r;
      }),
    };
    taskRepoMock = {
      save: jest.fn(async (t: any) => t),
      find: jest.fn().mockResolvedValue([]),
    };
    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity: any) =>
      entity?.name === 'AutomationRun' ? runRepoMock : taskRepoMock
    );
  });

  const task = {
    id: 't1',
    name: 'Stale cleanup',
    handler: 'stale_patron_cleanup',
    config: {},
    type: 'scheduled',
    cronExpression: '0 * * * *',
    isActive: true,
  } as any;

  it('records a failed run when the handler throws', async () => {
    (accessClient.getActivePatrons as jest.Mock) = jest.fn().mockRejectedValue(new Error('access down'));

    const scheduler = new CronScheduler();
    await scheduler.executeTask(task, 'cron');

    const finalRun = runSaves[runSaves.length - 1];
    expect(finalRun.status).toBe('failed');
    expect(finalRun.errorMessage).toContain('access down');
  });

  it('records a success run when the handler succeeds', async () => {
    (accessClient.getActivePatrons as jest.Mock) = jest.fn().mockResolvedValue([]);

    const scheduler = new CronScheduler();
    await scheduler.executeTask(task, 'cron');

    const finalRun = runSaves[runSaves.length - 1];
    expect(finalRun.status).toBe('success');
  });
});
