import { Module, Global } from '@nestjs/common';
import { ElasticsearchModule } from '@nestjs/elasticsearch';
import { SearchService } from './search.service';
import { SearchConsumer } from './search.consumer';
import { KafkaModule } from '../common/kafka/kafka.module';

@Global()
@Module({
  imports: [
    ElasticsearchModule.register({
      node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    }),
    KafkaModule,
  ],
  controllers: [SearchConsumer],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
