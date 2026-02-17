import { Controller, Get } from '@nestjs/common';
import { HealthCheckResponse } from '../common/interfaces';

@Controller()
export class HealthController {
  private readonly startTime = Date.now();

  @Get('health')
  getHealth(): HealthCheckResponse {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }
}
