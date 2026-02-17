import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as http from 'http';
import { CORRELATION_ID_HEADER } from '../../src/common/constants';
import { createTestApp } from '../test-utils';

describe('Correlation ID (e2e)', () => {
  let app: NestFastifyApplication;
  let mockUpstream: http.Server;
  let mockUpstreamPort: number;
  let receivedHeaders: http.IncomingHttpHeaders;

  beforeAll(async () => {
    // Create mock upstream server
    mockUpstream = http.createServer((req, res) => {
      receivedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({ received: true, correlationId: req.headers[CORRELATION_ID_HEADER] }),
      );
    });

    await new Promise<void>((resolve) => {
      mockUpstream.listen(0, () => {
        mockUpstreamPort = (mockUpstream.address() as { port: number }).port;
        resolve();
      });
    });

    // Set upstream URL
    process.env.AUTH_UPSTREAM_URL = `http://localhost:${mockUpstreamPort}`;

    app = await createTestApp();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (mockUpstream) {
      await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
    }
  });

  beforeEach(() => {
    receivedHeaders = {};
  });

  it('should generate correlation ID when missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[CORRELATION_ID_HEADER]).toBeDefined();
    expect(response.headers[CORRELATION_ID_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('should preserve existing correlation ID', async () => {
    const existingCorrelationId = 'test-correlation-id-12345';

    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        [CORRELATION_ID_HEADER]: existingCorrelationId,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers[CORRELATION_ID_HEADER]).toBe(existingCorrelationId);
  });

  it('should propagate correlation ID to upstream', async () => {
    const correlationId = 'upstream-test-correlation-id';

    const response = await app.inject({
      method: 'GET',
      url: '/auth/test',
      headers: {
        [CORRELATION_ID_HEADER]: correlationId,
      },
    });

    // Wait a bit for the request to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(response.headers[CORRELATION_ID_HEADER]).toBe(correlationId);
    expect(receivedHeaders[CORRELATION_ID_HEADER]).toBe(correlationId);
  });

  it('should generate and propagate correlation ID to upstream when missing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/test',
    });

    // Wait a bit for the request to be processed
    await new Promise((resolve) => setTimeout(resolve, 100));

    const responseCorrelationId = response.headers[CORRELATION_ID_HEADER];
    expect(responseCorrelationId).toBeDefined();
    expect(receivedHeaders[CORRELATION_ID_HEADER]).toBe(responseCorrelationId);
  });
});
