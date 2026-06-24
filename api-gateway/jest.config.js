/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^.*/shared/error-handler$': '<rootDir>/../shared/error-handler',
    '^.*/shared/jira-client$': '<rootDir>/../shared/jira-client',
  },
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
  clearMocks: true,
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/proxy.ts',
  ],
};
