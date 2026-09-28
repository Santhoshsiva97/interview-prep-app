import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { ScorecardService } from '../services/scorecard.service.js';

/** History & Scorecards (FRD §4.8). */
@Controller('scorecards')
export class ScorecardsController {
  constructor(private readonly scorecards: ScorecardService) {}

  /** The caller's submitted attempts with their results, newest first. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.scorecards.listMine(user);
  }

  /** One attempt's scorecard (owner; admin/support can view any). */
  @Get(':sessionId')
  get(
    @CurrentUser() user: AuthUser,
    @Param('sessionId', new ParseUUIDPipe()) sessionId: string,
  ) {
    return this.scorecards.get(user, sessionId);
  }
}
