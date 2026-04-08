import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { KafkaProducerService } from './kafka.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { KafkaExceptionFilter } from './filters/kafka-exception.filter';

@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'KAFKA_SERVICE',
        imports: [ConfigModule],
        useFactory: (configService: ConfigService) => ({
          transport: Transport.KAFKA,
          options: {
            client: {
              clientId: 'codiit-backend',
              brokers: [
                configService.get<string>('KAFKA_BROKERS', 'localhost:9094'),
              ],
            },
            consumer: {
              groupId: 'codiit-consumer-group',
            },
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [KafkaProducerService, KafkaExceptionFilter],
  exports: [KafkaProducerService, KafkaExceptionFilter],
})
export class KafkaModule {}
