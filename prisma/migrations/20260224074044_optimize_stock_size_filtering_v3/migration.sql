-- DropIndex
DROP INDEX "public"."Stock_sizeId_idx";

-- CreateIndex
CREATE INDEX "Stock_sizeId_productId_idx" ON "Stock"("sizeId", "productId");

-- CreateIndex
CREATE INDEX "StockSize_name_idx" ON "StockSize"("name");
