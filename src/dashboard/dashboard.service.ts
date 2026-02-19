import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  subDays,
  subWeeks,
  subMonths,
  subYears,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
} from 'date-fns';
import { NotFoundException } from '@nestjs/common';
import { startSpan } from '@sentry/node';

export interface SalesPeriod {
  current: { totalOrders: number; totalSales: number };
  previous: { totalOrders: number; totalSales: number };
  changeRate: { totalOrders: number; totalSales: number };
}

export interface TopSale {
  totalOrders: number;
  product: { id: string; name: string; price: number };
}

export interface PriceRange {
  priceRange: string;
  totalSales: number;
  percentage: number;
}

export interface SalesReport {
  today: SalesPeriod;
  week: SalesPeriod;
  month: SalesPeriod;
  year: SalesPeriod;
  topSales: TopSale[];
  priceRange: PriceRange[];
}

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}
  private readonly logger = new Logger(DashboardService.name);

  private async getStoreBySellerId(userId: string) {
    const store = await this.prisma.store.findUnique({
      where: { sellerId: userId },
    });
    if (!store) {
      throw new NotFoundException('판매자 정보를 찾을 수 없습니다');
    }
    return store;
  }

  // 날짜별 판매 데이터 조회
  // private async getSalesDataByPeriods(userId: string) {
  //   const store = await this.getStoreBySellerId(userId);
  //   const periods = [
  //     {
  //       key: 'today',
  //       start: startOfDay(new Date()),
  //       previous: startOfDay(subDays(new Date(), 1)),
  //     },
  //     {
  //       key: 'week',
  //       start: startOfWeek(new Date(), { weekStartsOn: 1 }),
  //       previous: startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }),
  //     },
  //     {
  //       key: 'month',
  //       start: startOfMonth(new Date()),
  //       previous: startOfMonth(subMonths(new Date(), 1)),
  //     },
  //     {
  //       key: 'year',
  //       start: startOfYear(new Date()),
  //       previous: startOfYear(subYears(new Date(), 1)),
  //     },
  //   ];

  //   const salesDataPromises = periods.map(async (period) => {
  //     //현재 기간
  //     const current = await this.prisma.order.aggregate({
  //       where: {
  //         storeId: store.id,
  //         createdAt: { gte: period.start },
  //       },
  //       _count: { id: true },
  //       _sum: { totalPrice: true },
  //     });

  //     //이전 기간
  //     const previous = await this.prisma.order.aggregate({
  //       where: {
  //         storeId: store.id,
  //         createdAt: { gte: period.previous, lt: period.start },
  //       },
  //       _count: { id: true },
  //       _sum: { totalPrice: true },
  //     });

  //     // 변화율 계산 (%, 소수점 첫째 자리)
  //     const totalOrdersCurrent = current._count.id || 0;
  //     const totalSalesCurrent = current._sum.totalPrice || 0;
  //     const totalOrdersPrevious = previous._count.id || 0;
  //     const totalSalesPrevious = previous._sum.totalPrice || 0;
  //     const orderChangeRate = totalOrdersPrevious
  //       ? Number(
  //           ((totalOrdersCurrent - totalOrdersPrevious) / totalOrdersPrevious) *
  //             100,
  //         ).toFixed(1)
  //       : 0;
  //     const salesChangeRate = totalSalesPrevious
  //       ? Number(
  //           ((totalSalesCurrent - totalSalesPrevious) / totalSalesPrevious) *
  //             100,
  //         ).toFixed(1)
  //       : 0;
  //     return {
  //       current: {
  //         totalOrders: totalOrdersCurrent,
  //         totalSales: totalSalesCurrent,
  //       },
  //       previous: {
  //         totalOrders: totalOrdersPrevious,
  //         totalSales: totalSalesPrevious,
  //       },
  //       changeRate: {
  //         totalOrders: orderChangeRate,
  //         totalSales: salesChangeRate,
  //       },
  //     };
  //   });

  //   const salesData = await Promise.all(salesDataPromises);

  //   return salesData;
  // }

  private async getSalesDataByPeriods(userId: string) {
    const store = await this.getStoreBySellerId(userId);
    const now = new Date();

    const periods = [
      { key: 'today', start: startOfDay(now), previous: startOfDay(subDays(now, 1)) },
      { key: 'week', start: startOfWeek(now, { weekStartsOn: 1 }), previous: startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }) },
      { key: 'month', start: startOfMonth(now), previous: startOfMonth(subMonths(now, 1)) },
      { key: 'year', start: startOfYear(now), previous: startOfYear(subYears(now, 1)) },
    ];

    // periodKey를 생성하기 위해 Prisma의 raw query 활용 가능
    // 단순화를 위해 여기선 JS에서 그룹핑
    const startDates = periods.flatMap((p) => [p.previous, p.start]);

    // 한 번의 aggregate로 필요한 모든 주문 데이터 가져오기
    const earliestDate = new Date(Math.min(...startDates.map((date) => date.getTime())));
    const orders = await this.prisma.order.findMany({
      where: {
        storeId: store.id,
        createdAt: { gte: earliestDate },
      },
      select: {
        createdAt: true,
        totalPrice: true,
        id: true,
      },
    });

    // period별로 current/previous 집계
    const salesData = periods.map((period) => {
      const currentOrders = orders.filter(o => o.createdAt >= period.start);
      const previousOrders = orders.filter(o => o.createdAt >= period.previous && o.createdAt < period.start);

      const sumOrders = (arr: typeof orders) => arr.length;
      const sumSales = (arr: typeof orders) => arr.reduce((acc, o) => acc + o.totalPrice, 0);

      const totalOrdersCurrent = sumOrders(currentOrders);
      const totalSalesCurrent = sumSales(currentOrders);
      const totalOrdersPrevious = sumOrders(previousOrders);
      const totalSalesPrevious = sumSales(previousOrders);

      const calcChangeRate = (current: number, previous: number) =>
        previous ? Number(((current - previous) / previous) * 100).toFixed(1) : 0;

      return {
        current: { totalOrders: totalOrdersCurrent, totalSales: totalSalesCurrent },
        previous: { totalOrders: totalOrdersPrevious, totalSales: totalSalesPrevious },
        changeRate: {
          totalOrders: Number(calcChangeRate(totalOrdersCurrent, totalOrdersPrevious)),
          totalSales: Number(calcChangeRate(totalSalesCurrent, totalSalesPrevious)),
        },
      };
    });

    return salesData;
  }
  // 많이 팔린 상품 조회
  private async getTopSales(userId: string) {
    const store = await this.getStoreBySellerId(userId);
    const topSales = await this.prisma.product.findMany({
      where: {
        storeId: store.id,
      },
      select: {
        id: true,
        name: true,
        price: true,
        sales: true,
      },
      orderBy: {
        sales: 'desc',
      },
    });
    const response: TopSale[] = topSales.map((item) => {
      return {
        totalOrders: item.sales,
        product: {
          id: item.id,
          name: item.name,
          price: item.price,
        },
      };
    });
    return response.slice(0, 5); //top5 상품 반환
  }

  // 가격대별 매출 조회
  priceRanges = [
    { range: '20,000원 이하', min: 0, max: 20000 },
    { range: '20,000원 ~ 50,000원', min: 20000, max: 50000 },
    { range: '50,000원 ~ 100,000원', min: 50000, max: 100000 },
    { range: '100,000원 ~ 200,000원', min: 100000, max: 200000 },
    { range: '200,000원 이상', min: 200000, max: 99999999 },
  ];
  private async getPriceRangeData(userId: string) {
    const store = await this.getStoreBySellerId(userId);
    const priceRangeData: PriceRange[] = [];
    for (const range of this.priceRanges) {
      const salesData = await this.prisma.orderItem.aggregate({
        where: {
          order: {
            storeId: store.id,
          },
          price: {
            gte: range.min,
            lte: range.max,
          },
        },
        _sum: {
          price: true,
        },
      });
      priceRangeData.push({
        priceRange: range.range,
        totalSales: salesData._sum.price || 0,
        percentage: 0,
      });
    }
    return priceRangeData;
  }

  // private async getPriceRangeData(userId: string) {
  //   const store = await this.getStoreBySellerId(userId);
  //   const priceRangeData = await this.prisma.$queryRaw<{ price_range: string; total_sales: number }[]>`
  //   SELECT
  //     CASE
  //       WHEN oi.price < 20000 THEN '~20,000 원'
  //       WHEN oi.price < 50000 THEN '~50,000 원'
  //       WHEN oi.price < 100000 THEN '~100,000 원'
  //       WHEN oi.price < 200000 THEN '~200,000 원'
  //       ELSE '200,000원 이상'
  //     END as price_range,
  //     SUM(oi.price) as total_sales
  //   FROM "OrderItem" oi
  //   JOIN "Order" o ON o.id = oi."orderId"
  //   WHERE o."storeId" = ${store.id}
  //   GROUP BY price_range
  //   ORDER BY MIN(oi.price);
  // `;

  //   const totalSales = priceRangeData.reduce(
  //     (acc, cur) => acc + Number(cur.total_sales),
  //     0,
  //   );

  //   const result = priceRangeData.map((row) => ({
  //     priceRange: row.price_range,
  //     totalSales: Number(row.total_sales),
  //     percentage:
  //       totalSales > 0
  //         ? Number(((Number(row.total_sales) / totalSales) * 100).toFixed(1))
  //         : 0,
  //   }));
  //   return result;
  // }

  async getDashboard(userId: string) {
    return {
      salesData: await this.getSalesDataByPeriods(userId),
      topSales: await this.getTopSales(userId),
      priceRange: await this.getPriceRangeData(userId),
    };
  }
  // async getDashboard(userId: string) {
  //   return startSpan(
  //     {
  //       name: 'DashboardService.getDashboard',
  //       op: 'function',
  //     },
  //     async (transaction) => {
  //       // 1) 판매 기간 데이터
  //       const salesData = await startSpan(
  //         { name: 'getSalesDataByPeriods', op: 'db' },
  //         () => this.getSalesDataByPeriods(userId),
  //       );
  //       // 2) top 상품
  //       const topSales = await startSpan(
  //         { name: 'getTopSales', op: 'db' },
  //         () => this.getTopSales(userId),
  //       );
  //       // 3) 가격대별 통계
  //       const priceRangeData = await startSpan(
  //         { name: 'getPriceRangeData', op: 'db.rawQuery' },
  //         () => this.getPriceRangeData(userId),
  //       );
  //       this.logger.error('판매자 정보 조회 성공!');
  //       return {
  //         today: salesData[0],
  //         week: salesData[1],
  //         month: salesData[2],
  //         year: salesData[3],
  //         topSales,
  //         priceRange: priceRangeData,
  //       };
  //     },
  //   );
  // }
}
