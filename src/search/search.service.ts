import { Injectable, OnModuleInit } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';

@Injectable()
export class SearchService implements OnModuleInit {
  constructor(private readonly elasticsearchService: ElasticsearchService) {}

  async onModuleInit() {
    await this.createIndex();
  }

  async createIndex() {
    const indexName = 'products';
    try {
      const checkIndex = await this.elasticsearchService.indices.exists({
        index: indexName,
      });

      if (!checkIndex) {
        await this.elasticsearchService.indices.create({
          index: indexName,
          mappings: {
            properties: {
              id: { type: 'keyword' },
              name: { type: 'text', analyzer: 'standard' },
              content: { type: 'text', analyzer: 'standard' },
              price: { type: 'integer' },
              discountPrice: { type: 'integer' },
              categoryId: { type: 'keyword' },
              avgRating: { type: 'half_float' },
              reviewCount: { type: 'integer' },
              sales: { type: 'integer' },
              storeId: { type: 'keyword' },
              createdAt: { type: 'date' },
              stocks: {
                type: 'nested',
                properties: {
                  sizeId: { type: 'keyword' },
                  quantity: { type: 'integer' },
                },
              },
            },
          },
        });
      }
    } catch (error: any) {
      console.error('--- ES Create Index Error Detail ---');
      console.error('Status:', error.meta?.statusCode);
      console.error('Body:', JSON.stringify(error.meta?.body, null, 2));
      console.error('Headers:', JSON.stringify(error.meta?.headers, null, 2));
      throw error;
    }
  }

  async indexProduct(product: Record<string, any>) {
    try {
      return await this.elasticsearchService.index({
        index: 'products',
        id: String(product.id),
        document: product,
      });
    } catch (error) {
      console.error('ES Indexing Error:', error);
    }
  }

  async bulkIndexProducts(products: any[]) {
    if (products.length === 0) return;

    const operations = products.flatMap((product) => [
      { index: { _index: 'products', _id: String(product.id) } },
      product,
    ]);

    try {
      const response = await this.elasticsearchService.bulk({
        refresh: false, // 성능을 위해 false 권장 (배치 종료 후 수동 refresh 가능)
        operations,
      });

      if (response.errors) {
        const erroredDocuments: any[] = [];
        response.items.forEach((action, i) => {
          const operation = Object.keys(action)[0];
          if (action[operation].error) {
            erroredDocuments.push({
              status: action[operation].status,
              error: action[operation].error,
              operation: operations[i * 2],
              document: operations[i * 2 + 1],
            });
          }
        });
        console.error('Bulk Indexing Errors:', erroredDocuments.length, 'docs failed.');
      }
      return response;
    } catch (error) {
      console.error('ES Bulk Indexing Error:', error);
      throw error;
    }
  }

  async removeProduct(productId: string) {
    try {
      return await this.elasticsearchService.delete({
        index: 'products',
        id: productId,
      });
    } catch (error) {
      console.error('ES Deleting Error:', error);
    }
  }

  async searchProducts(query: Record<string, any>) {
    const {
      search,
      priceMin,
      priceMax,
      size,
      categoryId,
      sort,
      page = 1,
      pageSize = 16,
    } = query;
    const from = (page - 1) * pageSize;

    const must: Record<string, any>[] = [];
    const filter: Record<string, any>[] = [];

    // 1. 검색어 필터 (상품명, 설명)
    if (search) {
      must.push({
        multi_match: {
          query: String(search),
          fields: ['name^3', 'content'], // 이름에 가중치 3배
        },
      });
    } else {
      must.push({ match_all: {} });
    }

    // 2. 카테고리 필터
    if (categoryId) {
      filter.push({ term: { categoryId } });
    }

    // 3. 가격대 필터
    if (priceMin !== undefined || priceMax !== undefined) {
      filter.push({
        range: {
          discountPrice: {
            ...(priceMin !== undefined && { gte: Number(priceMin) }),
            ...(priceMax !== undefined && { lte: Number(priceMax) }),
          },
        },
      });
    }

    // 4. 사이즈 필터 (Nested 구조 검색)
    if (size) {
      filter.push({
        nested: {
          path: 'stocks',
          query: {
            bool: {
              must: [
                { term: { 'stocks.sizeId': String(size) } },
                { range: { 'stocks.quantity': { gt: 0 } } }, // 재고 있는 것만
              ],
            },
          },
        },
      });
    }

    // 5. 정렬 설정
    let sortOption: any = { createdAt: { order: 'desc' } };
    if (sort === 'lowPrice') {
      sortOption = { discountPrice: { order: 'asc' } };
    } else if (sort === 'highPrice') {
      sortOption = { discountPrice: { order: 'desc' } };
    } else if (sort === 'salesRanking') {
      sortOption = { sales: { order: 'desc' } };
    } else if (sort === 'highRating') {
      sortOption = { avgRating: { order: 'desc' } };
    } else if (sort === 'mostReviewed') {
      sortOption = { reviewCount: { order: 'desc' } };
    }

    try {
      const response = await this.elasticsearchService.search<Record<string, unknown>>({
        index: 'products',
        from,
        size: Number(pageSize),
        query: {
          bool: { must, filter },
        },
        sort: [sortOption],
      });

      const hitsTotal = response.hits.total;
      const totalCount =
        typeof hitsTotal === 'number'
          ? hitsTotal
          : hitsTotal?.value || 0;

      return {
        list: response.hits.hits.map((hit) => hit._source),
        totalCount,
      };
    } catch (error) {
      console.error('ES Search Error:', error);
      throw error;
    }
  }
}
