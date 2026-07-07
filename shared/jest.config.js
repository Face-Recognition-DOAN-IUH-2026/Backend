module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  clearMocks: true,
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'auth/**/*.ts',
    'utils/**/*.ts',
    '!**/__tests__/**',
    '!**/node_modules/**',
  ],
};
