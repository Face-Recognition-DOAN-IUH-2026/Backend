/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^.*/shared/(.*)$': '<rootDir>/../shared/$1',
  },
  clearMocks: true,
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverage: false,
  moduleDirectories: ['node_modules', '<rootDir>/node_modules'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        rootDir: '.',
        rootDirs: ['<rootDir>/src', '<rootDir>/../shared'],
        baseUrl: '.',
        paths: {
          '../shared/*': ['../shared/*'],
        },
      },
      diagnostics: false,
    }],
  },
};
