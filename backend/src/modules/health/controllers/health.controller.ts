import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator.js';
import { HealthService } from '../services/health.service.js';
import type { HealthStatus } from '../models/health-status.model.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** GET /api/v1/health — 200 when all dependencies are up, 503 otherwise. */
  @Get()
  async check(): Promise<HealthStatus> {
    const result = await this.healthService.check();
    if (result.status !== 'ok') {
      throw new ServiceUnavailableException(result);
    }
    return result;
  }
}
