import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { RunCodeDto } from '../models/judge.model.js';
import { JudgeService } from '../services/judge.service.js';

const Id = (name = 'id') => Param(name, new ParseUUIDPipe());

/**
 * "Run" during an attempt (FRD §4.7): queued, then polled. Only the
 * attempt's owner can create or read its runs.
 */
@Controller('exam-sessions/:id/runs')
export class CodeRunsController {
  constructor(private readonly judge: JudgeService) {}

  /** 202: the run is queued. Poll GET …/runs/:runId until `completed` or `failed`. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUser() user: AuthUser,
    @Id() id: string,
    @Body() dto: RunCodeDto,
  ) {
    return this.judge.createRun(user, id, dto);
  }

  @Get(':runId')
  get(
    @CurrentUser() user: AuthUser,
    @Id() id: string,
    @Id('runId') runId: string,
  ) {
    return this.judge.getRun(user, id, runId);
  }
}

/** Staff view of grading, including hidden-test verdicts; admins can regrade. */
@Controller('admin/exam-sessions/:id')
@Roles('admin', 'support')
export class AdminGradingController {
  constructor(private readonly judge: JudgeService) {}

  @Get('grading')
  report(@Id() id: string) {
    return this.judge.gradingReport(id);
  }

  @Post('regrade')
  @Roles('admin')
  @HttpCode(HttpStatus.ACCEPTED)
  regrade(@Id() id: string) {
    return this.judge.regrade(id);
  }
}
