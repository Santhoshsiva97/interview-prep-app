import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { ExamInputDto, ListExamsQueryDto } from '../models/exam-input.dto.js';
import { ExamAdminService } from '../services/exam-admin.service.js';

const Id = () => Param('id', new ParseUUIDPipe());

/**
 * Exam & interview template builder (FRD §4.6). Editors and admins build
 * drafts; only admins publish, unpublish, archive, restore, or change a
 * published exam.
 */
@Controller('admin/exams')
@Roles('editor', 'admin')
export class AdminExamsController {
  constructor(private readonly exams: ExamAdminService) {}

  @Get()
  list(@Query() query: ListExamsQueryDto) {
    return this.exams.list(query);
  }

  @Get(':id')
  get(@Id() id: string) {
    return this.exams.get(id);
  }

  @Post()
  create(@CurrentUser() actor: AuthUser, @Body() dto: ExamInputDto) {
    return this.exams.create(actor, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Id() id: string,
    @Body() dto: ExamInputDto,
  ) {
    return this.exams.update(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Id() id: string) {
    return this.exams.remove(id);
  }

  @Post(':id/publish')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  publish(@CurrentUser() actor: AuthUser, @Id() id: string) {
    return this.exams.transition(actor, id, 'publish');
  }

  @Post(':id/unpublish')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  unpublish(@CurrentUser() actor: AuthUser, @Id() id: string) {
    return this.exams.transition(actor, id, 'unpublish');
  }

  @Post(':id/archive')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  archive(@CurrentUser() actor: AuthUser, @Id() id: string) {
    return this.exams.transition(actor, id, 'archive');
  }

  @Post(':id/restore')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  restore(@CurrentUser() actor: AuthUser, @Id() id: string) {
    return this.exams.transition(actor, id, 'restore');
  }
}
