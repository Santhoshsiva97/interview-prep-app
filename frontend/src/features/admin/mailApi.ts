import { apiFetch, apiFetchText } from '../../lib/api';
import type { Paginated } from './api';

// Mirrors backend/src/modules/mail (admin endpoints).

export type MailStatus = 'queued' | 'sending' | 'retrying' | 'sent' | 'failed';

export interface MailRecord {
  id: string;
  toAddress: string;
  template: string;
  subject: string;
  status: MailStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  lastAttemptAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  userId: string | null;
}

export interface MailTemplateInfo {
  name: string;
  subject: string;
  /** Exists but nothing sends it yet. */
  placeholder: boolean;
}

export const MAIL_STATUS_LABELS: Record<MailStatus, string> = {
  queued: 'Queued',
  sending: 'Sending',
  retrying: 'Retrying',
  sent: 'Sent',
  failed: 'Failed',
};

export const TEMPLATE_LABELS: Record<string, string> = {
  verify_email: 'Email verification',
  reset_password: 'Password reset',
  staff_invite: 'Staff invite',
  exam_reminder: 'Exam reminder',
};

export const mailApi = {
  list: (q: { search?: string; status?: MailStatus; page?: number }) => {
    const params = new URLSearchParams();
    if (q.search) params.set('search', q.search);
    if (q.status) params.set('status', q.status);
    if (q.page) params.set('page', String(q.page));
    return apiFetch<Paginated<MailRecord>>(`/admin/mail?${params}`);
  },
  templates: () => apiFetch<MailTemplateInfo[]>('/admin/mail/templates'),
  preview: (name: string) =>
    apiFetchText(`/admin/mail/templates/${encodeURIComponent(name)}/preview`),
};
