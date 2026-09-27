import { Module } from '@nestjs/common';
import { ProfileController } from './controllers/profile.controller.js';
import { ProfileService } from './services/profile.service.js';

@Module({
  controllers: [ProfileController],
  providers: [ProfileService],
  exports: [ProfileService],
})
export class ProfileModule {}
