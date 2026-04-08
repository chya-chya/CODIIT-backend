import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationType, UserType } from '@prisma/client';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // 특정 사용자 소유의 알림 1건 조회
  async findByIdAndUser(alarmId: string, userId: string) {
    return this.prisma.notification.findFirst({
      where: { id: alarmId, userId },
    });
  }

  // 사용자 타입 조회
  async findUserType(userId: string): Promise<UserType> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { type: true },
    });

    if (!user) throw new Error('User not found');
    return user.type;
  }

  // 알림 목록 조회
  async findMany(params: {
    userId: string;
    isRead?: boolean;
    types?: NotificationType[];
  }) {
    const { userId, isRead, types } = params;
    return this.prisma.notification.findMany({
      where: {
        userId,
        ...(typeof isRead === 'boolean' ? { isRead } : {}),
        ...(types?.length ? { type: { in: types } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 읽음 처리
  async markRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: { isRead: true, readAt: new Date() },
    });
  }

  // 알림 생성
  async create(data: {
    userId: string;
    type: NotificationType;
    message: string;
    orderId?: string;
  }) {
    return this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        message: data.message,
        orderId: data.orderId,
      },
    });
  }
}
