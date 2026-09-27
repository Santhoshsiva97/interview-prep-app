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
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import {
  ChangeRoleDto,
  CreateStaffDto,
  ListUsersQueryDto,
  SuspendUserDto,
} from '../models/admin.dto.js';
import type {
  AdminUserDetail,
  AdminUserSummary,
  Paginated,
} from '../models/admin-response.model.js';
import { AdminUsersService } from '../services/admin-users.service.js';

const UserId = () => Param('id', new ParseUUIDPipe());

/**
 * Admin user management (FRD §4.3). Support staff can look users up;
 * only admins change account state; only super admins manage roles/staff.
 */
@Controller('admin')
export class AdminUsersController {
  constructor(private readonly users: AdminUsersService) {}

  @Get('users')
  @Roles('admin', 'support')
  list(
    @Query() query: ListUsersQueryDto,
  ): Promise<Paginated<AdminUserSummary>> {
    return this.users.list(query);
  }

  @Get('users/:id')
  @Roles('admin', 'support')
  get(@UserId() id: string): Promise<AdminUserDetail> {
    return this.users.get(id);
  }

  @Post('users/:id/suspend')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentUser() actor: AuthUser,
    @UserId() id: string,
    @Body() dto: SuspendUserDto,
  ): Promise<AdminUserDetail> {
    return this.users.suspend(actor, id, dto.reason);
  }

  @Post('users/:id/reactivate')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  reactivate(
    @CurrentUser() actor: AuthUser,
    @UserId() id: string,
  ): Promise<AdminUserDetail> {
    return this.users.reactivate(actor, id);
  }

  @Post('users/:id/force-logout')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  forceLogout(
    @CurrentUser() actor: AuthUser,
    @UserId() id: string,
  ): Promise<{ revokedSessions: number }> {
    return this.users.forceLogout(actor, id);
  }

  @Patch('users/:id/role')
  @Roles('super_admin')
  changeRole(
    @CurrentUser() actor: AuthUser,
    @UserId() id: string,
    @Body() dto: ChangeRoleDto,
  ): Promise<AdminUserDetail> {
    return this.users.changeRole(actor, id, dto.role);
  }

  @Post('staff')
  @Roles('super_admin')
  async createStaff(@Body() dto: CreateStaffDto) {
    const user = await this.users.createStaff(dto);
    return {
      user,
      message: `Account created. An account-setup code was sent to ${user.email}. They can request a new one any time via “Forgot password”.`,
    };
  }
}
