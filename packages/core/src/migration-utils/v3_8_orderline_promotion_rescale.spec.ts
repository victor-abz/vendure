import { QueryRunner } from 'typeorm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rescaleOrderLinePromotionAdjustments } from './v3_8_orderline_promotion_rescale';

interface Row {
    id: number;
    quantity: number;
    orderPlacedQuantity: number;
    adjustments: string | null;
    lastCancelledAt?: string | null;
    lastModifiedAt?: string | null;
    modificationDelta?: number | null;
}

interface ExecutedQuery {
    sql: string;
    params: any[];
}

function promotion(amount: number) {
    return { adjustmentSource: 'PROMOTION:1', type: 'PROMOTION', description: '50% off', amount, data: {} };
}

function distributed(amount: number) {
    return {
        adjustmentSource: 'PROMOTION:2',
        type: 'DISTRIBUTED_ORDER_PROMOTION',
        description: '£5 off order',
        amount,
        data: {},
    };
}

function createQueryRunner(rows: Row[]) {
    const executed: ExecutedQuery[] = [];
    const queryRunner = {
        connection: {
            driver: {
                escape: (name: string) => `"${name}"`,
                createParameter: (_name: string, index: number) => `$${index + 1}`,
            },
        },
        query: vi.fn(async (sql: string, params: any[] = []) => {
            executed.push({ sql, params });
            if (sql.trim().startsWith('SELECT')) {
                return rows.map(row => ({
                    lastCancelledAt: null,
                    lastModifiedAt: null,
                    modificationDelta: null,
                    ...row,
                }));
            }
            return [];
        }),
    } as unknown as QueryRunner;
    return { queryRunner, executed };
}

function updatesFrom(executed: ExecutedQuery[]) {
    return executed.filter(q => q.sql.trim().startsWith('UPDATE'));
}

/**
 * Reads back the adjustments the migration would have written for the given order_line id, by
 * pairing up the parameters of the `CASE "id" WHEN ? THEN ?` update.
 */
function writtenAdjustmentsFor(executed: ExecutedQuery[], id: number): any[] | undefined {
    for (const query of updatesFrom(executed)) {
        const whenCount = (query.sql.match(/WHEN/g) ?? []).length;
        for (let i = 0; i < whenCount; i++) {
            if (query.params[i * 2] === id) {
                return JSON.parse(query.params[i * 2 + 1]);
            }
        }
    }
    return undefined;
}

describe('rescaleOrderLinePromotionAdjustments()', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    it('rescales a partially-cancelled line to its current quantity', async () => {
        // 20 units at 2975 with a 50% item promotion, 18 units cancelled by pre-#5127 code.
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 2,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-29750)]),
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(writtenAdjustmentsFor(executed, 1)).toEqual([promotion(-2975)]);
    });

    it('leaves non-PROMOTION adjustments untouched', async () => {
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 2,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-29750), distributed(-500)]),
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(writtenAdjustmentsFor(executed, 1)).toEqual([promotion(-2975), distributed(-500)]);
    });

    it('leaves a line reduced by an OrderModification untouched', async () => {
        // modifyOrder() ends in applyPriceAdjustments(), so -2975 is already the correct amount
        // for the 2 remaining units. Rescaling it again would give -297.
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 2,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-2975)]),
                lastModifiedAt: '2026-01-02T00:00:00.000Z',
                modificationDelta: -18,
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('leaves a line untouched when the modification is more recent than the cancellation', async () => {
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 8,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-11900)]),
                lastCancelledAt: '2026-01-02T00:00:00.000Z',
                lastModifiedAt: '2026-01-03T00:00:00.000Z',
                modificationDelta: -2,
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('leaves a line untouched when the modification and cancellation have equal timestamps', async () => {
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 8,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-11900)]),
                lastCancelledAt: '2026-01-02T00:00:00.000Z',
                lastModifiedAt: '2026-01-02T00:00:00.000Z',
                modificationDelta: -2,
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('rescales a modified-then-cancelled line from its post-modification quantity', async () => {
        // Placed at 20, modified down to 10 (which rewrote the amount to -14875), then 8 units
        // cancelled. The basis is 10, not the placement quantity of 20.
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 2,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-14875)]),
                lastCancelledAt: '2026-01-03T00:00:00.000Z',
                lastModifiedAt: '2026-01-02T00:00:00.000Z',
                modificationDelta: -10,
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(writtenAdjustmentsFor(executed, 1)).toEqual([promotion(-2975)]);
    });

    it('skips lines with no PROMOTION adjustment', async () => {
        const { queryRunner, executed } = createQueryRunner([
            { id: 1, quantity: 2, orderPlacedQuantity: 20, adjustments: JSON.stringify([distributed(-500)]) },
            { id: 2, quantity: 2, orderPlacedQuantity: 20, adjustments: null },
            { id: 3, quantity: 2, orderPlacedQuantity: 20, adjustments: JSON.stringify([]) },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed)).toEqual([]);
    });

    it('passes values as bound parameters rather than SQL literals', async () => {
        const { queryRunner, executed } = createQueryRunner([
            {
                id: 1,
                quantity: 2,
                orderPlacedQuantity: 20,
                // A description carrying a quote and a backslash, which literal-escaping mangles.
                adjustments: JSON.stringify([{ ...promotion(-29750), description: `Bob's 50\\% off` }]),
            },
        ]);

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        const [update] = updatesFrom(executed);
        expect(update.sql).not.toContain('Bob');
        expect(update.sql).not.toContain('-2975');
        expect(update.params[0]).toBe(1);
        expect(JSON.parse(update.params[1])[0].description).toBe(`Bob's 50\\% off`);
    });

    it('updates all affected rows in a single statement', async () => {
        const { queryRunner, executed } = createQueryRunner(
            [1, 2, 3].map(id => ({
                id,
                quantity: 2,
                orderPlacedQuantity: 20,
                adjustments: JSON.stringify([promotion(-29750)]),
            })),
        );

        await rescaleOrderLinePromotionAdjustments(queryRunner);

        expect(updatesFrom(executed).length).toBe(1);
        for (const id of [1, 2, 3]) {
            expect(writtenAdjustmentsFor(executed, id)).toEqual([promotion(-2975)]);
        }
    });
});
