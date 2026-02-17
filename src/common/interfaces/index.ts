export interface GatewayErrorResponse {
  error: {
    code: string;
    message: string;
    correlationId: string;
  };
}

export interface HealthCheckResponse {
  status: 'ok';
  timestamp: string;
  uptime: number;
}

declare module 'fastify' {
  interface FastifyRequest {
    correlationId: string;
  }
}
