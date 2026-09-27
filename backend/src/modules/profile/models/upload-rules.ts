import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error.js';

interface FileKind {
  mime: string;
  ext: string;
  /** True if the buffer's leading bytes identify this format. */
  matches: (buf: Buffer, originalName: string) => boolean;
}

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  bytes.every((b, i) => buf[offset + i] === b);

const JPEG: FileKind = {
  mime: 'image/jpeg',
  ext: 'jpg',
  matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]),
};
const PNG: FileKind = {
  mime: 'image/png',
  ext: 'png',
  matches: (b) =>
    startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};
const WEBP: FileKind = {
  mime: 'image/webp',
  ext: 'webp',
  // "RIFF" <size> "WEBP"
  matches: (b) =>
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
};
const PDF: FileKind = {
  mime: 'application/pdf',
  ext: 'pdf',
  matches: (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]), // "%PDF-"
};
const DOCX: FileKind = {
  mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ext: 'docx',
  // DOCX is a ZIP container; require the extension so arbitrary ZIPs are rejected.
  matches: (b, name) =>
    startsWith(b, [0x50, 0x4b, 0x03, 0x04]) && /\.docx$/i.test(name),
};
const DOC: FileKind = {
  mime: 'application/msword',
  ext: 'doc',
  matches: (b) =>
    startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
};

export interface UploadRules {
  label: string;
  maxBytes: number;
  kinds: FileKind[];
}

// FRD §4.2 profile uploads. Types are checked by content (magic bytes),
// never by the client-supplied MIME type.
export const AVATAR_RULES: UploadRules = {
  label: 'Profile photo',
  maxBytes: 2 * 1024 * 1024,
  kinds: [JPEG, PNG, WEBP],
};

export const RESUME_RULES: UploadRules = {
  label: 'Resume',
  maxBytes: 5 * 1024 * 1024,
  kinds: [PDF, DOCX, DOC],
};

export type UploadErrorCode =
  'FILE_REQUIRED' | 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE_TYPE';

export interface UploadedFile {
  buffer: Buffer;
  size: number;
  originalname: string;
}

/** Validates an upload and returns its detected type. */
export function validateUpload(
  file: UploadedFile | undefined,
  rules: UploadRules,
): { mime: string; ext: string } {
  if (!file?.buffer?.length) {
    throw new AppError<UploadErrorCode>(
      HttpStatus.BAD_REQUEST,
      'FILE_REQUIRED',
      'Please choose a file to upload.',
    );
  }
  if (file.size > rules.maxBytes) {
    throw tooLarge(rules);
  }
  const kind = rules.kinds.find((k) =>
    k.matches(file.buffer, file.originalname),
  );
  if (!kind) {
    throw new AppError<UploadErrorCode>(
      HttpStatus.BAD_REQUEST,
      'UNSUPPORTED_FILE_TYPE',
      `${rules.label} must be one of: ${rules.kinds.map((k) => k.ext.toUpperCase()).join(', ')}.`,
    );
  }
  return { mime: kind.mime, ext: kind.ext };
}

export const tooLarge = (rules: UploadRules) =>
  new AppError<UploadErrorCode>(
    HttpStatus.PAYLOAD_TOO_LARGE,
    'FILE_TOO_LARGE',
    `${rules.label} must be ${rules.maxBytes / 1024 / 1024} MB or smaller.`,
  );

/** Strips paths/control characters and caps length for storing a display name. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return (cleaned || 'file').slice(-255);
}
