import { EmailService } from '../../services/EmailService';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'mock-message-id' }),
  }),
}));

describe('EmailService', () => {
  let emailService: EmailService;
  let mockSendMail: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    emailService = new EmailService();
    mockSendMail = (emailService as any).transporter.sendMail;
  });

  describe('sendPasswordResetCode', () => {
    it('should send email with correct subject and code', async () => {
      await emailService.sendPasswordResetCode('test@example.com', '123456');

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: expect.stringContaining('khôi phục mật khẩu'),
        })
      );
    });

    it('should include the 6-digit code in email body', async () => {
      await emailService.sendPasswordResetCode('test@example.com', '654321');

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('654321');
    });
  });

  describe('sendOverdueEmail', () => {
    it('should send email with correct subject', async () => {
      await emailService.sendOverdueEmail('test@example.com', 'Test Book', 5);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: expect.stringContaining('Nhắc trả sách'),
        })
      );
    });

    it('should include book title and days overdue in body', async () => {
      await emailService.sendOverdueEmail('test@example.com', 'Great Gatsby', 3);

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('Great Gatsby');
      expect(html).toContain('3');
    });
  });

  describe('sendFineEmail', () => {
    it('should send email with correct subject', async () => {
      await emailService.sendFineEmail('test@example.com', 'Book', 15000, 5);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: expect.stringContaining('phí quá hạn'),
        })
      );
    });

    it('should include fine amount in body', async () => {
      await emailService.sendFineEmail('test@example.com', 'Book', 25000, 3);

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('25.000');
    });

    it('should include book title in body', async () => {
      await emailService.sendFineEmail('test@example.com', 'My Book', 5000, 1);

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('My Book');
    });
  });

  describe('sendMembershipExpiryEmail', () => {
    it('should send email with correct subject', async () => {
      await emailService.sendMembershipExpiryEmail('test@example.com', new Date('2026-07-01'));

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: expect.stringContaining('hết hạn'),
        })
      );
    });

    it('should include formatted expiry date in body', async () => {
      const expiryDate = new Date('2026-12-31');
      await emailService.sendMembershipExpiryEmail('test@example.com', expiryDate);

      const html = mockSendMail.mock.calls[0][0].html;
      expect(html).toContain('31/12/2026');
    });
  });
});
