import { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../config/env.validation.js';
import { FakeRedis } from '../../../test/utils/fake-redis.js';
import type { RedisService } from '../../database/redis.service.js';
import { SessionRevocationService } from './session-revocation.service.js';

describe('SessionRevocationService', () => {
  const config = { get: () => 900 } as unknown as ConfigService<EnvVars, true>;
  let redis: FakeRedis;
  let service: SessionRevocationService;

  beforeEach(() => {
    vi.useFakeTimers({ now: 1_000_000 });
    redis = new FakeRedis();
    service = new SessionRevocationService(
      redis as unknown as RedisService,
      config,
    );
  });
  afterEach(() => vi.useRealTimers());

  it('rejects tokens issued up to the revocation instant, not after', async () => {
    await service.revokeAccessTokens('u1');
    expect(await service.isRevoked('u1', 999_000)).toBe(true);
    expect(await service.isRevoked('u1', 1_000_000)).toBe(true); // same ms
    expect(await service.isRevoked('u1', 1_000_001)).toBe(false);
    expect(await service.isRevoked('other-user', 999_000)).toBe(false);
  });

  it('expires the marker after one access-token lifetime', async () => {
    await service.revokeAccessTokens('u1');
    vi.setSystemTime(1_000_000 + 901_000);
    expect(await service.isRevoked('u1', 999_000)).toBe(false);
  });

  it('fails open when Redis is unavailable', async () => {
    const broken = {
      get: () => Promise.reject(new Error('ECONNREFUSED')),
    } as unknown as RedisService;
    const s = new SessionRevocationService(broken, config);
    expect(await s.isRevoked('u1', 0)).toBe(false);
  });
});
