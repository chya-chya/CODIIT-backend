import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { OrdersRepository } from './orders.repository';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { GetOrdersQueryDto } from './dto/get-orders-query.dto';
import { plainToInstance } from 'class-transformer';
import {
  OrderStatus,
  PaymentStatus,
  Prisma,
  Payment,
  Order,
  User,
} from '@prisma/client';
import { PointsService } from '../points/points.service';
import { KafkaProducerService } from '../common/kafka/kafka.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly pointsService: PointsService,
    private readonly kafkaProducerService: KafkaProducerService,
  ) {}

  /**
   * 🛒 주문 생성
   */
  async createOrder(
    userId: string,
    dto: CreateOrderDto,
  ): Promise<OrderResponseDto> {
    const { name, phone, address, orderItems, usePoint = 0 } = dto;

    try {
      // ✅ 유저 검증
      const user: User | null =
        await this.ordersRepository.findUserById(userId);
      if (!user) throw new NotFoundException('존재하지 않는 사용자입니다.');

      // ✅ 포인트 초과 사용 방지
      if (usePoint > user.points)
        throw new BadRequestException('보유 포인트를 초과할 수 없습니다.');

      // ✅ 상품 유효성 검증
      type ProductWithRelations = Prisma.ProductGetPayload<{
        include: { store: true; stocks: { include: { size: true } } };
      }>;

      const products: ProductWithRelations[] =
        await this.ordersRepository.findProductsWithRelations(
          orderItems.map((i) => i.productId),
        );

      if (products.length !== orderItems.length) {
        throw new BadRequestException('상품 정보가 유효하지 않습니다.');
      }

      // ✅ 단일 스토어 검증
      const storeIds = products.map((p) => p.storeId);
      const uniqueStores = new Set(storeIds);
      if (uniqueStores.size > 1) {
        throw new BadRequestException(
          '서로 다른 스토어의 상품은 한 주문으로 결제할 수 없습니다.',
        );
      }
      const storeId = storeIds[0];

      // ✅ 금액 및 수량 재계산
      const totalQuantity = orderItems.reduce(
        (acc, item) => acc + item.quantity,
        0,
      );
      const totalPrice = orderItems.reduce((acc, item) => {
        const product = products.find((p) => p.id === item.productId);
        return acc + (product ? product.price * item.quantity : 0);
      }, 0);

      // ✅ 트랜잭션 처리
      const result: { createdOrder: Order; payment: Payment } =
        await this.ordersRepository.$transaction(async (tx) => {
          const createdOrder: Order = await tx.order.create({
            data: {
              userId,
              storeId,
              recipientName: name,
              recipientPhone: phone,
              address,
              subtotal: totalPrice,
              totalQuantity,
              usePoint,
              totalPrice,
              status: OrderStatus.PROCESSING,
            },
          });

          await tx.orderItem.createMany({
            data: orderItems.map((item) => {
              const product = products.find((p) => p.id === item.productId);
              if (!product)
                throw new BadRequestException('상품 정보를 찾을 수 없습니다.');
              return {
                orderId: createdOrder.id,
                productId: item.productId,
                quantity: item.quantity,
                price: product.price,
              };
            }),
          });

          const payment: Payment = await tx.payment.create({
            data: {
              orderId: createdOrder.id,
              price: totalPrice,
              status: PaymentStatus.PENDING,
            },
          });

          return { createdOrder, payment };
        });

      // ✅ 포인트 차감 (동기)
      if (usePoint > 0) {
        await this.pointsService.spendPointsForOrder(
          userId,
          result.createdOrder.id,
          usePoint,
        );
      }

      // 🚀 주문 완료 이벤트 발행 (포인트 적립 및 알림용)
      this.kafkaProducerService.emit(
        'order.completed',
        result.createdOrder.id,
        result.createdOrder,
      );

      // ✅ 재조회 (relations 포함)
      const fullOrder = await this.ordersRepository.findOrderById(
        result.createdOrder.id,
      );

      if (!fullOrder)
        throw new InternalServerErrorException('주문을 조회할 수 없습니다.');

      // ✅ 응답 변환 (null-safe 접근 적용)
      return plainToInstance(OrderResponseDto, {
        id: fullOrder.id,
        name: fullOrder.recipientName,
        phoneNumber: fullOrder.recipientPhone,
        address: fullOrder.address,
        subtotal: fullOrder.subtotal,
        totalQuantity: fullOrder.totalQuantity,
        usePoint,
        createdAt: fullOrder.createdAt,
        orderItems: fullOrder.items.map((item) => ({
          id: item.id,
          price: item.price,
          quantity: item.quantity,
          productId: item.productId,
          isReviewed: false,
          product: {
            id: item.product?.id ?? 'unknown',
            name: item.product?.name ?? '알 수 없는 상품',
            image: item.product?.image ?? null,
            store: {
              id: item.product?.store?.id ?? item.product?.storeId ?? 'unknown',
              name: item.product?.store?.name ?? '알 수 없는 상점',
              address: item.product?.store?.address ?? '주소 없음',
              image: item.product?.store?.image ?? null,
            },
          },
          size: {
            id: item.product?.stocks?.[0]?.size?.id ?? 0,
            size: item.product?.stocks?.[0]?.size ?? {
              en: 'M',
              ko: 'M',
            },
          },
        })),
        payments: {
          id: fullOrder.payments?.id ?? '',
          price: fullOrder.payments?.price ?? 0,
          status: fullOrder.payments?.status ?? PaymentStatus.PENDING,
          createdAt: fullOrder.payments?.createdAt ?? new Date(),
          orderId: fullOrder.id,
        },
      });
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof NotFoundException
      ) {
        this.logger.warn(`⚠️ ${err.message}`);
        throw err;
      }
      if (err instanceof Error)
        this.logger.error(`❌ 주문 생성 중 오류: ${err.message}`, err.stack);
      throw new InternalServerErrorException(
        '주문 생성 중 오류가 발생했습니다.',
      );
    }
  }

  /**
   * ✏️ 주문 수정
   */
  async updateOrder(
    orderId: string,
    userId: string,
    dto: UpdateOrderDto,
  ): Promise<OrderResponseDto> {
    try {
      const order = await this.ordersRepository.findOrderById(orderId);
      if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
      if (order.userId !== userId)
        throw new ForbiddenException('본인 주문만 수정할 수 있습니다.');

      const updateData = {
        recipientName: dto.name ?? order.recipientName,
        recipientPhone: dto.phone ?? order.recipientPhone,
        address: dto.address ?? order.address,
        usePoint: dto.usePoint ?? order.usePoint,
      };

      const updatedOrder = await this.ordersRepository.updateOrder(
        orderId,
        updateData,
      );
      if (!updatedOrder)
        throw new InternalServerErrorException(
          '주문 수정 중 오류가 발생했습니다.',
        );

      return plainToInstance(OrderResponseDto, updatedOrder);
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof NotFoundException
      ) {
        this.logger.warn(`⚠️ ${err.message}`);
        throw err;
      }
      if (err instanceof Error)
        this.logger.error(`❌ 주문 수정 중 오류: ${err.message}`, err.stack);
      throw new InternalServerErrorException(
        '주문 수정 중 오류가 발생했습니다.',
      );
    }
  }

  /**
   * ❌ 주문 취소
   */
  async cancelOrder(
    orderId: string,
    userId: string,
  ): Promise<{ message: string }> {
    try {
      const order = await this.ordersRepository.findOrderById(orderId);
      if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
      if (order.userId !== userId)
        throw new ForbiddenException('본인 주문만 취소할 수 있습니다.');

      if (order.status !== OrderStatus.PROCESSING) {
        throw new BadRequestException(
          '주문은 PROCESSING 상태에서만 취소할 수 있습니다.',
        );
      }

      await this.ordersRepository.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.CANCELED },
        });
        await tx.payment.update({
          where: { orderId },
          data: { status: PaymentStatus.REFUNDED },
        });
      });

      await this.pointsService.revertOnCancel(orderId);
      this.logger.log(`✅ 주문 취소 및 포인트 회수 완료: ${orderId}`);

      return { message: '주문이 취소되었습니다.' };
    } catch (err: unknown) {
      if (
        err instanceof BadRequestException ||
        err instanceof ForbiddenException ||
        err instanceof NotFoundException
      ) {
        this.logger.warn(`⚠️ ${err.message}`);
        throw err;
      }
      if (err instanceof Error)
        this.logger.error(`❌ 주문 취소 중 오류: ${err.message}`, err.stack);
      throw new InternalServerErrorException(
        '주문 취소 중 오류가 발생했습니다.',
      );
    }
  }

  /**
   * 📦 주문 목록 조회 (구매자 전용)
   */
  async getOrders(userId: string, query: GetOrdersQueryDto) {
    const { page = 1, limit = 10, status } = query;

    try {
      const user = await this.ordersRepository.findUserById(userId);
      if (!user) throw new NotFoundException('존재하지 않는 사용자입니다.');

      const { orders, total } = await this.ordersRepository.findOrdersByUser(
        userId,
        page,
        limit,
        status,
      );

      const totalPages = Math.ceil(total / limit);

      const data = orders.map((order) =>
        plainToInstance(OrderResponseDto, {
          id: order.id,
          name: order.recipientName,
          phoneNumber: order.recipientPhone,
          address: order.address,
          status: order.status,
          subtotal: order.subtotal,
          totalQuantity: order.totalQuantity,
          usePoint: order.usePoint,
          createdAt: order.createdAt,
          orderItems: order.items.map((item) => ({
            id: item.id,
            price: item.price,
            quantity: item.quantity,
            productId: item.productId,
            isReviewed: false,
            product: {
              id: item.product.id,
              storeId: item.product.storeId,
              name: item.product.name,
              price: item.product.price,
              image: item.product.image ?? undefined,
              discountRate: item.product.discountRate,
              discountStartTime: item.product.discountStartTime,
              discountEndTime: item.product.discountEndTime,
              createdAt: item.product.createdAt,
              updatedAt: item.product.updatedAt,
              store: item.product.store,
              stocks: item.product.stocks.map((s) => ({
                id: s.id,
                productId: s.productId,
                sizeId: s.sizeId,
                quantity: s.quantity,
                size: s.size,
              })),
            },
            size: item.product.stocks?.[0]?.size ?? null,
          })),
          payments: order.payments,
        }),
      );

      return { data, meta: { total, page, limit, totalPages } };
    } catch (err: unknown) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof BadRequestException
      ) {
        this.logger.warn(`⚠️ ${err.message}`);
        throw err;
      }
      if (err instanceof Error)
        this.logger.error(
          `❌ 주문 목록 조회 중 오류: ${err.message}`,
          err.stack,
        );
      throw new InternalServerErrorException(
        '주문 목록 조회 중 오류가 발생했습니다.',
      );
    }
  }

  /**
   * 🔍 주문 상세 조회 (구매자 전용)
   */
  async getOrderDetail(orderId: string, userId: string) {
    try {
      const order = await this.ordersRepository.findOrderById(orderId);
      if (!order) throw new NotFoundException('주문을 찾을 수 없습니다.');
      if (order.userId !== userId)
        throw new ForbiddenException('본인 주문만 조회할 수 있습니다.');

      // ✅ DTO 매핑 규칙(recipientName → name, recipientPhone → phone)에 맞게 key 이름 변경
      return plainToInstance(OrderResponseDto, {
        id: order.id,
        recipientName: order.recipientName, // ✅ DTO의 @Expose({ name: 'recipientName' }) 대응
        recipientPhone: order.recipientPhone, // ✅ DTO의 @Expose({ name: 'recipientPhone' }) 대응
        address: order.address,
        subtotal: order.subtotal,
        totalQuantity: order.totalQuantity,
        usePoint: order.usePoint,
        createdAt: order.createdAt,
        orderItems: order.items.map((item) => ({
          id: item.id,
          price: item.price,
          quantity: item.quantity,
          productId: item.productId,
          isReviewed: false,
          product: {
            id: item.product.id,
            storeId: item.product.storeId,
            name: item.product.name,
            price: item.product.price,
            image: item.product.image ?? undefined,
            discountRate: item.product.discountRate,
            discountStartTime: item.product.discountStartTime,
            discountEndTime: item.product.discountEndTime,
            createdAt: item.product.createdAt,
            updatedAt: item.product.updatedAt,
            store: item.product.store,
            stocks: item.product.stocks.map((s) => ({
              id: s.id,
              productId: s.productId,
              sizeId: s.sizeId,
              quantity: s.quantity,
              size: s.size,
            })),
          },
          size: item.product.stocks?.[0]?.size ?? null,
        })),
        payments: order.payments,
      });
    } catch (err: unknown) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof BadRequestException
      ) {
        this.logger.warn(`⚠️ ${err.message}`);
        throw err;
      }
      if (err instanceof Error)
        this.logger.error(
          `❌ 주문 상세 조회 중 오류: ${err.message}`,
          err.stack,
        );
      throw new InternalServerErrorException(
        '주문 상세 조회 중 오류가 발생했습니다.',
      );
    }
  }
}
