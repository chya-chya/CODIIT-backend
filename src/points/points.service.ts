import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PointsRepository } from './points.repository';
import { REASON } from './points.types';
import { GradeService } from 'src/grades/grade.service';

@Injectable()
export class PointsService {
  constructor(
    private readonly repo: PointsRepository,
    private readonly grade: GradeService,
  ) {}

  // 조회: 내 포인트/등급 요약
  async getMyPointSummary(userId: string) {
    const user = await this.repo.getUserBasic(userId);
    if (!user) throw new BadRequestException('사용자를 찾을 수 없습니다.');

    const { lifetime, grade } = await this.grade.getCurrentGrade(userId);
    const earnRate = this.grade.getEarnRate(grade);
    const next = this.grade.getNextGradeInfo(lifetime);

    return {
      points: user.points,
      gradeLevel: grade,
      lifetimePurchase: lifetime,
      earnRate,
      nextGrade: next.next,
      needToNext: next.need,
    };
  }

  // 주문 시 포인트 차감
  async spendPointsForOrder(userId: string, orderId: string, amount: number) {
    if (!amount || amount <= 0) return;

    await this.repo.prismaSvc.$transaction(async (tx) => {
      if (await this.repo.hasPointLog(userId, orderId, REASON.SPEND_ORDER, tx))
        return;

      const ok = await this.repo.decUserPointsIfEnough(userId, amount, tx);
      if (!ok) throw new BadRequestException('보유 포인트가 부족합니다.');

      await this.repo.createPointLog(
        userId,
        orderId,
        -amount,
        REASON.SPEND_ORDER,
        tx,
      );
    });
  }

  // 결제완료 → 적립
  async earnPointsOnPaidOrder(orderId: string) {
    await this.repo.prismaSvc.$transaction(async (tx) => {
      const order = await this.repo.getOrder(orderId, tx);
      if (!order) throw new BadRequestException('주문을 찾을 수 없습니다.');

      if (
        await this.repo.hasPointLog(
          order.userId,
          order.id,
          REASON.EARN_PURCHASE,
          tx,
        )
      )
        return;

      // 지금 처리 중인 주문제외 등급으로 적립률 산정
      const { grade } = await this.grade.getCurrentGrade(
        order.userId,
        tx,
        order.id,
      );
      const rate = this.grade.getEarnRate(grade);
      const earn = Math.floor(Math.max(0, order.totalPrice) * rate);

      if (earn > 0) {
        await this.repo.incUserPoints(order.userId, earn, tx);
        await this.repo.createPointLog(
          order.userId,
          order.id,
          earn,
          REASON.EARN_PURCHASE,
          tx,
        );
      }

      // 표시용 등급 캐시 동기화
      const after = await this.grade.getCurrentGrade(order.userId, tx);
      await this.grade.syncUserGrade(order.userId, after.grade, tx);
    });
  }

  // 취소/환불 → 적립 회수 및 등급 동기화
  async revertOnCancel(orderId: string) {
    await this.repo.prismaSvc.$transaction(async (tx) => {
      const order = await this.repo.getOrder(orderId, tx);
      if (!order) return;

      const alreadyReverted = await this.repo.hasPointLog(
        order.userId,
        order.id,
        REASON.REVERT_CANCEL,
        tx,
      );
      if (!alreadyReverted) {
        const earnedDelta = await this.repo.getEarnedDelta(
          order.userId,
          order.id,
          tx,
        );
        if (earnedDelta > 0) {
          const ok = await this.repo.decUserPointsIfEnough(
            order.userId,
            earnedDelta,
            tx,
          );
          if (!ok) throw new BadRequestException('회수할 포인트가 부족합니다.');

          await this.repo.createPointLog(
            order.userId,
            order.id,
            -earnedDelta,
            REASON.REVERT_CANCEL,
            tx,
          );
        }
      }

      const after = await this.grade.getCurrentGrade(order.userId, tx);
      await this.grade.syncUserGrade(order.userId, after.grade, tx);
    });
  }
}
