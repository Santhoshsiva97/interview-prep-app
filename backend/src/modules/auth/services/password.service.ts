import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

// argon2id with the OWASP-recommended minimum (19 MiB, 2 iterations, 1 lane).
const ARGON2_OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class PasswordService {
  /** Hash of a random string, used to equalize timing for unknown emails. */
  private readonly dummyHash = hash('timing-equalizer', ARGON2_OPTIONS);

  hash(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** Burn the same CPU as a real check so response time doesn't leak whether an account exists. */
  async verifyDummy(password: string): Promise<void> {
    await this.verify(await this.dummyHash, password);
  }
}
