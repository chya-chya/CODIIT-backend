import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsRepository } from './notifications.repository';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TICKER$ } from './ticker.token';
import { interval, shareReplay } from 'rxjs';
import { KafkaModule } from '../common/kafka/kafka.module';
import { NotificationsConsumer } from './notifications.consumer';

@Module({
  imports: [PrismaModule, KafkaModule],
  controllers: [NotificationsController, NotificationsConsumer],
  providers: [
    NotificationsService,
    NotificationsRepository,
    {
      provide: TICKER$,
      useFactory: () => interval(30_000).pipe(shareReplay(1)),
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
