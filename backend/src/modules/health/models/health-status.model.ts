export type DependencyStatus = 'up' | 'down';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  checks: {
    database: DependencyStatus;
    redis: DependencyStatus;
  };
  timestamp: string;
}
