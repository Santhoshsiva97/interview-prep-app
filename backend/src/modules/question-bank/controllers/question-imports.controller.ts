import {
  Controller,
  Get,
  Header,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator.js';
import { Roles } from '../../../common/decorators/roles.decorator.js';
import type { AuthUser } from '../../../common/types/auth-user.js';
import { FileUploadInterceptor } from '../../profile/models/file-upload.interceptor.js';
import {
  validateUpload,
  type UploadedFile as UploadedFileData,
  type UploadRules,
} from '../../profile/models/upload-rules.js';
import { TEMPLATE_CSV, TEMPLATE_JSON } from '../services/import-format.js';
import { QuestionImportService } from '../services/question-import.service.js';

const flag = (v: string | undefined) => v === 'true' || v === '1';

/** CSV/JSON only; content is parsed (and validated) by the import service. */
const IMPORT_RULES: UploadRules = {
  label: 'Import file',
  maxBytes: 5 * 1024 * 1024,
  kinds: [
    {
      mime: 'text/plain',
      ext: 'csv/json',
      // Text file with a .csv/.json name and no NUL bytes (i.e. not binary).
      matches: (buf, name) =>
        /\.(csv|json)$/i.test(name) && !buf.subarray(0, 8192).includes(0),
    },
  ],
};

/** Bulk question upload (FRD §4.11). */
@Controller('admin/question-imports')
@Roles('editor', 'admin')
export class QuestionImportsController {
  constructor(private readonly imports: QuestionImportService) {}

  /**
   * multipart/form-data, field `file` (.csv or .json, ≤ 5 MB, ≤ 1000 rows).
   * Query: dryRun, submitForReview, createMissingTaxonomy (true/false).
   * Valid rows are imported; invalid ones are reported and skipped.
   */
  @Post()
  @UseInterceptors(FileUploadInterceptor(IMPORT_RULES))
  upload(
    @CurrentUser() actor: AuthUser,
    @UploadedFile() file: UploadedFileData | undefined,
    @Query('dryRun') dryRun?: string,
    @Query('submitForReview') submitForReview?: string,
    @Query('createMissingTaxonomy') createMissingTaxonomy?: string,
  ) {
    validateUpload(file, IMPORT_RULES);
    return this.imports.import(actor, file!, {
      dryRun: flag(dryRun),
      submitForReview: flag(submitForReview),
      createMissingTaxonomy: flag(createMissingTaxonomy),
    });
  }

  @Get()
  history() {
    return this.imports.history();
  }

  /** Sample file in the import format: ?format=csv|json */
  @Get('template')
  @Header('Cache-Control', 'no-store')
  template(@Query('format') format: string | undefined, @Res() res: Response) {
    if (format === 'json') {
      res
        .type('application/json')
        .attachment('question-import-template.json')
        .send(JSON.stringify(TEMPLATE_JSON, null, 2));
    } else {
      res
        .type('text/csv')
        .attachment('question-import-template.csv')
        .send(TEMPLATE_CSV);
    }
  }
}
