process.env.JWT_SECRET = 'test-jwt-secret-12345678901234567890';
import { UserServiceClient, StaffUser } from '../clients/UserServiceClient';

describe('UserServiceClient Caching', () => {
  let client: UserServiceClient;
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    client = new UserServiceClient();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('should cache getStaff results and avoid duplicate fetch calls within TTL', async () => {
    const mockStaff: StaffUser = {
      id: 'staff-123',
      fullName: 'Test Staff',
      email: 'staff@example.com',
      role: 'staff',
      status: 'active',
    };

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(mockStaff),
    } as any);

    global.fetch = fetchMock;

    // First call -> should call fetch
    const result1 = await client.getStaff('staff-123');
    expect(result1).toEqual(mockStaff);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call with same ID -> should return from cache without calling fetch
    const result2 = await client.getStaff('staff-123');
    expect(result2).toEqual(mockStaff);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should cache listStaff results for specific IDs', async () => {
    const mockStaffList: StaffUser[] = [
      {
        id: 'staff-1',
        fullName: 'Staff 1',
        email: 'staff1@example.com',
        role: 'staff',
        status: 'active',
      },
    ];

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue(mockStaffList),
    } as any);

    global.fetch = fetchMock;

    // First call -> calls fetch
    const result1 = await client.listStaff(['staff-1']);
    expect(result1).toEqual(mockStaffList);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call -> returns from cache
    const result2 = await client.listStaff(['staff-1']);
    expect(result2).toEqual(mockStaffList);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
