import { Controller, Logger, UseFilters } from '@nestjs/common';
import { EventPattern, Payload } from '@nestjs/microservices';
import { SearchService } from './search.service';
import { type ProductResponse } from '../products/products.service';
import { KafkaExceptionFilter } from '../common/kafka/filters/kafka-exception.filter';

@UseFilters(KafkaExceptionFilter)
@Controller()
export class SearchConsumer {
  private readonly logger = new Logger(SearchConsumer.name);

  constructor(private readonly searchService: SearchService) {}

  @EventPattern('product.created')
  async handleProductCreated(@Payload() data: ProductResponse) {
    this.logger.log(`📥 Kafka Event: product.created (ID: ${data.id})`);
    await this.searchService.indexProduct(data);
  }

  @EventPattern('product.updated')
  async handleProductUpdated(@Payload() data: ProductResponse) {
    this.logger.log(`📥 Kafka Event: product.updated (ID: ${data.id})`);
    await this.searchService.indexProduct(data);
  }

  @EventPattern('product.deleted')
  async handleProductDeleted(@Payload() data: { id: string }) {
    this.logger.log(`📥 Kafka Event: product.deleted (ID: ${data.id})`);
    await this.searchService.removeProduct(data.id);
  }
}
