import type { SignedUrlOptions } from '../../src/storage/storage.service.js';

/** In-memory stand-in for StorageService. */
export class FakeStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
    return Promise.resolve();
  }

  deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  getSignedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    const dl = options.downloadFileName
      ? `?download=${encodeURIComponent(options.downloadFileName)}`
      : '';
    return Promise.resolve(`https://storage.test/${key}${dl}`);
  }
}
