/**
 * Minimal in-memory stand-in for the ioredis commands the app uses.
 * (ioredis-mock doesn't support ioredis 6 yet.)
 */
export class FakeRedis {
  private store = new Map<string, { value: string; expiresAt?: number }>();
  now = () => Date.now();

  private live(key: string) {
    const entry = this.store.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.live(key)?.value ?? null);
  }

  set(
    key: string,
    value: string,
    ...args: (string | number)[]
  ): Promise<'OK' | null> {
    const nx = args.includes('NX');
    const exIndex = args.indexOf('EX');
    if (nx && this.live(key)) return Promise.resolve(null);
    const expiresAt =
      exIndex >= 0 ? this.now() + Number(args[exIndex + 1]) * 1000 : undefined;
    this.store.set(key, { value, expiresAt });
    return Promise.resolve('OK');
  }

  incr(key: string): Promise<number> {
    const entry = this.live(key);
    const next = Number(entry?.value ?? 0) + 1;
    this.store.set(key, { value: String(next), expiresAt: entry?.expiresAt });
    return Promise.resolve(next);
  }

  expire(key: string, seconds: number): Promise<number> {
    const entry = this.live(key);
    if (!entry) return Promise.resolve(0);
    entry.expiresAt = this.now() + seconds * 1000;
    return Promise.resolve(1);
  }

  ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return Promise.resolve(-2);
    if (entry.expiresAt === undefined) return Promise.resolve(-1);
    return Promise.resolve(Math.ceil((entry.expiresAt - this.now()) / 1000));
  }

  del(...keys: string[]): Promise<number> {
    return Promise.resolve(keys.filter((k) => this.store.delete(k)).length);
  }

  ping(): Promise<string> {
    return Promise.resolve('PONG');
  }
}
