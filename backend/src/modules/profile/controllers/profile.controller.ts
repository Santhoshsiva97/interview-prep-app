import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Put,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { FileUploadInterceptor } from '../models/file-upload.interceptor.js';
import { UpdateProfileDto } from '../models/profile.dto.js';
import type { ProfileResponse } from '../models/profile-response.model.js';
import {
  AVATAR_RULES,
  RESUME_RULES,
  type UploadedFile as UploadedFileData,
} from '../models/upload-rules.js';
import { ProfileService } from '../services/profile.service.js';

/** The signed-in user's own profile (FRD §4.2). */
@Controller('me')
export class ProfileController {
  constructor(private readonly profiles: ProfileService) {}

  @Get('profile')
  get(@CurrentUser() user: AuthUser): Promise<ProfileResponse> {
    return this.profiles.get(user.id);
  }

  @Patch('profile')
  update(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileResponse> {
    return this.profiles.update(user.id, dto);
  }

  /** multipart/form-data, field `file`: JPEG/PNG/WebP ≤ 2 MB. */
  @Put('avatar')
  @UseInterceptors(FileUploadInterceptor(AVATAR_RULES))
  setAvatar(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: UploadedFileData,
  ): Promise<ProfileResponse> {
    return this.profiles.setAvatar(user.id, file);
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthUser): Promise<ProfileResponse> {
    return this.profiles.removeAvatar(user.id);
  }

  /** multipart/form-data, field `file`: PDF/DOCX/DOC ≤ 5 MB. */
  @Put('resume')
  @UseInterceptors(FileUploadInterceptor(RESUME_RULES))
  setResume(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: UploadedFileData,
  ): Promise<ProfileResponse> {
    return this.profiles.setResume(user.id, file);
  }

  @Delete('resume')
  removeResume(@CurrentUser() user: AuthUser): Promise<ProfileResponse> {
    return this.profiles.removeResume(user.id);
  }
}
