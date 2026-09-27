export type OtpPurpose = 'verify_email' | 'reset_password';

export interface OtpMessage {
  email: string;
  code: string;
  purpose: OtpPurpose;
  expiresInSeconds: number;
  /** Changes the wording only; the code works the same (e.g. staff invites use reset codes). */
  intent?: 'staff_invite';
  /** Role being granted, for staff invites. */
  role?: string;
}

/**
 * Delivery channel for OTP codes. AuthModule binds OTP_SENDER to the Mail
 * Module's EmailOtpSender (Step 5), which queues a templated email.
 */
export interface OtpSender {
  send(message: OtpMessage): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');
