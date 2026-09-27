import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import {
  QuestionInputDto,
  RejectQuestionDto,
} from '../models/question-input.dto.js';
import { ListQuestionsQueryDto } from '../models/question.model.js';
import { QuestionService } from '../services/question.service.js';

const Id = () => Param('id', new ParseUUIDPipe());

/**
 * Question authoring (FRD §4.11). Editors & admins write and submit;
 * only admins approve/reject/archive/restore.
 */
@Controller('admin/questions')
@Roles('editor', 'admin')
export class QuestionsController {
  constructor(private readonly questions: QuestionService) {}

  @Get()
  list(@Query() query: ListQuestionsQueryDto) {
    return this.questions.list(query);
  }

  @Get(':id')
  get(@Id() id: string) {
    return this.questions.get(id);
  }

  @Get(':id/versions/:version')
  version(@Id() id: string, @Param('version', ParseIntPipe) version: number) {
    return this.questions.getVersion(id, version);
  }

  @Post()
  async create(@CurrentUser() actor: AuthUser, @Body() dto: QuestionInputDto) {
    return (await this.questions.create(actor, dto)).question;
  }

  /** Saves a new version (no-op if nothing changed; see `changed`). */
  @Put(':id')
  update(
    @CurrentUser() actor: AuthUser,
    @Id() id: string,
    @Body() dto: QuestionInputDto,
  ) {
    return this.questions.update(actor, id, dto);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentUser() actor: AuthUser, @Id() id: string) {
    return this.questions.transition(actor, id, 'submit');
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentUser() actor: AuthUser, @Id() id: string) {
    return this.questions.transition(actor, id, 'withdraw');
  }

  @Post(':id/approve')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  approve(@CurrentUser() actor: AuthUser, @Id() id: string) {
    return this.questions.transition(actor, id, 'approve');
  }

  @Post(':id/reject')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  reject(
    @CurrentUser() actor: AuthUser,
    @Id() id: string,
    @Body() dto: RejectQuestionDto,
  ) {
    return this.questions.transition(actor, id, 'reject', dto.note);
  }

  @Post(':id/archive')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  archive(@CurrentUser() actor: AuthUser, @Id() id: string) {
    return this.questions.transition(actor, id, 'archive');
  }

  @Post(':id/restore')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  restore(@CurrentUser() actor: AuthUser, @Id() id: string) {
    return this.questions.transition(actor, id, 'restore');
  }
}
