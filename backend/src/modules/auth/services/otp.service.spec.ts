import { ConfigService } from '@nestjs/config';
import { FakeRedis } from '../../../../test/utils/fake-redis.js';
import type { RedisService } from '../../../database/redis.service.js';
import type { OtpMessage, OtpSender } from './otp-sender.js';
import { OtpService } from './otp.service.js';

const config = {
  OTP_TTL_SECONDS: 600,
  OTP_MAX_ATTEMPTS: 5,
  OTP_RESEND_COOLDOWN_SECONDS: 60,
};

describe('OtpService', () => {
  let redis: FakeRedis;
  let sent: OtpMessage[];
  let service: OtpService;
  let clock: number;

  const lastCode = () => sent[sent.length - 1].code;
  const wrongCode = () => (lastCode() === '000000' ? '111111' : '000000');

  beforeEach(() => {
    clock = 1_000_000;
    redis = new FakeRedis();
    redis.now = () => clock;
    sent = [];
    const sender: OtpSender = {
      send: (m) => {
        sent.push(m);
        return Promise.resolve();
      },
    };
    service = new OtpService(
      redis as unknown as RedisService,
      {
        get: (k: keyof typeof config) => config[k],
      } as unknown as ConfigService,
      sender,
    );
  });

  it('sends a 6-digit code and accepts it once', async () => {
    await service.issue('verify_email', 'a@b.com');
    expect(lastCode()).toMatch(/^\d{6}$/);

    await expect(
      service.verify('verify_email', 'a@b.com', lastCode()),
    ).resolves.toBeUndefined();
    await expect(
      service.verify('verify_email', 'a@b.com', lastCode()),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('keeps codes for different purposes separate', async () => {
    await service.issue('verify_email', 'a@b.com');
    await expect(
      service.verify('reset_password', 'a@b.com', lastCode()),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('expires codes after the TTL', async () => {
    await service.issue('verify_email', 'a@b.com');
    clock += 601_000;
    await expect(
      service.verify('verify_email', 'a@b.com', lastCode()),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('invalidates the code after 5 wrong attempts', async () => {
    await service.issue('verify_email', 'a@b.com');
    const good = lastCode();

    for (let remaining = 4; remaining >= 1; remaining--) {
      await expect(
        service.verify('verify_email', 'a@b.com', wrongCode()),
      ).rejects.toMatchObject({
        code: 'OTP_INVALID',
        response: expect.objectContaining({ attemptsRemaining: remaining }),
      });
    }
    await expect(
      service.verify('verify_email', 'a@b.com', wrongCode()),
    ).rejects.toMatchObject({ code: 'OTP_ATTEMPTS_EXCEEDED' });

    // Even the correct code is now rejected.
    await expect(
      service.verify('verify_email', 'a@b.com', good),
    ).rejects.toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('enforces the resend cooldown, then allows a new code', async () => {
    await service.issue('verify_email', 'a@b.com');
    await expect(
      service.issue('verify_email', 'a@b.com'),
    ).rejects.toMatchObject({
      code: 'OTP_COOLDOWN',
      response: expect.objectContaining({ retryAfterSeconds: 60 }),
    });

    clock += 61_000;
    await service.issue('verify_email', 'a@b.com');
    expect(sent).toHaveLength(2);
  });

  it('a new code replaces the old one and resets attempts', async () => {
    await service.issue('verify_email', 'a@b.com');
    const first = lastCode();
    await expect(
      service.verify('verify_email', 'a@b.com', wrongCode()),
    ).rejects.toMatchObject({ code: 'OTP_INVALID' });

    clock += 61_000;
    await service.issue('verify_email', 'a@b.com');
    if (lastCode() !== first) {
      await expect(
        service.verify('verify_email', 'a@b.com', first),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ attemptsRemaining: 4 }),
      });
    }
    await expect(
      service.verify('verify_email', 'a@b.com', lastCode()),
    ).resolves.toBeUndefined();
  });
});
