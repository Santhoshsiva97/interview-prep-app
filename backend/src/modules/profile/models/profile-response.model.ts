import type { PublicUser } from '../../auth/models/auth-response.model.js';

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
  uploadedAt: Date;
  /** Short-lived presigned download URL. */
  url: string;
}

export interface ProfileCompleteness {
  /** 0–100 */
  percent: number;
  /** Human-readable labels of what's still missing, in suggested order. */
  missing: string[];
}

/** GET/PATCH /me/profile and upload responses. */
export interface ProfileResponse {
  user: PublicUser;
  profile: ProfileDetails;
  /** Short-lived presigned URL, or null if no photo. */
  avatarUrl: string | null;
  resume: ResumeInfo | null;
  completeness: ProfileCompleteness;
}
