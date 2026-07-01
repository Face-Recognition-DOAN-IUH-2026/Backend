import axios from 'axios';
import { tools, getScheduleToday, searchBooks, getOverdueBorrows } from '../../tools/tools';

jest.mock('../../config', () => ({
  config: {
    borrowServiceUrl: 'http://borrow-service:8000',
    userServiceUrl: 'http://user-service:3001',
    scheduleServiceUrl: 'http://schedule-service:3002',
    serviceJwtSecret: 'test-service-jwt-secret',
  },
}));

jest.mock('axios');

describe('AI Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Tool registry', () => {
    it('should register get_schedule_today tool', () => {
      const tool = tools.find(t => t.name === 'get_schedule_today');
      expect(tool).toBeDefined();
      expect(typeof tool?.func).toBe('function');
    });

    it('should register search_books tool', () => {
      const tool = tools.find(t => t.name === 'search_books');
      expect(tool).toBeDefined();
    });

    it('should register get_overdue_borrows tool', () => {
      const tool = tools.find(t => t.name === 'get_overdue_borrows');
      expect(tool).toBeDefined();
    });

    it('should register get_library_hours tool', () => {
      const tool = tools.find(t => t.name === 'get_library_hours');
      expect(tool).toBeDefined();
    });

    it('should register lookup_book tool', () => {
      const tool = tools.find(t => t.name === 'lookup_book');
      expect(tool).toBeDefined();
    });
  });

  describe('get_schedule_today', () => {
    it('should call schedule-service internal today endpoint', async () => {
      const mockResponse = {
        data: [
          { id: '1', shift: { startTime: '08:00' }, staff: { name: 'Staff A' } },
          { id: '2', shift: { startTime: '14:00' }, staff: { name: 'Staff B' } },
        ],
      };

      (axios.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await getScheduleToday();

      expect(axios.get).toHaveBeenCalledWith(
        'http://schedule-service:3002/schedules/internal/today',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Bearer '),
          }),
          timeout: 10000,
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should sort schedule results by shift startTime', async () => {
      const mockResponse = {
        data: [
          { id: '2', shift: { startTime: '14:00' }, staff: { name: 'Staff B' } },
          { id: '1', shift: { startTime: '08:00' }, staff: { name: 'Staff A' } },
        ],
      };

      (axios.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await getScheduleToday();

      expect(result.success).toBe(true);
      expect(result.data[0].shift.startTime).toBe('08:00');
      expect(result.data[1].shift.startTime).toBe('14:00');
    });

    it('should handle errors when schedule service fails', async () => {
      (axios.get as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await getScheduleToday();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle 401 auth errors from schedule service', async () => {
      (axios.get as jest.Mock).mockRejectedValue({ response: { data: { message: 'Unauthorized' }, status: 401 } });

      const result = await getScheduleToday();

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
