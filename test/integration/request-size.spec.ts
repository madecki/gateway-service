import { NestFastifyApplication } from '@nestjs/platform-fastify';
import * as http from 'http';
import { createTestApp } from '../test-utils';

describe('Request Size Limit (e2e)', () => {
  let app: NestFastifyApplication;
  let mockUpstream: http.Server;
  let mockUpstreamPort: number;
  const bodyLimit = 1024; // 1KB for testing

  beforeAll(async () => {
    // Create mock upstream server
    mockUpstream = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true, bodyLength: body.length }));
      });
    });

    await new Promise<void>((resolve) => {
      mockUpstream.listen(0, () => {
        mockUpstreamPort = (mockUpstream.address() as { port: number }).port;
        resolve();
      });
    });

    // Set upstream URL
    process.env.AUTH_UPSTREAM_URL = `http://localhost:${mockUpstreamPort}`;
    process.env.REQUEST_BODY_LIMIT_BYTES = bodyLimit.toString();

    app = await createTestApp({ bodyLimit });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (mockUpstream) {
      await new Promise<void>((resolve) => mockUpstream.close(() => resolve()));
    }
  });

  it('should accept request body within limit', async () => {
    const smallBody = JSON.stringify({ data: 'a'.repeat(100) });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/test',
      headers: {
        'content-type': 'application/json',
      },
      payload: smallBody,
    });

    expect(response.statusCode).toBe(200);
  });

  it('should return 413 when request body exceeds limit', async () => {
    const largeBody = JSON.stringify({ data: 'a'.repeat(bodyLimit * 2) });

    const response = await app.inject({
      method: 'POST',
      url: '/auth/test',
      headers: {
        'content-type': 'application/json',
      },
      payload: largeBody,
    });

    expect(response.statusCode).toBe(413);
  });

  it('should handle empty body requests', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
  });
});
