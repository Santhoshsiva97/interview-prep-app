import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const normalizeEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// Shared password policy: 8–128 chars with at least one letter and one digit.
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
const PASSWORD_MESSAGE =
  'password must be 8–128 characters and contain at least one letter and one number';

export class EmailDto {
  @Transform(normalizeEmail)
  @IsEmail({}, { message: 'email must be a valid email address' })
  @MaxLength(254)
  email: string;
}

export class RegisterDto extends EmailDto {
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @Transform(trim)
  @Matches(/^\+[1-9]\d{7,14}$/, {
    message: 'phone must be in international format, e.g. +919876543210',
  })
  phone: string;

  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  password: string;
}

export class OtpDto extends EmailDto {
  @Matches(/^\d{6}$/, { message: 'code must be a 6-digit number' })
  code: string;
}

export class LoginDto extends EmailDto {
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class ResetPasswordDto extends OtpDto {
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_MESSAGE })
  newPassword: string;
}
