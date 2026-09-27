import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import { TagKind } from '../../../generated/prisma/enums.js';
import {
  CreateTagDto,
  CreateTopicDto,
  UpdateTagDto,
  UpdateTopicDto,
} from '../models/taxonomy.dto.js';
import { TaxonomyService } from '../services/taxonomy.service.js';

const Id = () => Param('id', new ParseUUIDPipe());

/** Topic/tag management (FRD §4.11). Readable by all staff, editable by editors & admins. */
@Controller('admin')
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  @Get('topics')
  @Roles('editor', 'admin', 'support')
  listTopics() {
    return this.taxonomy.listTopics();
  }

  @Post('topics')
  @Roles('editor', 'admin')
  createTopic(@Body() dto: CreateTopicDto) {
    return this.taxonomy.createTopic(dto);
  }

  @Patch('topics/:id')
  @Roles('editor', 'admin')
  updateTopic(@Id() id: string, @Body() dto: UpdateTopicDto) {
    return this.taxonomy.updateTopic(id, dto);
  }

  @Delete('topics/:id')
  @Roles('editor', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTopic(@Id() id: string) {
    return this.taxonomy.deleteTopic(id);
  }

  @Get('tags')
  @Roles('editor', 'admin', 'support')
  listTags(@Query('kind') kind?: string) {
    return this.taxonomy.listTags(
      Object.values(TagKind).includes(kind as TagKind)
        ? (kind as TagKind)
        : undefined,
    );
  }

  @Post('tags')
  @Roles('editor', 'admin')
  createTag(@Body() dto: CreateTagDto) {
    return this.taxonomy.createTag(dto);
  }

  @Patch('tags/:id')
  @Roles('editor', 'admin')
  updateTag(@Id() id: string, @Body() dto: UpdateTagDto) {
    return this.taxonomy.updateTag(id, dto);
  }

  @Delete('tags/:id')
  @Roles('editor', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTag(@Id() id: string) {
    return this.taxonomy.deleteTag(id);
  }
}
