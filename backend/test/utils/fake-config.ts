import type { ConfigService } from '@nestjs/config';
import type { EnvVars } from '../../src/config/env.validation.js';

/** ConfigService stand-in backed by a plain object. */
export const fakeConfig = (values: Partial<Record<keyof EnvVars, unknown>>) =>
  ({
    get: (key: keyof EnvVars) => values[key],
  }) as unknown as ConfigService<EnvVars, true>;
