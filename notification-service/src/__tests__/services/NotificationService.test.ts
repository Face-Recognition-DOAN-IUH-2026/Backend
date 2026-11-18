jest.unmock('../../services/NotificationService');

const mockCreate = jest.fn((data: any) => ({ id: 'notif-1', isRead: false, ...data }));
const mockSave = jest.fn(async (entity: any) => entity);
const mockCount = jest.fn();
const mockFindOne = jest.fn();
const mockGetManyAndCount = jest.fn();
const mockExecute = jest.fn();

const mockQb: any = {
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  getManyAndCount: mockGetManyAndCount,
  execute: mockExecute,
};

jest.mock('../../data-source', () => ({
  AppDataSource: {
    getRepository: jest.fn(() => ({
      create: mockCreate,
      save: mockSave,
      count: mockCount,
      findOne: mockFindOne,
      createQueryBuilder: jest.fn(() => mockQb),
    })),
  },
}));

import { NotificationService } from '../../services/NotificationService';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService();
  });

  it('creates a notification with null data fallback', async () => {
    const res = await service.create({
      userId: 'u-1',
      type: 'borrow',
      title: 'Mượn sách',
      body: 'Thành công',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      userId: 'u-1',
      type: 'borrow',
      title: 'Mượn sách',
      body: 'Thành công',
      data: null,
    });
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(res.userId).toBe('u-1');
  });

  it('lists notifications with unreadOnly filter and unread count', async () => {
    mockGetManyAndCount.mockResolvedValue([[{ id: 'n1' }], 1]);
    mockCount.mockResolvedValue(3);

    const res = await service.list('u-1', { unreadOnly: true, skip: 10, limit: 5 });

    expect(mockQb.andWhere).toHaveBeenCalledWith('n.is_read = false');
    expect(mockQb.skip).toHaveBeenCalledWith(10);
    expect(mockQb.take).toHaveBeenCalledWith(5);
    expect(res).toEqual({ items: [{ id: 'n1' }], total: 1, unread: 3 });
  });

  it('marks unread notification as read and skips already-read ones', async () => {
    const unreadNotif: any = { id: 'n1', userId: 'u-1', isRead: false };
    mockFindOne.mockResolvedValueOnce(unreadNotif);

    const updated = await service.markAsRead('n1', 'u-1');
    expect(updated?.isRead).toBe(true);
    expect(updated?.readAt).toBeInstanceOf(Date);
    expect(mockSave).toHaveBeenCalledTimes(1);

    mockFindOne.mockResolvedValueOnce({ id: 'n2', userId: 'u-1', isRead: true });
    const unchanged = await service.markAsRead('n2', 'u-1');
    expect(unchanged?.isRead).toBe(true);
    expect(mockSave).toHaveBeenCalledTimes(1);
  });

  it('marks all notifications as read and deletes old notifications', async () => {
    mockExecute.mockResolvedValueOnce({ affected: 4 });
    const updated = await service.markAllAsRead('u-1');
    expect(updated).toBe(4);

    mockExecute.mockResolvedValueOnce({ affected: 2 });
    const deleted = await service.deleteOlderThan('u-1', 30);
    expect(deleted).toBe(2);
  });
});
