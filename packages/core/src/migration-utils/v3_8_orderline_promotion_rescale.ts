/* eslint-disable no-console */
import { QueryRunner } from 'typeorm';

interface CandidateRow {
    id: string | number;
    quantity: number;
    orderPlacedQuantity: number;
    adjustments: string | null;
    lastCancelledAt: Date | string | null;
    lastModifiedAt: Date | string | null;
    modificationDelta: number | string | null;
}

const UPDATE_CHUNK_SIZE = 100;

function toTime(value: Date | string | null): number | null {
    if (value == null) {
        return null;
    }
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

/**
 * Returns the quantity that the row's stored `PROMOTION` amounts are scaled to, or `undefined`
 * if they are already scaled to the current quantity and must be left alone.
 *
 * `PROMOTION` amounts are rewritten in full whenever `OrderCalculator` runs, which is what
 * `OrderModifier.modifyOrder()` ends in. A pre-#5127 `cancelOrderByOrderLines()` is the only
 * thing that reduced `quantity` without rewriting them, so only a line whose most recent
 * quantity change came from a cancellation is stale.
 */
function getStoredQuantityBasis(row: CandidateRow): number | undefined {
    const lastModifiedAt = toTime(row.lastModifiedAt);
    if (lastModifiedAt == null) {
        // Never modified, so the whole reduction came from cancellations and the amounts are
        // still on the placement basis.
        return row.orderPlacedQuantity;
    }
    const lastCancelledAt = toTime(row.lastCancelledAt);
    if (lastCancelledAt == null || lastCancelledAt < lastModifiedAt) {
        // The modification wrote the amounts after any cancellation, so they already match the
        // current quantity.
        return undefined;
    }
    // Modified, then cancelled: the amounts are on the basis the last modification left the line
    // at, which is the placement quantity plus every modification's quantity delta.
    const basis = row.orderPlacedQuantity + Number(row.modificationDelta ?? 0);
    return row.quantity < basis ? basis : undefined;
}

/**
 * @description
 * Rescales `PROMOTION`-type `Adjustment`s on `order_line` rows that were partially
 * cancelled by a pre-#5127 `cancelOrderByOrderLines()`, which reduced `quantity`
 * without rescaling `adjustments`. Reading those rows with the fixed `OrderLine`
 * getters (which divide a `PROMOTION` adjustment by the *current* `quantity`,
 * instead of `orderPlacedQuantity`) would otherwise inflate their discount.
 *
 * Lines whose quantity was reduced by an `OrderModification` are left alone:
 * `OrderModifier.modifyOrder()` ends in `applyPriceAdjustments()`, which recomputes the
 * `PROMOTION` amounts against the new quantity, so they are already correct and rescaling
 * them again would shrink them. Such a line is identified by the `OrderModificationLine` rows
 * joining it to its `OrderModification`s, compared per line against the most recent
 * `Cancellation` on the same line.
 *
 * The one case this cannot see is a cancellation of stock that was allocated but never
 * fulfilled, on a line that was also modified: that records a `Release` rather than a
 * `Cancellation`, and a `Release` is written by modification and cancellation alike, so it
 * carries no signal. Such a line keeps its pre-migration amounts.
 *
 * Call this from your migration's `up()` method - it needs no schema change, so it
 * can run at any point in the migration.
 *
 * ```ts
 * import { MigrationInterface, QueryRunner } from 'typeorm';
 * import { rescaleOrderLinePromotionAdjustments } from '\@vendure/core';
 *
 * export class RescaleOrderLinePromotionAdjustments1234567890 implements MigrationInterface {
 *     public async up(queryRunner: QueryRunner): Promise<any> {
 *         await rescaleOrderLinePromotionAdjustments(queryRunner);
 *     }
 *
 *     public async down(queryRunner: QueryRunner): Promise<any> {
 *         // This is a one-way data migration - the pre-migration amounts are not recoverable.
 *     }
 * }
 * ```
 *
 * @since 3.8.0
 * @docsCategory migration
 */
export async function rescaleOrderLinePromotionAdjustments(queryRunner: QueryRunner): Promise<void> {
    const esc = (name: string) => queryRunner.connection.driver.escape(name);
    const param = (index: number) => queryRunner.connection.driver.createParameter('p', index);

    const rows: CandidateRow[] = await queryRunner.query(
        `SELECT ol.${esc('id')} AS ${esc('id')},
                ol.${esc('quantity')} AS ${esc('quantity')},
                ol.${esc('orderPlacedQuantity')} AS ${esc('orderPlacedQuantity')},
                ol.${esc('adjustments')} AS ${esc('adjustments')},
                (SELECT MAX(sm.${esc('createdAt')}) FROM ${esc('stock_movement')} sm
                  WHERE sm.${esc('orderLineId')} = ol.${esc('id')}
                    AND sm.${esc('type')} = 'CANCELLATION') AS ${esc('lastCancelledAt')},
                (SELECT MAX(om.${esc('createdAt')}) FROM ${esc('order_line_reference')} olr
                  INNER JOIN ${esc('order_modification')} om ON om.${esc('id')} = olr.${esc('modificationId')}
                  WHERE olr.${esc('orderLineId')} = ol.${esc('id')}) AS ${esc('lastModifiedAt')},
                (SELECT SUM(olr.${esc('quantity')}) FROM ${esc('order_line_reference')} olr
                  WHERE olr.${esc('orderLineId')} = ol.${esc('id')}
                    AND olr.${esc('modificationId')} IS NOT NULL) AS ${esc('modificationDelta')}
         FROM ${esc('order_line')} ol
         WHERE ol.${esc('quantity')} < ol.${esc('orderPlacedQuantity')}
           AND ol.${esc('orderPlacedQuantity')} > 0`,
    );

    const updates: Array<{ id: string | number; adjustments: string }> = [];
    for (const row of rows) {
        if (!row.adjustments) {
            continue;
        }
        const adjustments = JSON.parse(row.adjustments);
        if (!Array.isArray(adjustments) || !adjustments.some((a: any) => a.type === 'PROMOTION')) {
            continue;
        }
        const basis = getStoredQuantityBasis(row);
        if (!basis) {
            continue;
        }
        const scaleFactor = row.quantity / basis;
        const rescaledAdjustments = adjustments.map((adjustment: any) =>
            adjustment.type === 'PROMOTION'
                ? { ...adjustment, amount: Math.round(adjustment.amount * scaleFactor) }
                : adjustment,
        );
        updates.push({ id: row.id, adjustments: JSON.stringify(rescaledAdjustments) });
    }

    for (let offset = 0; offset < updates.length; offset += UPDATE_CHUNK_SIZE) {
        const chunk = updates.slice(offset, offset + UPDATE_CHUNK_SIZE);
        const params: Array<string | number> = [];
        const whenClauses = chunk
            .map(update => {
                const idParam = param(params.push(update.id) - 1);
                const adjustmentsParam = param(params.push(update.adjustments) - 1);
                return `WHEN ${idParam} THEN ${adjustmentsParam}`;
            })
            .join(' ');
        const idParams = chunk.map(update => param(params.push(update.id) - 1)).join(', ');
        await queryRunner.query(
            `UPDATE ${esc('order_line')}
             SET ${esc('adjustments')} = CASE ${esc('id')} ${whenClauses} END
             WHERE ${esc('id')} IN (${idParams})`,
            params,
        );
    }

    console.log(`Rescaled PROMOTION adjustments on ${updates.length} partially-cancelled OrderLine row(s).`);
}
