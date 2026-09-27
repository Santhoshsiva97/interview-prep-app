import { apiFetch, apiPost } from '../../lib/api';

export type UserRole =
  'candidate' | 'editor' | 'support' | 'admin' | 'super_admin';

export interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: 'pending_verification' | 'active' | 'suspended';
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  user: User;
}

interface MessageResponse {
  message: string;
}

export interface RegisterInput {
  name: string;
  email: string;
  phone: string;
  password: string;
}

export const authApi = {
  register: (input: RegisterInput) =>
    apiPost<{ email: string } & MessageResponse>('/auth/register', input),
  verifyEmail: (email: string, code: string) =>
    apiPost<AuthSession>('/auth/verify-email', { email, code }),
  resendVerification: (email: string) =>
    apiPost<MessageResponse>('/auth/verify-email/resend', { email }),
  login: (email: string, password: string) =>
    apiPost<AuthSession>('/auth/login', { email, password }),
  logout: () => apiPost<void>('/auth/logout'),
  forgotPassword: (email: string) =>
    apiPost<MessageResponse>('/auth/forgot-password', { email }),
  resetPassword: (email: string, code: string, newPassword: string) =>
    apiPost<MessageResponse>('/auth/reset-password', {
      email,
      code,
      newPassword,
    }),
  me: () => apiFetch<User>('/auth/me'),
};
