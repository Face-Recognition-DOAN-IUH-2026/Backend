import { membershipExpiryCheck } from '../../handlers/membershipExpiryCheck';
import { userClient, notificationClient, emailClient } from '../../clients/serviceClients';

const mockUserClient = userClient as jest.Mocked<typeof userClient>;
const mockNotificationClient = notificationClient as jest.Mocked<typeof notificationClient>;
const mockEmailClient = emailClient as jest.Mocked<typeof emailClient>;

describe('membershipExpiryCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 0 when no expiring memberships', async () => {
    mockUserClient.getExpiringMemberships = jest.fn().mockResolvedValue([]);

    const result = await membershipExpiryCheck({ days_before: 7 });

    expect(result.checked).toBe(0);
    expect(result.notified).toBe(0);
  });

  it('should create notifications for expiring users', async () => {
    const expiryDate = new Date(Date.now() + 5 * 86400000).toISOString();
    const mockUsers = [
      { id: 'u1', email: 'user1@test.com', membershipExpiry: expiryDate },
      { id: 'u2', email: 'user2@test.com', membershipExpiry: expiryDate },
    ];
    mockUserClient.getExpiringMemberships = jest.fn().mockResolvedValue(mockUsers);

    const result = await membershipExpiryCheck({ days_before: 7 });

    expect(result.checked).toBe(2);
    expect(result.notified).toBe(2);
    expect(mockNotificationClient.createBulkNotifications).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'u1', type: 'membership_expiry' }),
      expect.objectContaining({ userId: 'u2', type: 'membership_expiry' }),
    ]);
  });

  it('should send expiry emails for users with email', async () => {
    const expiryDate = new Date(Date.now() + 3 * 86400000).toISOString();
    const mockUsers = [
      { id: 'u1', email: 'user@test.com', membershipExpiry: expiryDate },
    ];
    mockUserClient.getExpiringMemberships = jest.fn().mockResolvedValue(mockUsers);

    await membershipExpiryCheck({ days_before: 7 });

    expect(mockEmailClient.sendMembershipExpiryEmail).toHaveBeenCalledWith('user@test.com', expiryDate);
  });

  it('should not send email when user has no email', async () => {
    const expiryDate = new Date(Date.now() + 3 * 86400000).toISOString();
    const mockUsers = [
      { id: 'u1', membershipExpiry: expiryDate },
    ];
    mockUserClient.getExpiringMemberships = jest.fn().mockResolvedValue(mockUsers);

    await membershipExpiryCheck({ days_before: 7 });

    expect(mockEmailClient.sendMembershipExpiryEmail).not.toHaveBeenCalled();
  });

  it('should not crash when email send fails', async () => {
    const expiryDate = new Date(Date.now() + 3 * 86400000).toISOString();
    const mockUsers = [
      { id: 'u1', email: 'user@test.com', membershipExpiry: expiryDate },
    ];
    mockUserClient.getExpiringMemberships = jest.fn().mockResolvedValue(mockUsers);
    mockEmailClient.sendMembershipExpiryEmail = jest.fn().mockRejectedValue(new Error('SMTP error'));

    const result = await membershipExpiryCheck({ days_before: 7 });

    expect(result.notified).toBe(1);
  });

  it('should return error when fetch fails', async () => {
    mockUserClient.getExpiringMemberships = jest.fn().mockRejectedValue(new Error('Failed to fetch expiring memberships'));

    const result = await membershipExpiryCheck({ days_before: 7 });

    expect(result.checked).toBe(0);
    expect(result.message).toContain('Error checking membership expiry');
  });
});
