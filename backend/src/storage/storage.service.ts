import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { EnvVars } from '../config/env.validation.js';

export interface SignedUrlOptions {
  /** Forces a download with this file name instead of inline display. */
  downloadFileName?: string;
}

/**
 * S3-compatible object storage (AWS S3, MinIO, R2, …). The bucket is private;
 * clients only ever get short-lived presigned GET URLs.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  /** Signs URLs against the browser-reachable endpoint (signing is offline). */
  private readonly presignClient: S3Client;
  private readonly bucket: string;
  private readonly urlTtl: number;
  private readonly autoCreateBucket: boolean;

  constructor(config: ConfigService<EnvVars, true>) {
    const endpoint = config.get('S3_ENDPOINT', { infer: true });
    const accessKeyId = config.get('S3_ACCESS_KEY_ID', { infer: true });
    const secretAccessKey = config.get('S3_SECRET_ACCESS_KEY', { infer: true });
    const base: S3ClientConfig = {
      region: config.get('S3_REGION', { infer: true }),
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      // Without explicit keys the SDK's default chain (env, IAM role, …) is used.
      ...(accessKeyId &&
        secretAccessKey && { credentials: { accessKeyId, secretAccessKey } }),
    };

    this.client = new S3Client({ ...base, endpoint });
    this.presignClient = new S3Client({
      ...base,
      endpoint: config.get('S3_PUBLIC_ENDPOINT', { infer: true }) ?? endpoint,
    });
    this.bucket = config.get('S3_BUCKET', { infer: true });
    this.urlTtl = config.get('S3_PRESIGNED_URL_TTL_SECONDS', { infer: true });
    this.autoCreateBucket = config.get('S3_AUTO_CREATE_BUCKET', {
      infer: true,
    });
  }

  async onModuleInit(): Promise<void> {
    if (!this.autoCreateBucket) return;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Created bucket "${this.bucket}"`);
      } catch (err) {
        // Don't block startup; uploads will fail with a clear error instead.
        this.logger.warn(
          `Storage unavailable — could not ensure bucket "${this.bucket}": ${String(err)}`,
        );
      }
    }
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  getSignedUrl(key: string, options: SignedUrlOptions = {}): Promise<string> {
    return getSignedUrl(
      this.presignClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ...(options.downloadFileName && {
          ResponseContentDisposition: contentDisposition(
            options.downloadFileName,
          ),
        }),
      }),
      { expiresIn: this.urlTtl },
    );
  }
}

/** RFC 6266 attachment header with an ASCII fallback + UTF-8 file name. */
function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
