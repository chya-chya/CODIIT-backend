-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "avgRating" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "reviewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Product_reviewCount_idx" ON "Product"("reviewCount" DESC);

-- CreateIndex
CREATE INDEX "Product_avgRating_idx" ON "Product"("avgRating" DESC);

-- CreateIndex
CREATE INDEX "Product_categoryId_reviewCount_idx" ON "Product"("categoryId", "reviewCount" DESC);

-- CreateIndex
CREATE INDEX "Product_categoryId_avgRating_idx" ON "Product"("categoryId", "avgRating" DESC);
