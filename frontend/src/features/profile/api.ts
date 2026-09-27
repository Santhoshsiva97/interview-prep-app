import { apiDelete, apiFetch, apiPatch, apiPut } from '../../lib/api';
import type { User } from '../auth/api';

export interface ProfileDetails {
  headline: string | null;
  bio: string | null;
  location: string | null;
  targetRole: string | null;
  experienceYears: number | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
}

export interface ResumeInfo {
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  url: string;
}

export interface ProfileCompleteness {
  percent: number;
  missing: string[];
}

export interface Profile {
  user: User;
  profile: ProfileDetails;
  avatarUrl: string | null;
  resume: ResumeInfo | null;
  completeness: ProfileCompleteness;
}

export type ProfileUpdate = Partial<ProfileDetails> & {
  name?: string;
  phone?: string;
};

// Mirrors the server limits (backend/src/modules/profile/models/upload-rules.ts).
export const AVATAR_UPLOAD = {
  maxBytes: 2 * 1024 * 1024,
  accept: 'image/jpeg,image/png,image/webp',
  label: 'JPG, PNG or WebP, up to 2 MB',
};
export const RESUME_UPLOAD = {
  maxBytes: 5 * 1024 * 1024,
  accept:
    '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  label: 'PDF, DOC or DOCX, up to 5 MB',
};

const fileBody = (file: File) => {
  const form = new FormData();
  form.append('file', file);
  return form;
};

export const profileApi = {
  get: () => apiFetch<Profile>('/me/profile'),
  update: (changes: ProfileUpdate) => apiPatch<Profile>('/me/profile', changes),
  uploadAvatar: (file: File) => apiPut<Profile>('/me/avatar', fileBody(file)),
  removeAvatar: () => apiDelete<Profile>('/me/avatar'),
  uploadResume: (file: File) => apiPut<Profile>('/me/resume', fileBody(file)),
  removeResume: () => apiDelete<Profile>('/me/resume'),
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
