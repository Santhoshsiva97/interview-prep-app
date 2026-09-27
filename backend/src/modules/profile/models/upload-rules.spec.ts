import {
  AVATAR_RULES,
  RESUME_RULES,
  sanitizeFileName,
  validateUpload,
} from './upload-rules.js';

const file = (bytes: number[] | Buffer, originalname = 'x', size?: number) => {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return { buffer, originalname, size: size ?? buffer.length };
};

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0];
const WEBP = [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBPVP8 ')];
const PDF = [...Buffer.from('%PDF-1.7\n')];
const ZIP = [0x50, 0x4b, 0x03, 0x04, 0, 0];

describe('validateUpload', () => {
  it('detects images by content, not by name', () => {
    expect(validateUpload(file(PNG, 'photo.jpg'), AVATAR_RULES).mime).toBe(
      'image/png',
    );
    expect(validateUpload(file(JPEG), AVATAR_RULES).ext).toBe('jpg');
    expect(validateUpload(file(WEBP), AVATAR_RULES).ext).toBe('webp');
  });

  it('rejects non-images disguised as images', () => {
    expect(() =>
      validateUpload(
        file(Buffer.from('<svg onload=alert(1)>'), 'a.png'),
        AVATAR_RULES,
      ),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FILE_TYPE' }));
    expect(() => validateUpload(file(PDF, 'a.png'), AVATAR_RULES)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_FILE_TYPE' }),
    );
  });

  it('accepts PDF, and DOCX only with a .docx name', () => {
    expect(validateUpload(file(PDF, 'cv.pdf'), RESUME_RULES).ext).toBe('pdf');
    expect(validateUpload(file(ZIP, 'cv.docx'), RESUME_RULES).ext).toBe('docx');
    expect(() =>
      validateUpload(file(ZIP, 'archive.zip'), RESUME_RULES),
    ).toThrow(expect.objectContaining({ code: 'UNSUPPORTED_FILE_TYPE' }));
  });

  it('enforces size limits and presence', () => {
    expect(() =>
      validateUpload(file(PNG, 'a.png', 2 * 1024 * 1024 + 1), AVATAR_RULES),
    ).toThrow(expect.objectContaining({ code: 'FILE_TOO_LARGE' }));
    expect(() => validateUpload(undefined, AVATAR_RULES)).toThrow(
      expect.objectContaining({ code: 'FILE_REQUIRED' }),
    );
  });
});

describe('sanitizeFileName', () => {
  it('strips directories and control characters', () => {
    expect(sanitizeFileName('C:\\Users\\me\\My CV.pdf')).toBe('My CV.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('bad\u0000\nname.pdf')).toBe('badname.pdf');
    expect(sanitizeFileName('   ')).toBe('file');
  });
});
