import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../../database/prisma.service.js';
import type { User } from '../../../generated/prisma/client.js';
import { AuthService } from './auth.service.js';
import type { OtpService } from './otp.service.js';
import type { PasswordService } from './password.service.js';
import type { TokenService } from './token.service.js';

const baseUser: User = {
  id: 'u1',
  name: 'Asha',
  email: 'asha@example.com',
  phone: '+919876543210',
  passwordHash: 'hash',
  role: 'candidate',
  status: 'active',
  emailVerifiedAt: new Date(),
  failedLoginAttempts: 0,
  lockedUntil: null,
  lastLoginAt: null,
  passwordChangedAt: null,
  googleId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

describe('AuthService.login', () => {
  let user: User;
  let prisma: {
    user: {
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
  let passwords: {
    verify: ReturnType<typeof vi.fn>;
    verifyDummy: ReturnType<typeof vi.fn>;
  };
  let tokens: { issueSession: ReturnType<typeof vi.fn> };
  let service: AuthService;

  const login = (password: string) =>
    service.login({ email: user.email, password }, {});

  beforeEach(() => {
    user = { ...baseUser };
    prisma = {
      user: {
        findFirst: vi.fn(() => Promise.resolve({ ...user })),
        // Applies the update to our in-memory user, including { increment }.
        update: vi.fn(({ data }: { data: Record<string, unknown> }) => {
          for (const [k, v] of Object.entries(data)) {
            const inc = (v as { increment?: number } | null)?.increment;
            (user as Record<string, unknown>)[k] =
              inc !== undefined ? (user[k as keyof User] as number) + inc : v;
          }
          return Promise.resolve({ ...user });
        }),
      },
    };
    passwords = {
      verify: vi.fn((_hash: string, pw: string) =>
        Promise.resolve(pw === 'correct-pw1'),
      ),
      verifyDummy: vi.fn(() => Promise.resolve()),
    };
    tokens = {
      issueSession: vi.fn(() => Promise.resolve({ accessToken: 'at' })),
    };
    const config = {
      get: (k: string) =>
        ({ AUTH_MAX_FAILED_LOGINS: 5, AUTH_LOCKOUT_MINUTES: 15 })[k],
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      passwords as unknown as PasswordService,
      {} as OtpService,
      tokens as unknown as TokenService,
      config as unknown as ConfigService,
    );
  });

  it('logs in with the right password and resets the failure counter', async () => {
    user.failedLoginAttempts = 3;
    await expect(login('correct-pw1')).resolves.toEqual({ accessToken: 'at' });
    expect(user.failedLoginAttempts).toBe(0);
    expect(user.lastLoginAt).toBeInstanceOf(Date);
  });

  it('rejects unknown emails with the same error, after a dummy hash check', async () => {
    prisma.user.findFirst.mockResolvedValueOnce(null);
    await expect(login('whatever1')).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    expect(passwords.verifyDummy).toHaveBeenCalled();
  });

  it('locks the account on the 5th consecutive failure', async () => {
    for (let i = 0; i < 4; i++) {
      await expect(login('wrong-pw1')).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    }
    await expect(login('wrong-pw1')).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
    });
    expect(user.lockedUntil!.getTime()).toBeGreaterThan(
      Date.now() + 14 * 60_000,
    );

    // While locked, even the correct password is refused (and not checked).
    passwords.verify.mockClear();
    await expect(login('correct-pw1')).rejects.toMatchObject({
      code: 'ACCOUNT_LOCKED',
    });
    expect(passwords.verify).not.toHaveBeenCalled();
  });

  it('allows login again once the lock has expired', async () => {
    user.lockedUntil = new Date(Date.now() - 1000);
    await expect(login('correct-pw1')).resolves.toEqual({ accessToken: 'at' });
    expect(user.lockedUntil).toBeNull();
  });

  it('requires email verification', async () => {
    user.status = 'pending_verification';
    await expect(login('correct-pw1')).rejects.toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
    });
  });

  it('rejects suspended accounts', async () => {
    user.status = 'suspended';
    await expect(login('correct-pw1')).rejects.toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
    });
  });
});
