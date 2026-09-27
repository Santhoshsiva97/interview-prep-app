import Joi from 'joi';

export interface EnvVars {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGINS: string;

  // ── Auth ──
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_DAYS: number;
  /** Set the Secure flag on the refresh cookie (requires HTTPS). */
  COOKIE_SECURE: boolean;
  OTP_TTL_SECONDS: number;
  OTP_MAX_ATTEMPTS: number;
  OTP_RESEND_COOLDOWN_SECONDS: number;
  AUTH_MAX_FAILED_LOGINS: number;
  AUTH_LOCKOUT_MINUTES: number;

  // ── Object storage (S3-compatible: AWS S3, MinIO, R2, …) ──
  /** Omit for AWS S3; set for MinIO/R2 etc. (e.g. http://minio:9000). */
  S3_ENDPOINT?: string;
  /** Endpoint browsers use for presigned URLs, if different from S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT?: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  /** Path-style URLs (required by MinIO). */
  S3_FORCE_PATH_STYLE: boolean;
  /** Create the bucket on startup if missing (dev convenience). */
  S3_AUTO_CREATE_BUCKET: boolean;
  S3_PRESIGNED_URL_TTL_SECONDS: number;
}

// Validated once at boot; the app refuses to start on a bad/missing value.
export const envValidationSchema = Joi.object<EnvVars, true>({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgres', 'postgresql'] })
    .required(),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .required(),
  CORS_ORIGINS: Joi.string().default('http://localhost:5173'),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL_SECONDS: Joi.number().integer().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: Joi.number().integer().min(1).default(30),
  COOKIE_SECURE: Joi.boolean().when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().default(true),
    otherwise: Joi.boolean().default(false),
  }),
  // FRD §4.1: OTP valid for 5–10 minutes, max 5 attempts, resend cooldown.
  OTP_TTL_SECONDS: Joi.number().integer().min(300).max(600).default(600),
  OTP_MAX_ATTEMPTS: Joi.number().integer().min(1).default(5),
  OTP_RESEND_COOLDOWN_SECONDS: Joi.number().integer().min(0).default(60),
  // FRD §4.1: lock the account after 5 consecutive failed logins.
  AUTH_MAX_FAILED_LOGINS: Joi.number().integer().min(1).default(5),
  AUTH_LOCKOUT_MINUTES: Joi.number().integer().min(1).default(15),

  S3_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }),
  S3_PUBLIC_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string().default('interview-prep'),
  S3_ACCESS_KEY_ID: Joi.string(),
  S3_SECRET_ACCESS_KEY: Joi.string(),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  S3_AUTO_CREATE_BUCKET: Joi.boolean().when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().default(false),
    otherwise: Joi.boolean().default(true),
  }),
  S3_PRESIGNED_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(604800)
    .default(3600),
});
