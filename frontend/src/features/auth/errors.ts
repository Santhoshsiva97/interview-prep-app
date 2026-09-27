import { ApiError, errorMessage } from '../../lib/api';

/** Error text for OTP forms, including the attempts left after a wrong code. */
export function otpErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === 'OTP_INVALID') {
    const left = err.detail<number>('attemptsRemaining');
    if (left !== undefined) {
      return `Incorrect code. ${left} attempt${left === 1 ? '' : 's'} left.`;
    }
  }
  return errorMessage(err);
}
