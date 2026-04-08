import { Controller, Logger, UseFilters } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
} from '@nestjs/microservices';
import { NotificationsRepository } from './notifications.repository';
import { NotificationType } from '@prisma/client';
import { KafkaExceptionFilter } from '../common/kafka/filters/kafka-exception.filter';
import { KafkaProducerService } from '../common/kafka/kafka.service';

@UseFilters(KafkaExceptionFilter)
@Controller()
export class NotificationsConsumer {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly kafkaService: KafkaProducerService,
  ) {}

  @EventPattern([
    'order.completed',
    'order.completed-retry-5m',
    'order.completed-retry-30m',
  ])
  async handleOrderCompleted(@Payload() data: any, @Ctx() context: KafkaContext) {
    const topic = context.getTopic();
    const orderId = typeof data === 'string' ? data : data.id || data.orderId;
    const userId = data.userId;

    if (!userId) {
      throw new Error(`userId is missing in payload for order ${orderId}`);
    }

    this.logger.log(`📥 Kafka Event: ${topic} (OrderId: ${orderId}) for User: ${userId}`);

    // ⏳ 지연 처리 로직 (5분, 30분)
    if (topic.includes('retry-5m')) {
      await this.kafkaService.delay(5, context);
    } else if (topic.includes('retry-30m')) {
      await this.kafkaService.delay(30, context);
    }

    await this.repository.create({
      userId,
      type: NotificationType.SYSTEM,
      message: `주문이 성공적으로 완료되었습니다. (주문번호: ${orderId})`,
      orderId,
    });
    this.logger.debug(`✅ Notification processing finished for order: ${orderId}`);
  }
}
