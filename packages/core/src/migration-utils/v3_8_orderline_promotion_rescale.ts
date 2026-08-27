/* eslint-disable no-console */
import { QueryRunner } from 'typeorm';

/**
 * @description
 * Rescales `PROMOTION`-type `Adjustment`s on `order_line` rows that were partially
 * cancelled by a pre-#5127 `cancelOrderByOrderLines()`, which reduced `quantity`
 * without rescaling `adjustments`. Reading those rows with the fixed `OrderLine`
 * getters (which divide a `PROMOTION` adjustment by the *current* `quantity`,
 * instead of `orderPlacedQuantity`) would otherwise inflate their discount.
 *
 * For each affected row, this multiplies each `PROMOTION` adjustment's `amount` by
 * `quantity / orderPlacedQuantity`, matching what `cancelOrderByOrderLines()` itself
 * now does on write.
 *
 * **Limitation:** this assumes the stored amount is still on the `orderPlacedQuantity`
 * basis, i.e. the line hasn't gone through a `modifyOrder` recalculation *since* its
 * last quantity reduction (which would already have rescaled it to that
 * then-current quantity). There is no stored field that distinguishes the two cases.
 * If some of your affected orders have a modification history, spot-check a sample
 * of their `OrderLine.discounts` after migrating before relying on it broadly.
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
    // Standard ANSI SQL literal escaping (doubling embedded single quotes), supported by
    // sqlite, mysql/mariadb and postgres alike.
    const escLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

    const rows: Array<{
        id: string | number;
        quantity: number;
        orderPlacedQuantity: number;
        adjustments: string | null;
    }> = await queryRunner.query(
        `SELECT ${esc('id')}, ${esc('quantity')}, ${esc('orderPlacedQuantity')}, ${esc('adjustments')}
         FROM ${esc('order_line')}
         WHERE ${esc('quantity')} < ${esc('orderPlacedQuantity')} AND ${esc('orderPlacedQuantity')} > 0`,
    );

    let migratedCount = 0;
    for (const row of rows) {
        if (!row.adjustments) {
            continue;
        }
        const adjustments = JSON.parse(row.adjustments);
        if (!Array.isArray(adjustments) || !adjustments.some((a: any) => a.type === 'PROMOTION')) {
            continue;
        }
        const scaleFactor = row.quantity / row.orderPlacedQuantity;
        const rescaledAdjustments = adjustments.map((adjustment: any) =>
            adjustment.type === 'PROMOTION'
                ? { ...adjustment, amount: Math.round(adjustment.amount * scaleFactor) }
                : adjustment,
        );
        await queryRunner.query(
            `UPDATE ${esc('order_line')} SET ${esc('adjustments')} = ${escLiteral(JSON.stringify(rescaledAdjustments))} WHERE ${esc('id')} = ${escLiteral(String(row.id))}`,
        );
        migratedCount++;
    }

    console.log(`Rescaled PROMOTION adjustments on ${migratedCount} partially-cancelled OrderLine row(s).`);
}
