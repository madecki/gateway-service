// Increase test timeout for integration tests
jest.setTimeout(30000);

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // Use random available port
process.env.TRUST_PROXY = 'false';
process.env.REQUEST_BODY_LIMIT_BYTES = '1024'; // Small limit for testing
process.env.RATE_LIMIT_MAX = '5'; // Small limit for testing
process.env.RATE_LIMIT_WINDOW_SECONDS = '60';
process.env.AUTH_RATE_LIMIT_MAX = '2';
process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS = '60';
process.env.UPSTREAM_TIMEOUT_MS = '5000';
process.env.LOG_LEVEL = 'silent';
