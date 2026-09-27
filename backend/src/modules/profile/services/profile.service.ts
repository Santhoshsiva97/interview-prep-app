import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { User, UserProfile } from '../../../generated/prisma/client.js';
import { StorageService } from '../../../storage/storage.service.js';
import { toPublicUser } from '../../auth/models/auth-response.model.js';
import type { UpdateProfileDto } from '../models/profile.dto.js';
import type {
  ProfileCompleteness,
  ProfileResponse,
} from '../models/profile-response.model.js';
import {
  AVATAR_RULES,
  RESUME_RULES,
  sanitizeFileName,
  validateUpload,
  type UploadedFile,
} from '../models/upload-rules.js';

/** Fields counted towards profile completeness, with their display labels. */
const COMPLETENESS_CHECKS: [
  label: string,
  done: (u: User, p: UserProfile | null) => boolean,
][] = [
  ['Profile photo', (_u, p) => !!p?.avatarKey],
  ['Headline', (_u, p) => !!p?.headline],
  ['Target role', (_u, p) => !!p?.targetRole],
  ['Years of experience', (_u, p) => p?.experienceYears != null],
  ['Location', (_u, p) => !!p?.location],
  ['About you', (_u, p) => !!p?.bio],
  ['Resume', (_u, p) => !!p?.resumeKey],
  ['LinkedIn or GitHub link', (_u, p) => !!(p?.linkedinUrl || p?.githubUrl)],
  ['Phone number', (u) => !!u.phone],
];

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async get(userId: string): Promise<ProfileResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: { profile: true },
    });
    if (!user) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'USER_NOT_FOUND',
        'User not found.',
      );
    }
    const p = user.profile?.deletedAt ? null : user.profile;

    return {
      user: toPublicUser(user),
      profile: {
        headline: p?.headline ?? null,
        bio: p?.bio ?? null,
        location: p?.location ?? null,
        targetRole: p?.targetRole ?? null,
        experienceYears: p?.experienceYears ?? null,
        linkedinUrl: p?.linkedinUrl ?? null,
        githubUrl: p?.githubUrl ?? null,
      },
      avatarUrl: p?.avatarKey
        ? await this.storage.getSignedUrl(p.avatarKey)
        : null,
      resume:
        p?.resumeKey && p.resumeFileName && p.resumeUploadedAt
          ? {
              fileName: p.resumeFileName,
              sizeBytes: p.resumeSizeBytes ?? 0,
              uploadedAt: p.resumeUploadedAt,
              url: await this.storage.getSignedUrl(p.resumeKey, {
                downloadFileName: p.resumeFileName,
              }),
            }
          : null,
      completeness: this.completeness(user, p),
    };
  }

  async update(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    const { name, phone, ...profileFields } = dto;

    await this.prisma.$transaction(async (tx) => {
      if (name !== undefined || phone !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { name, phone },
        });
      }
      if (Object.keys(profileFields).length) {
        await tx.userProfile.upsert({
          where: { userId },
          create: { userId, ...profileFields },
          update: profileFields,
        });
      }
    });
    return this.get(userId);
  }

  async setAvatar(
    userId: string,
    file?: UploadedFile,
  ): Promise<ProfileResponse> {
    const type = validateUpload(file, AVATAR_RULES);
    const key = `users/${userId}/avatar/${randomUUID()}.${type.ext}`;
    await this.storage.putObject(key, file!.buffer, type.mime);
    await this.replaceFile(userId, 'avatarKey', { avatarKey: key });
    return this.get(userId);
  }

  async removeAvatar(userId: string): Promise<ProfileResponse> {
    await this.replaceFile(userId, 'avatarKey', { avatarKey: null });
    return this.get(userId);
  }

  async setResume(
    userId: string,
    file?: UploadedFile,
  ): Promise<ProfileResponse> {
    const type = validateUpload(file, RESUME_RULES);
    const key = `users/${userId}/resume/${randomUUID()}.${type.ext}`;
    await this.storage.putObject(key, file!.buffer, type.mime);
    await this.replaceFile(userId, 'resumeKey', {
      resumeKey: key,
      resumeFileName: sanitizeFileName(file!.originalname),
      resumeSizeBytes: file!.size,
      resumeUploadedAt: new Date(),
    });
    return this.get(userId);
  }

  async removeResume(userId: string): Promise<ProfileResponse> {
    await this.replaceFile(userId, 'resumeKey', {
      resumeKey: null,
      resumeFileName: null,
      resumeSizeBytes: null,
      resumeUploadedAt: null,
    });
    return this.get(userId);
  }

  /** Points the profile at the new file, then deletes the old object (best effort). */
  private async replaceFile(
    userId: string,
    keyField: 'avatarKey' | 'resumeKey',
    data: Partial<UserProfile>,
  ): Promise<void> {
    const previous = await this.prisma.userProfile.findUnique({
      where: { userId },
      select: { avatarKey: true, resumeKey: true },
    });
    await this.prisma.userProfile.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });

    const oldKey = previous?.[keyField];
    if (oldKey) {
      await this.storage.deleteObject(oldKey).catch((err: unknown) =>
        // Orphaned objects are harmless; a cleanup job can sweep them later.
        this.logger.warn(
          `Failed to delete old object ${oldKey}: ${String(err)}`,
        ),
      );
    }
  }

  completeness(user: User, profile: UserProfile | null): ProfileCompleteness {
    const missing = COMPLETENESS_CHECKS.filter(
      ([, done]) => !done(user, profile),
    ).map(([label]) => label);
    const total = COMPLETENESS_CHECKS.length;
    return {
      percent: Math.round(((total - missing.length) / total) * 100),
      missing,
    };
  }
}
