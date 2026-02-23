-- CreateIndex
CREATE INDEX "Product_price_idx" ON "Product"("price");

-- CreateIndex
CREATE INDEX "Product_createdAt_idx" ON "Product"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "Product_sales_idx" ON "Product"("sales" DESC);

-- CreateIndex
CREATE INDEX "Product_categoryId_createdAt_idx" ON "Product"("categoryId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Product_categoryId_price_idx" ON "Product"("categoryId", "price");

-- CreateIndex
CREATE INDEX "Product_categoryId_sales_idx" ON "Product"("categoryId", "sales" DESC);

-- CreateIndex
CREATE INDEX "Product_storeId_createdAt_idx" ON "Product"("storeId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Review_productId_idx" ON "Review"("productId");
