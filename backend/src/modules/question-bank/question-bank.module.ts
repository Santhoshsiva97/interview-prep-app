import { Module } from '@nestjs/common';
import { QuestionImportsController } from './controllers/question-imports.controller.js';
import { QuestionsController } from './controllers/questions.controller.js';
import { TaxonomyController } from './controllers/taxonomy.controller.js';
import { QuestionImportService } from './services/question-import.service.js';
import { QuestionService } from './services/question.service.js';
import { TaxonomyService } from './services/taxonomy.service.js';

/** Question bank: authoring, versioning, review workflow, bulk upload, taxonomy (FRD §4.11). */
@Module({
  controllers: [
    TaxonomyController,
    QuestionsController,
    QuestionImportsController,
  ],
  providers: [TaxonomyService, QuestionService, QuestionImportService],
  // QuestionService is what Step 7 (exam builder) and Step 19 (search) build on.
  exports: [QuestionService, TaxonomyService],
})
export class QuestionBankModule {}
