/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  clearMocks: true,
  collectCoverage: false,
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      diagnostics: false,
    }],
  },
};
