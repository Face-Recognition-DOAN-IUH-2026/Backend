import axios from 'axios';
import { patronToolDefs, staffToolDefs, adminToolDefs, getToolDefsForRole } from '../../tools/registry';
import { getScheduleToday, searchBooks, getOverdueBorrows, getMyPatronInfo, getPatronInfoById } from '../../tools/tools';

jest.mock('../../config', () => ({
  config: {
    borrowServiceUrl: 'http://borrow-service:8000',
    userServiceUrl: 'http://user-service:3001',
    scheduleServiceUrl: 'http://schedule-service:3002',
    serviceJwtSecret: 'test-service-jwt-secret',
  },
}));

jest.mock('axios');

describe('AI Tools - RBAC Security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Role-based tool access', () => {
    it('should provide only patron tools for patron role', () => {
      const tools = getToolDefsForRole('patron');
      expect(tools.length).toBe(patronToolDefs.length);
      // Patron tools should have injectUserId: true for data access
      const patronInfo = tools.find(t => t.name === 'get_patron_info');
      expect(patronInfo?.injectUserId).toBe(true);
      const patronBorrows = tools.find(t => t.name === 'get_patron_borrows');
      expect(patronBorrows?.injectUserId).toBe(true);
      const patronHistory = tools.find(t => t.name === 'get_patron_history');
      expect(patronHistory?.injectUserId).toBe(true);

      // Patrons should NOT have admin tools
      expect(tools.find(t => t.name === 'get_overdue_borrows')).toBeUndefined();
    });

    it('should provide staff+ tools for staff role', () => {
      const tools = getToolDefsForRole('staff');
      const staffInfo = tools.find(t => t.name === 'get_patron_info');
      expect(staffInfo?.injectUserId).toBeUndefined();
      expect(tools.find(t => t.name === 'get_overdue_borrows')).toBeDefined();
      const scheduleToday = tools.find(t => t.name === 'get_schedule_today');
      expect(scheduleToday).toBeDefined();
      expect(scheduleToday?.injectUserId).toBe(true);
    });

    it('should provide admin tools for admin role (staff tools plus get_all_schedules)', () => {
      const adminTools = getToolDefsForRole('admin');
      const staffTools = getToolDefsForRole('staff');
      expect(adminTools.length).toBe(staffTools.length + 1);
      expect(adminTools.find(t => t.name === 'get_all_schedules')).toBeDefined();
    });

    it('should default to patron tools for unknown role', () => {
      const tools = getToolDefsForRole('unknown_role');
      expect(tools.length).toBe(patronToolDefs.length);
    });
  });

  describe('injectUserId enforcement', () => {
    it('should call getMyPatronInfo with userId (server-injected, not AI)', async () => {
      const mockResponse = { data: { id: 'user-1', name: 'Test' } };
      (axios.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await getMyPatronInfo('server-injected-user-id');

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('server-injected-user-id'),
        expect.any(Object),
      );
      expect(result.success).toBe(true);
    });

    it('should call getPatronInfoById with AI-supplied id for staff tools', async () => {
      const mockResponse = { data: { id: 'patron-2', name: 'Other Patron' } };
      (axios.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await getPatronInfoById('ai-supplied-id');

      expect(axios.get).toHaveBeenCalledWith(
        expect.stringContaining('ai-supplied-id'),
        expect.any(Object),
      );
      expect(result.success).toBe(true);
    });
  });

  describe('Tool registry', () => {
    it('should register get_schedule_today tool', () => {
      const tool = staffToolDefs.find(t => t.name === 'get_schedule_today');
      expect(tool).toBeDefined();
      expect(typeof tool?.func).toBe('function');
    });

    it('should register search_books tool', () => {
      const tool = patronToolDefs.find(t => t.name === 'search_books');
      expect(tool).toBeDefined();
    });

    it('should register get_overdue_borrows tool', () => {
      const tool = staffToolDefs.find(t => t.name === 'get_overdue_borrows');
      expect(tool).toBeDefined();
    });

    it('should register get_library_hours tool', () => {
      const tool = patronToolDefs.find(t => t.name === 'get_library_hours');
      expect(tool).toBeDefined();
    });

    it('should register lookup_book tool', () => {
      const tool = patronToolDefs.find(t => t.name === 'lookup_book');
      expect(tool).toBeDefined();
    });
  });

  describe('get_schedule_today', () => {
    it('should call schedule-service internal today endpoint with staffId when provided', async () => {
      const mockResponse = {
        data: [
          { id: '1', shift: { startTime: '08:00' }, staffId: 'staff-123' },
        ],
      };

      (axios.get as jest.Mock).mockResolvedValue(mockResponse);

      const result = await getScheduleToday('staff-123');

      expect(axios.get).toHaveBeenCalledWith(
        'http://schedule-service:3002/schedules/internal/today?staffId=staff-123',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Bearer '),
          }),
          timeout: 10000,
        })
      );

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });

    it('should call schedule-service internal today endpoint without staffId when omitted', async () => {
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
