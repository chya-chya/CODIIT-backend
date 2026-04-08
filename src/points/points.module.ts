import { Module } from '@nestjs/common';
import { PointsService } from './points.service';
import { PointsRepository } from './points.repository';
import { PrismaService } from 'src/prisma/prisma.service';
import { GradeModule } from 'src/grades/grade.module';
import { PointsController } from './points.controller';
import { PointsConsumer } from './points.consumer';

import { KafkaModule } from '../common/kafka/kafka.module';

@Module({
  imports: [GradeModule, KafkaModule],
  controllers: [PointsController, PointsConsumer],
  providers: [PointsService, PointsRepository, PrismaService],
  exports: [PointsService],
})
export class PointsModule {}
