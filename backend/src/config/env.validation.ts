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

  // ── Mail (FRD §4.5) ──
  /** `smtp` sends for real (SendGrid, SES, Mailpit…); `log` prints emails (dev/test only). */
  MAIL_TRANSPORT: 'smtp' | 'log';
  SMTP_HOST?: string;
  SMTP_PORT: number;
  /** true = implicit TLS (port 465); false = STARTTLS when offered (587/25). */
  SMTP_SECURE: boolean;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  /** e.g. `InterviewPrep <no-reply@yourdomain.com>` (must be a verified sender). */
  MAIL_FROM: string;
  MAIL_REPLY_TO?: string;
  /** Public URL of the web app, used for links inside emails. */
  APP_BASE_URL: string;
  /** Total send attempts per email (first try + retries), exponential backoff. */
  MAIL_MAX_ATTEMPTS: number;
  MAIL_RETRY_BASE_DELAY_MS: number;
  /** Run the mail worker in this process (disable to run workers separately). */
  MAIL_WORKER_ENABLED: boolean;

  // ── Exams (FRD §4.6) ──
  /** How often the exam runtime autosaves answers + remaining time. */
  EXAM_AUTOSAVE_INTERVAL_SECONDS: number;
  /**
   * A gap between saves longer than this counts as a disconnection. For
   * pause-on-disconnect exams only this much of the gap is charged.
   */
  EXAM_OFFLINE_GRACE_SECONDS: number;
  /** Pause-on-disconnect attempts not resumed within this are auto-submitted. */
  EXAM_ABANDON_AFTER_HOURS: number;
  /** Run the expiry sweep in this process. */
  EXAM_SWEEPER_ENABLED: boolean;
  EXAM_SWEEP_INTERVAL_SECONDS: number;
  /**
   * Code execution (FRD §4.7): `judge0` = sandboxed Judge0 (production),
   * `local` = unsandboxed child processes (dev only), `disabled` = none.
   */
  CODE_RUNNER: 'disabled' | 'local' | 'judge0';
  CODE_RUN_COOLDOWN_SECONDS: number;

  // ── Judge (FRD §4.7) ──
  /** Judge0 CE base URL, e.g. http://judge0-server:2358 (required for CODE_RUNNER=judge0). */
  JUDGE0_URL?: string;
  /** Header for the Judge0 auth token (Judge0's AUTHN_HEADER). */
  JUDGE0_AUTH_HEADER: string;
  JUDGE0_AUTH_TOKEN?: string;
  /** Give up waiting for one batch of results after this long (the job is retried). */
  JUDGE0_TIMEOUT_SECONDS: number;
  /** Run the judge queue worker in this process. */
  JUDGE_WORKER_ENABLED: boolean;
  JUDGE_WORKER_CONCURRENCY: number;
  /** Attempts per judge job (runs and grading), exponential backoff. */
  JUDGE_MAX_ATTEMPTS: number;
  JUDGE_RETRY_BASE_DELAY_MS: number;

  // ── Analytics (FRD §4.9) ──
  /** Rebuild question_stats this often (minutes); 0 = only on demand. */
  ANALYTICS_REFRESH_MINUTES: number;
  /** Run the analytics queue worker in this process. */
  ANALYTICS_WORKER_ENABLED: boolean;
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

  MAIL_TRANSPORT: Joi.string()
    .valid('smtp', 'log')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.valid('smtp').default('smtp'),
      otherwise: Joi.string().default('log'),
    }),
  SMTP_HOST: Joi.string().hostname().when('MAIL_TRANSPORT', {
    is: 'smtp',
    then: Joi.required(),
  }),
  SMTP_PORT: Joi.number().port().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string(),
  SMTP_PASS: Joi.string(),
  MAIL_FROM: Joi.string().default(
    'InterviewPrep <no-reply@interviewprep.local>',
  ),
  MAIL_REPLY_TO: Joi.string().email(),
  APP_BASE_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .default('http://localhost:5173'),
  MAIL_MAX_ATTEMPTS: Joi.number().integer().min(1).max(10).default(3),
  MAIL_RETRY_BASE_DELAY_MS: Joi.number().integer().min(100).default(10_000),
  MAIL_WORKER_ENABLED: Joi.boolean().default(true),

  EXAM_AUTOSAVE_INTERVAL_SECONDS: Joi.number()
    .integer()
    .min(5)
    .max(120)
    .default(15),
  // Must comfortably exceed the autosave interval, or connected candidates look offline.
  EXAM_OFFLINE_GRACE_SECONDS: Joi.number()
    .integer()
    .min(
      Joi.ref('EXAM_AUTOSAVE_INTERVAL_SECONDS', {
        adjust: (v: number) => v * 2,
      }),
    )
    .default(45),
  EXAM_ABANDON_AFTER_HOURS: Joi.number().integer().min(1).default(24),
  EXAM_SWEEPER_ENABLED: Joi.boolean().default(true),
  EXAM_SWEEP_INTERVAL_SECONDS: Joi.number().integer().min(5).default(60),
  // `local` runs candidate code unsandboxed: never allowed in production.
  CODE_RUNNER: Joi.string()
    .valid('disabled', 'local', 'judge0')
    .when('NODE_ENV', {
      is: 'production',
      then: Joi.valid('disabled', 'judge0').default('disabled'),
      otherwise: Joi.string().default('disabled'),
    }),
  CODE_RUN_COOLDOWN_SECONDS: Joi.number().integer().min(0).default(3),

  JUDGE0_URL: Joi.string()
    .uri({ scheme: ['http', 'https'] })
    .when('CODE_RUNNER', { is: 'judge0', then: Joi.required() }),
  JUDGE0_AUTH_HEADER: Joi.string().default('X-Auth-Token'),
  JUDGE0_AUTH_TOKEN: Joi.string(),
  JUDGE0_TIMEOUT_SECONDS: Joi.number().integer().min(5).default(60),
  JUDGE_WORKER_ENABLED: Joi.boolean().default(true),
  JUDGE_WORKER_CONCURRENCY: Joi.number().integer().min(1).max(50).default(4),
  JUDGE_MAX_ATTEMPTS: Joi.number().integer().min(1).max(10).default(3),
  JUDGE_RETRY_BASE_DELAY_MS: Joi.number().integer().min(100).default(5000),

  ANALYTICS_REFRESH_MINUTES: Joi.number()
    .integer()
    .min(0)
    .max(1440)
    .default(15),
  ANALYTICS_WORKER_ENABLED: Joi.boolean().default(true),
});
