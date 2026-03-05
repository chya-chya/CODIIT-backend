-- CreateIndex
CREATE INDEX "Product_discountPrice_idx" ON "Product"("discountPrice");

-- CreateIndex
CREATE INDEX "Product_categoryId_discountPrice_idx" ON "Product"("categoryId", "discountPrice");
