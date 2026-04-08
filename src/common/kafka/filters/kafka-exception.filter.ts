import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { KafkaContext } from '@nestjs/microservices';
import { KafkaProducerService } from '../kafka.service';

@Catch()
export class KafkaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(KafkaExceptionFilter.name);

  constructor(private readonly kafkaProducerService: KafkaProducerService) {}

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToRpc();
    const kafkaCtx = ctx.getContext<KafkaContext>();
    
    if (!kafkaCtx || typeof kafkaCtx.getTopic !== 'function') {
      this.logger.error(`❌ Filter caught non-Kafka error: ${exception.message}`);
      return;
    }

    // 1. 메시지 추출
    const message = kafkaCtx.getMessage();
    const topic = kafkaCtx.getTopic();
    
    // 2. 안전하게 Key 및 RetryCount 추출
    const rawMessage = kafkaCtx.getArgByIndex(0);
    const key = rawMessage?.key?.toString() || 'no-key';

    // Value 기반 재시도 횟수 확인
    let retryCount = 0;
    const val = message.value;

    try {
      const rawStr = Buffer.isBuffer(val)
        ? val.toString()
        : typeof val === 'string'
          ? val
          : JSON.stringify(val);
      const parsed = JSON.parse(rawStr);

      // Payload에 포함된 retryCount 확인
      retryCount = parsed?.retryCount ?? parsed?.data?.retryCount ?? 0;
    } catch (e) {
      // 파싱 실패 시 retryCount = 0 유지
    }

    // 3. 재시도 로직 (지연 토픽 전략)
    const topicMap: Record<string, string> = {
      'order.completed': 'order.completed-retry-5m',
      'order.completed-retry-5m': 'order.completed-retry-30m',
      'order.completed-retry-30m': 'order.completed-dlq',
    };

    const nextTopic = topicMap[topic];

    if (nextTopic) {
      if (nextTopic.endsWith('.dlq')) {
        // 💀 최종 실패 -> DLQ 전송
        this.logger.error(
          `❌ [Final Failure] Topic: ${topic} (All retries exhausted)`,
        );
        this.logger.error(`Exception: ${exception.message || exception}`);

        try {
          this.kafkaProducerService.emitToDlq(
            topic,
            key,
            message.value,
            exception.message || exception,
          );
        } catch (dlqError) {
          this.logger.error(`❌ Critical: Failed to move to DLQ`, dlqError);
        }
      } else {
        // 🔄 다음 단계 재시도 토픽으로 전송
        this.logger.warn(
          `🔄 [Routing to Retry Topic] ${topic} -> ${nextTopic}, Error: ${
            exception.message || exception
          }`,
        );

        const observable = this.kafkaProducerService.reproduce(
          nextTopic, // 새로운 토픽으로 전송
          key,
          message.value,
          retryCount + 1,
        );

        if (observable) {
          observable.subscribe();
        }
      }
    }
  }
}
