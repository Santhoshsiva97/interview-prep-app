import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ListMailQueryDto } from '../models/mail-admin.dto.js';
import { MailService } from '../services/mail.service.js';
import {
  MAIL_TEMPLATE_NAMES,
  SAMPLE_DATA,
  type MailTemplateName,
} from '../templates/index.js';

/** Delivery log + template previews for staff (FRD §4.5). */
@Controller('admin/mail')
export class AdminMailController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /** Newest first. Bodies are never stored, only metadata and delivery status. */
  @Get()
  @Roles('admin', 'support')
  async list(@Query() q: ListMailQueryDto) {
    const where: Prisma.MailMessageWhereInput = {
      deletedAt: null,
      ...(q.status && { status: q.status }),
      ...(q.template && { template: q.template }),
      ...(q.search && {
        toAddress: { contains: q.search, mode: 'insensitive' },
      }),
    };
    const [total, items] = await this.prisma.$transaction([
      this.prisma.mailMessage.count({ where }),
      this.prisma.mailMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true,
          toAddress: true,
          template: true,
          subject: true,
          status: true,
          attempts: true,
          maxAttempts: true,
          lastError: true,
          createdAt: true,
          lastAttemptAt: true,
          sentAt: true,
          failedAt: true,
          userId: true,
        },
      }),
    ]);
    return {
      items,
      total,
      page: q.page,
      pageSize: q.pageSize,
      totalPages: Math.max(1, Math.ceil(total / q.pageSize)),
    };
  }

  @Get('templates')
  @Roles('admin', 'support', 'editor')
  templates() {
    return MAIL_TEMPLATE_NAMES.map((name) => ({
      name,
      subject: this.mail.render(name, SAMPLE_DATA[name] as never).subject,
      placeholder: name === 'exam_reminder',
    }));
  }

  /** Renders a template with sample data, for checking the layout. */
  @Get('templates/:name/preview')
  @Roles('admin', 'support', 'editor')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
  )
  preview(@Param('name') name: string): string {
    if (!(MAIL_TEMPLATE_NAMES as readonly string[]).includes(name)) {
      throw new NotFoundException(`Unknown template "${name}"`);
    }
    const template = name as MailTemplateName;
    return this.mail.render(template, SAMPLE_DATA[template]).html;
  }
}
