import {
  Inject,
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ClientKafka, KafkaContext } from '@nestjs/microservices';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);

  constructor(@Inject('KAFKA_SERVICE') private readonly client: ClientKafka) {}

  onModuleInit() {
    this.logger.log('📡 Connecting to Kafka...');
    this.client.connect()
      .then(() => {
        this.logger.log('✅ Kafka Producer connected');
      })
      .catch((err) => {
        this.logger.error('❌ Failed to connect to Kafka at startup:', err);
      });
  }

  async onModuleDestroy() {
    await this.client.close();
    this.logger.log('🛑 Kafka Producer closed');
  }

  /**
   * 📤 이벤트 발행
   * @param topic 토픽명
   * @param key 메시지 키 (순서 보장용)
   * @param value 메시지 본문
   */
  emit(topic: string, key: string, value: any) {
    try {
      this.client
        .emit(topic, { key, value: JSON.stringify(value) })
        .subscribe();
      this.logger.debug(`[Kafka Emit] Topic: ${topic}, Key: ${key}`);
    } catch (error) {
      this.logger.error(`❌ Kafka Emit Error (${topic}):`, error);
      throw error;
    }
  }

  /**
   * 📥 DLQ로 메시지 전송
   * @param originTopic 원래 토픽
   * @param key 메시지 키
   * @param value 메시지 본문
   * @param error 에러 정보
   */
  emitToDlq(originTopic: string, key: string, value: any, error: any) {
    const dlqTopic = `${originTopic}.dlq`;
    const payload = {
      originTopic,
      originalValue: typeof value === 'string' ? JSON.parse(value) : value,
      error: error instanceof Error ? error.message : error,
      timestamp: new Date().toISOString(),
    };

    try {
      this.client
        .emit(dlqTopic, { key, value: JSON.stringify(payload) })
        .subscribe();
      this.logger.warn(`⚠️ Move to DLQ: [${dlqTopic}], Key: ${key}`);
    } catch (err) {
      this.logger.error(`❌ Failed to emit to DLQ: ${dlqTopic}`, err);
    }
  }

  /**
   * 🔄 메시지 재발행 (Header 대신 Payload에 retryCount 포함)
   * @param topic 토픽명
   * @param key 메시지 키
   * @param value 메시지 본문
   * @param retryCount 재시도 횟수
   */
  reproduce(topic: string, key: string, value: any, retryCount: number) {
    try {
      let data = value;

      // Buffer/String인 경우 파싱 시도
      if (Buffer.isBuffer(value)) {
        try {
          data = JSON.parse(value.toString());
        } catch (e) { /* ignore */ }
      } else if (typeof value === 'string') {
        try {
          data = JSON.parse(value);
        } catch (e) { /* ignore */ }
      }

      // retryCount 주입
      const payload =
        typeof data === 'object' && data !== null
          ? { ...data, retryCount }
          : { value: data, retryCount };

      this.logger.debug(
        `[Kafka Reproduce] Topic: ${topic}, Retry: ${retryCount}`,
      );
      return this.client.emit(topic, {
        key,
        value: JSON.stringify(payload),
      });
    } catch (error) {
      this.logger.error(`❌ Kafka Reproduce Error (${topic}):`, error);
      return null;
    }
  }

  /**
   * ⏳ Kafka 하트비트를 유지하며 대기
   * @param minutes 대기할 분 단위
   * @param context Kafka 컨텍스트
   */
  async delay(minutes: number, context: KafkaContext) {
    const ms = minutes * 60 * 1000;
    const start = Date.now();
    const heartbeatInterval = 5000; // 5초마다 하트비트

    this.logger.log(
      `⏳ Starting delay: ${minutes}m for topic ${context.getTopic()} (Key: ${context
        .getMessage()
        .key?.toString()})`,
    );

    while (Date.now() - start < ms) {
      const remaining = ms - (Date.now() - start);
      const waitTime = Math.min(heartbeatInterval, remaining);

      await new Promise((resolve) => setTimeout(resolve, waitTime));

      try {
        const heartbeat = context.getHeartbeat();
        if (typeof heartbeat === 'function') {
          await heartbeat();
        }
      } catch (err) {
        this.logger.warn(`⚠️ Heartbeat failed during delay: ${err.message}`);
      }
    }

    this.logger.log(`✅ Delay finished: ${minutes}m`);
  }
}
