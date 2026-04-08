import { Controller, Logger, UseFilters } from '@nestjs/common';
import {
  Ctx,
  EventPattern,
  KafkaContext,
  Payload,
} from '@nestjs/microservices';
import { PointsService } from './points.service';
import { KafkaExceptionFilter } from '../common/kafka/filters/kafka-exception.filter';
import { KafkaProducerService } from '../common/kafka/kafka.service';

@UseFilters(KafkaExceptionFilter)
@Controller()
export class PointsConsumer {
  private readonly logger = new Logger(PointsConsumer.name);

  constructor(
    private readonly pointsService: PointsService,
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

    this.logger.log(`📥 Kafka Event: ${topic} (OrderId: ${orderId})`);

    // ⏳ 지연 처리 로직 (5분, 30분)
    if (topic.includes('retry-5m')) {
      await this.kafkaService.delay(5, context);
    } else if (topic.includes('retry-30m')) {
      await this.kafkaService.delay(30, context);
    }

    // 비즈니스 로직 실행 (이미 처리된 경우 PointsService 내부에서 스킵됨)
    await this.pointsService.earnPointsOnPaidOrder(orderId);
    this.logger.debug(`✅ Points processing finished for order: ${orderId}`);
  }
}
