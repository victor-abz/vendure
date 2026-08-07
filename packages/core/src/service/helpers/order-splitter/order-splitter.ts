import { Injectable } from '@nestjs/common';
import { OrderType } from '@vendure/common/lib/generated-types';
import { pick } from '@vendure/common/lib/pick';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../../api/common/request-context';
import { ConfigService } from '../../../config/config.service';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { Order } from '../../../entity/order/order.entity';
import { ShippingLine } from '../../../entity/shipping-line/shipping-line.entity';
import { ChannelService } from '../../services/channel.service';
import { OrderService } from '../../services/order.service';

@Injectable()
export class OrderSplitter {
    constructor(
        private connection: TransactionalConnection,
        private configService: ConfigService,
        private channelService: ChannelService,
        private orderService: OrderService,
    ) {}

    async createSellerOrders(ctx: RequestContext, order: Order): Promise<Order[]> {
        const { orderSellerStrategy } = this.configService.orderOptions;
        const partialOrders = await orderSellerStrategy.splitOrder?.(ctx, order);
        if (!partialOrders || partialOrders.length === 0) {
            // No split is needed
            return [];
        }
        const defaultChannel = await this.channelService.getDefaultChannel(ctx);

        order.type = OrderType.Aggregate;
        const sellerOrders: Order[] = [];
        for (const partialOrder of partialOrders) {
            const lines: OrderLine[] = [];
            for (const line of partialOrder.lines) {
                lines.push(await this.duplicateOrderLine(ctx, line));
            }
            const shippingLines: ShippingLine[] = [];
            for (const shippingLine of partialOrder.shippingLines) {
                const newShippingLine = await this.duplicateShippingLine(ctx, shippingLine);
                for (const line of lines) {
                    if (shippingLine.id === line.shippingLineId) {
                        line.shippingLineId = newShippingLine.id;
                        await this.connection.getRepository(ctx, OrderLine).save(line);
                    }
                }
                shippingLines.push(newShippingLine);
            }
            const sellerOrder = await this.connection.getRepository(ctx, Order).save(
                new Order({
                    type: OrderType.Seller,
                    aggregateOrderId: order.id,
                    code: await this.configService.orderOptions.orderCodeStrategy.generate(ctx),
                    active: false,
                    orderPlacedAt: new Date(),
                    customer: order.customer,
                    channels:
                        partialOrder.channelId === defaultChannel.id
                            ? [defaultChannel]
                            : [new Channel({ id: partialOrder.channelId }), defaultChannel],
                    state: partialOrder.state,
                    lines,
                    surcharges: [],
                    shippingLines,
                    couponCodes: order.couponCodes,
                    modifications: [],
                    shippingAddress: order.shippingAddress,
                    billingAddress: order.billingAddress,
                    subTotal: 0,
                    subTotalWithTax: 0,
                    currencyCode: order.currencyCode,
                }),
            );

            await this.connection
                .getRepository(ctx, Order)
                .createQueryBuilder()
                .relation('sellerOrders')
                .of(order)
                .add(sellerOrder);
            const sellerCtx = await this.createSellerChannelContext(ctx, partialOrder.channelId);
            await this.orderService.applyPriceAdjustments(sellerCtx, sellerOrder);
            sellerOrders.push(sellerOrder);
        }
        await orderSellerStrategy.afterSellerOrdersCreated?.(ctx, order, sellerOrders);
        return order.sellerOrders;
    }

    /**
     * A seller Order belongs to the seller's Channel, so price adjustments must be applied in a
     * RequestContext scoped to that Channel. Otherwise Promotions are resolved from the aggregate
     * Order's Channel and leak into seller Orders belonging to other Channels.
     *
     * The context is copied rather than constructed from scratch so that everything else is
     * carried over: the session (so Promotion conditions which depend on the Customer still
     * evaluate correctly), the currencyCode (so that a seller Channel with a different default
     * currency does not cause the seller Order to be re-priced into that currency), and the
     * transaction manager (so that the price adjustments are saved inside the same transaction).
     */
    private async createSellerChannelContext(ctx: RequestContext, channelId: ID): Promise<RequestContext> {
        const sellerChannel = await this.channelService.findOne(ctx, channelId);
        if (!sellerChannel) {
            return ctx;
        }
        const sellerCtx = ctx.copy();
        (sellerCtx as any)._channel = sellerChannel;
        return sellerCtx;
    }

    private async duplicateOrderLine(ctx: RequestContext, line: OrderLine): Promise<OrderLine> {
        const newLine = await this.connection.getRepository(ctx, OrderLine).save(
            new OrderLine({
                ...pick(line, [
                    'quantity',
                    'productVariant',
                    'productVariantId',
                    'taxCategory',
                    'taxCategoryId',
                    'featuredAsset',
                    'shippingLine',
                    'shippingLineId',
                    'customFields',
                    'sellerChannel',
                    'sellerChannelId',
                    'initialListPrice',
                    'listPrice',
                    'listPriceIncludesTax',
                    'adjustments',
                    'taxLines',
                    'orderPlacedQuantity',
                ]),
            }),
        );
        return newLine;
    }

    private async duplicateShippingLine(
        ctx: RequestContext,
        shippingLine: ShippingLine,
    ): Promise<ShippingLine> {
        return await this.connection.getRepository(ctx, ShippingLine).save(
            new ShippingLine({
                ...pick(shippingLine, [
                    'shippingMethodId',
                    'order',
                    'listPrice',
                    'listPriceIncludesTax',
                    'adjustments',
                    'taxLines',
                ]),
            }),
        );
    }
}
