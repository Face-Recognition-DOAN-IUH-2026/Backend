import { fetchAndMergeSpecs, SERVICE_REGISTRY } from '../config/swagger';

jest.mock('axios');
const axios = require('axios');

const mockUserSpec = {
  openapi: '3.0.0',
  info: { title: 'user-service API', version: '1.0.0' },
  paths: {
    '/patrons': { get: { tags: ['patrons'], summary: 'List patrons' } },
    '/patrons/{id}': { get: { tags: ['patrons'], summary: 'Get patron' } },
  },
  components: { schemas: { PatronPublic: { type: 'object' } } },
};

const mockBorrowSpec = {
  openapi: '3.0.0',
  info: { title: 'borrow-service API', version: '1.0.0' },
  paths: {
    '/borrows': { get: { tags: ['borrows'], summary: 'List borrows' } },
  },
  components: { schemas: { BorrowRecord: { type: 'object' } } },
};

describe('Swagger Merge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should merge specs from multiple services', async () => {
    axios.get.mockImplementation((url: string) => {
      if (url.includes('user-service')) return Promise.resolve({ data: mockUserSpec });
      if (url.includes('borrow-service')) return Promise.resolve({ data: mockBorrowSpec });
      return Promise.reject(new Error('Unknown service'));
    });

    const merged = await fetchAndMergeSpecs();

    expect(merged.openapi).toBe('3.0.0');
    expect(merged.info.title).toBe('IUH Library System — Unified API');
    expect(merged.paths['/user/patrons']).toBeDefined();
    expect(merged.paths['/user/patrons/{id}']).toBeDefined();
    expect(merged.paths['/borrow/borrows']).toBeDefined();
  });

  it('should add service tags to each endpoint', async () => {
    axios.get.mockImplementation((url: string) => {
      if (url.includes('user-service')) return Promise.resolve({ data: mockUserSpec });
      return Promise.reject(new Error('Unknown'));
    });

    const merged = await fetchAndMergeSpecs();

    expect(merged.tags).toBeDefined();
    const tagNames = merged.tags!.map((t: any) => t.name);
    expect(tagNames).toContain('user-service');
  });

  it('should gracefully handle unreachable services', async () => {
    axios.get.mockImplementation((url: string) => {
      if (url.includes('user-service')) return Promise.resolve({ data: mockUserSpec });
      return Promise.reject(new Error('ECONNREFUSED'));
    });

    const merged = await fetchAndMergeSpecs();

    expect(merged.paths['/user/patrons']).toBeDefined();
    // Other services' paths should not exist
    const nonUserPaths = Object.keys(merged.paths).filter(p => p.startsWith('/borrow'));
    expect(nonUserPaths).toHaveLength(0);
  });

  it('should handle empty service registry', async () => {
    axios.get.mockRejectedValue(new Error('All down'));

    const merged = await fetchAndMergeSpecs();

    expect(merged.openapi).toBe('3.0.0');
    expect(Object.keys(merged.paths)).toHaveLength(0);
  });

  it('should prefix paths correctly for each service', async () => {
    axios.get.mockImplementation((url: string) => {
      if (url.includes('user-service')) return Promise.resolve({ data: mockUserSpec });
      if (url.includes('borrow-service')) return Promise.resolve({ data: mockBorrowSpec });
      return Promise.reject(new Error('Unknown'));
    });

    const merged = await fetchAndMergeSpecs();

    // user-service paths prefixed with /user
    expect(merged.paths['/user/patrons']).toBeDefined();
    expect(merged.paths['/user/patrons/{id}']).toBeDefined();
    // borrow-service paths prefixed with /borrow
    expect(merged.paths['/borrow/borrows']).toBeDefined();
    // Original paths should not exist
    expect(merged.paths['/patrons']).toBeUndefined();
    expect(merged.paths['/borrows']).toBeUndefined();
  });
});
