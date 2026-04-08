import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

/**
 * 주문 상품 요청 DTO
 */
export class OrderItemRequestDto {
  @ApiProperty({ example: 'clz9v5krw0001uvznnfvgtcaa', description: '상품 ID' })
  @IsString()
  productId: string;

  @ApiProperty({ example: 'size_xs', description: '사이즈 ID' })
  @IsString()
  sizeId: string;

  @ApiProperty({ example: 1, description: '수량 (1 이상)' })
  @IsInt()
  @Min(1)
  @Transform(({ value }) => Number(value))
  quantity: number;
}

/**
 * 주문 생성 요청 DTO
 */
export class CreateOrderDto {
  @ApiProperty({ example: '김유저', description: '수령인 이름' })
  @IsString()
  name: string;

  @ApiProperty({ example: '010-1234-5678', description: '수령인 전화번호' })
  @IsString()
  phone: string;

  @ApiProperty({ example: '서울특별시 강남구', description: '배송지 주소' })
  @IsString()
  address: string;

  @ApiProperty({
    type: [OrderItemRequestDto],
    description: '주문 상품 목록',
  })
  @ValidateNested({ each: true })
  @Type(() => OrderItemRequestDto)
  orderItems: OrderItemRequestDto[];

  @ApiProperty({ example: 1000, description: '사용 포인트', required: false })
  @IsInt()
  @IsOptional()
  @Transform(({ value }) => Number(value))
  usePoint: number = 0;
}
