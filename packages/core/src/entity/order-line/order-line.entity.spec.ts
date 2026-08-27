import { Adjustment, AdjustmentType } from '@vendure/common/lib/generated-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureConfigLoaded } from '../../config/config-helpers';

import { OrderLine } from './order-line.entity';

describe('OrderLine entity', () => {
    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    describe('discounts', () => {
        const distributedOrderPromotionAdjustment: Adjustment = {
            adjustmentSource: 'PROMOTION:1',
            type: AdjustmentType.DISTRIBUTED_ORDER_PROMOTION,
            description: 'half price',
            amount: -500,
            data: {},
        };

        const itemPromotionAdjustment: Adjustment = {
            adjustmentSource: 'PROMOTION:2',
            type: AdjustmentType.PROMOTION,
            description: '40% off',
            amount: -400,
            data: {},
        };

        function createOrderLine(
            quantity: number,
            orderPlacedQuantity: number,
            adjustments: Adjustment[] = [distributedOrderPromotionAdjustment],
        ): OrderLine {
            return new OrderLine({
                quantity,
                orderPlacedQuantity,
                listPrice: 1000,
                listPriceIncludesTax: true,
                taxLines: [{ description: 'vat', taxRate: 20 }],
                adjustments,
            });
        }

        it('prorates the adjustment over the placed quantity', () => {
            const line = createOrderLine(2, 2);

            expect(line.discounts[0].amountWithTax).toBe(-500);
        });

        // #5097 — a line added by an OrderModification keeps an orderPlacedQuantity of 0, so
        // cancelling it left both quantities at 0 and the division produced NaN.
        it('is zero for a cancelled line which was added after the order was placed', () => {
            const line = createOrderLine(0, 0);

            expect(line.discounts[0].amount).toBe(0);
            expect(line.discounts[0].amountWithTax).toBe(0);
        });

        // #5127 — a PROMOTION adjustment's stored amount is already scaled to the current
        // quantity, unlike DISTRIBUTED_ORDER_PROMOTION, so it must not be divided again by
        // orderPlacedQuantity.
        it('does not re-divide a PROMOTION adjustment by orderPlacedQuantity', () => {
            const line = createOrderLine(2, 20, [itemPromotionAdjustment]);

            expect(line.discounts[0].amountWithTax).toBe(-400);
        });

        it('applies each adjustment type on its own basis when both are present', () => {
            const line = createOrderLine(2, 20, [
                distributedOrderPromotionAdjustment,
                itemPromotionAdjustment,
            ]);

            const distributed = line.discounts.find(d => d.adjustmentSource === 'PROMOTION:1');
            const item = line.discounts.find(d => d.adjustmentSource === 'PROMOTION:2');
            expect(distributed?.amountWithTax).toBe(-50);
            expect(item?.amountWithTax).toBe(-400);
        });

        it('does not divide a PROMOTION adjustment by zero when orderPlacedQuantity is 0', () => {
            const line = createOrderLine(2, 0, [itemPromotionAdjustment]);

            expect(line.discounts[0].amountWithTax).toBe(-400);
        });
    });
});
