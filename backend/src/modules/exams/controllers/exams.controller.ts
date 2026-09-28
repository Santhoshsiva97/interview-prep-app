import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import {
  CatalogQueryDto,
  RunCodeDto,
  SaveSessionDto,
  StartSessionDto,
  SubmitSessionDto,
} from '../models/session.dto.js';
import { ExamCatalogService } from '../services/exam-catalog.service.js';
import { ExamSessionService } from '../services/exam-session.service.js';

const Id = () => Param('id', new ParseUUIDPipe());

/** Candidate catalog and pre-test screen (FRD §4.6). Any signed-in user. */
@Controller('exams')
export class ExamsController {
  constructor(
    private readonly catalog: ExamCatalogService,
    private readonly sessions: ExamSessionService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: CatalogQueryDto) {
    return this.catalog.list(user, query.kind);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Id() id: string) {
    return this.catalog.get(user, id);
  }

  /** Requires consent. 201 = new attempt, 200 = the attempt already in progress. */
  @Post(':id/sessions')
  async start(
    @CurrentUser() user: AuthUser,
    @Id() id: string,
    @Body() _dto: StartSessionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.sessions.start(user, id);
    res.status(result.resumed ? HttpStatus.OK : HttpStatus.CREATED);
    return result;
  }
}

/**
 * A candidate's attempt at runtime (FRD §4.6). Only the owner can see or
 * change it (others get 404).
 */
@Controller('exam-sessions')
export class ExamSessionsController {
  constructor(private readonly sessions: ExamSessionService) {}

  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.sessions.listMine(user);
  }

  /** Read-only view; the clock is projected, not charged. */
  @Get(':id')
  view(@CurrentUser() user: AuthUser, @Id() id: string) {
    return this.sessions.view(user, id);
  }

  /** The runtime (re)connecting: charges the clock and returns the full attempt. */
  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser() user: AuthUser, @Id() id: string) {
    return this.sessions.resume(user, id);
  }

  /** Autosave: answers changed since the last save + clock sync. */
  @Patch(':id')
  save(
    @CurrentUser() user: AuthUser,
    @Id() id: string,
    @Body() dto: SaveSessionDto,
  ) {
    return this.sessions.save(user, id, dto.answers);
  }

  @Post(':id/next-section')
  @HttpCode(HttpStatus.OK)
  nextSection(
    @CurrentUser() user: AuthUser,
    @Id() id: string,
    @Body() dto: SaveSessionDto,
  ) {
    return this.sessions.nextSection(user, id, dto.answers);
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentUser() user: AuthUser,
    @Id() id: string,
    @Body() dto: SubmitSessionDto,
  ) {
    return this.sessions.submit(user, id, dto);
  }

  /** Runs code against the question's sample test cases (not graded). */
  @Post(':id/run')
  @HttpCode(HttpStatus.OK)
  run(
    @CurrentUser() user: AuthUser,
    @Id() id: string,
    @Body() dto: RunCodeDto,
  ) {
    return this.sessions.run(user, id, dto);
  }
}
