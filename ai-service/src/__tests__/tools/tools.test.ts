import axios from 'axios';
import { tools, createBorrowSlip } from '../../tools/tools';

jest.mock('../../config', () => ({
  config: {
    borrowServiceUrl: 'http://borrow-service:8000',
    userServiceUrl: 'http://user-service:3001',
    scheduleServiceUrl: 'http://schedule-service:3004',
    serviceJwtSecret: 'test-service-jwt-secret',
  },
}));

jest.mock('axios');

describe('AI Tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Gap 10: create_borrow_slip Tool', () => {
    it('should have create_borrow_slip tool in tools array', () => {
      const tool = tools.find(t => t.name === 'create_borrow_slip');
      expect(tool).toBeDefined();
    });

    it('should have correct description for create_borrow_slip', () => {
      const tool = tools.find(t => t.name === 'create_borrow_slip');
      expect(tool?.description).toContain('borrow');
      expect(tool?.description).toContain('slip');
    });

    it('should have func property for create_borrow_slip', () => {
      const tool = tools.find(t => t.name === 'create_borrow_slip');
      expect(tool?.func).toBeDefined();
      expect(typeof tool?.func).toBe('function');
    });

    it('should call borrow service API when createBorrowSlip is called', async () => {
      const mockResponse = {
        data: {
          success: true,
          data: { id: 'borrow-123', status: 'active' },
        },
      };

      (axios.post as jest.Mock).mockResolvedValue(mockResponse);

      const result = await createBorrowSlip('patron-123', [
        { bookCopyId: 'copy-1', dueDate: '2025-01-15' },
      ]);

      expect(axios.post).toHaveBeenCalledWith(
        'http://borrow-service:8000/borrow/internal/create',
        expect.objectContaining({
          patronId: 'patron-123',
          bookCopies: expect.any(Array),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': expect.stringContaining('Bearer '),
          }),
        })
      );

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });

    it('should handle errors when createBorrowSlip fails', async () => {
      (axios.post as jest.Mock).mockRejectedValue(new Error('Network error'));

      const result = await createBorrowSlip('patron-123', [
        { bookCopyId: 'copy-1', dueDate: '2025-01-15' },
      ]);

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });
});
