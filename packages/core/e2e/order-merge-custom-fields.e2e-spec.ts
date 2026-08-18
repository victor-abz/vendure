/* eslint-disable @typescript-eslint/no-non-null-assertion */

import {
    mergeConfig,
    MergeOrdersStrategy,
    Order,
    OrderMergeStrategy,
    Product,
    RequestContext,
    MergedOrderLine,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql, ResultOf, VariablesOf } from './graphql/graphql-shop';
import { attemptLoginDocument, getCustomerListDocument } from './graphql/shared-definitions';
import { addItemToOrderCustomFieldsDocument } from './graphql/shop-definitions';

class DelegateMergeStrategy implements OrderMergeStrategy {
    static activeStrategy: OrderMergeStrategy = new MergeOrdersStrategy();

    merge(
        ctx: RequestContext,
        guestOrder: Order,
        existingOrder: Order,
    ): MergedOrderLine[] {
        return DelegateMergeStrategy.activeStrategy.merge(ctx, guestOrder, existingOrder);
    }
}

type AddItemToOrderWithCustomFields = VariablesOf<typeof addItemToOrderCustomFieldsDocument> & {
    customFields?: {
        relationFieldId?: string;
    };
};

const getActiveOrderWithCustomFieldsDocument = graphql(`
    query GetActiveOrderWithCustomFields {
        activeOrder {
            id
            code
            lines {
                id
                quantity
                productVariant {
                    id
                }
                customFields {
                    relationField {
                        id
                    }
                }
            }
        }
    }
`);

describe('Order merging with relation custom fields', () => {
    let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];

    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                mergeStrategy: new DelegateMergeStrategy(),
            },
            customFields: {
                OrderLine: [
                    {
                        name: 'relationField',
                        type: 'relation',
                        entity: Product,
                        graphQLType: 'Product',
                    },
                ],
            },
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 10,
        });

        await adminClient.asSuperAdmin();

        const result = await adminClient.query(getCustomerListDocument);
        customers = result.customers.items;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function testMerge(options: {
        strategy: OrderMergeStrategy;
        customerEmailAddress: string;
        existingOrderLines: AddItemToOrderWithCustomFields[];
        guestOrderLines: AddItemToOrderWithCustomFields[];
    }): Promise<{ lines: any[] }> {
        const {
            strategy,
            customerEmailAddress,
            existingOrderLines,
            guestOrderLines,
        } = options;

        DelegateMergeStrategy.activeStrategy = strategy;

        // Create the existing customer's order.
        await shopClient.asUserWithCredentials(customerEmailAddress, 'test');

        for (const line of existingOrderLines) {
            await shopClient.query(
                addItemToOrderCustomFieldsDocument,
                line as VariablesOf<typeof addItemToOrderCustomFieldsDocument>,
            );
        }

        // Create the guest order.
        await shopClient.asAnonymousUser();

        for (const line of guestOrderLines) {
            await shopClient.query(
                addItemToOrderCustomFieldsDocument,
                line as VariablesOf<typeof addItemToOrderCustomFieldsDocument>,
            );
        }

        // Login and trigger the order merge.
        const { login } = await shopClient.query(attemptLoginDocument, {
            username: customerEmailAddress,
            password: 'test',
        });

        expect(login).toBeDefined();

        const { activeOrder } = await shopClient.query(
            getActiveOrderWithCustomFieldsDocument,
        );

        if (!activeOrder) {
            throw new Error('Active order not found');
        }

        return activeOrder;
    }

    it('MergeOrdersStrategy preserves relation custom fields when merging a guest order', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[0].emailAddress,

            existingOrderLines: [
                {
                    productVariantId: 'T_2',
                    quantity: 2,
                    customFields: {
                        relationFieldId: 'T_4',
                    },
                },
            ],

            guestOrderLines: [
                {
                    productVariantId: 'T_3',
                    quantity: 4,
                    customFields: {
                        relationFieldId: 'T_1',
                    },
                },
            ],
        });

        const guestLine = result.lines.find(line => line.quantity === 4);

        expect(guestLine).toBeDefined();
        expect(guestLine?.customFields.relationField?.id).toBe('T_1');
    });
    it('MergeOrdersStrategy preserves relation custom fields from guest order', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[1].emailAddress,

            existingOrderLines: [
                {
                    productVariantId: 'T_2',
                    quantity: 2,
                },
            ],

            guestOrderLines: [
                {
                    productVariantId: 'T_3',
                    quantity: 4,
                    customFields: {
                        relationFieldId: 'T_1',
                    },
                },
            ],
        });

        const guestLine = result.lines.find(line => line.quantity === 4);

        expect(guestLine).toBeDefined();
        expect(guestLine?.customFields.relationField?.id).toBe('T_1');
    });
    it('MergeOrdersStrategy preserves relation custom fields from existing order', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[2].emailAddress,

            existingOrderLines: [
                {
                    productVariantId: 'T_2',
                    quantity: 2,
                    customFields: {
                        relationFieldId: 'T_4',
                    },
                },
            ],

            guestOrderLines: [
                {
                    productVariantId: 'T_3',
                    quantity: 4,
                },
            ],
        });

        const existingLine = result.lines.find(line => line.quantity === 2);

        expect(existingLine).toBeDefined();
        expect(existingLine?.customFields.relationField?.id).toBe('T_4');
    });
    it('MergeOrdersStrategy handles orders without relation custom fields', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[3].emailAddress,

            existingOrderLines: [
                {
                    productVariantId: 'T_2',
                    quantity: 2,
                },
            ],

            guestOrderLines: [
                {
                    productVariantId: 'T_3',
                    quantity: 4,
                },
            ],
        });

        const existingLine = result.lines.find(line => line.quantity === 2);
        const guestLine = result.lines.find(line => line.quantity === 4);

        expect(existingLine).toBeDefined();
        expect(guestLine).toBeDefined();

        expect(existingLine?.customFields.relationField).toBeNull();
        expect(guestLine?.customFields.relationField).toBeNull();
    });
    it('MergeOrdersStrategy preserves relation custom fields on both existing and guest lines', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[4].emailAddress,

            existingOrderLines: [
                {
                    productVariantId: 'T_2',
                    quantity: 2,
                    customFields: {
                        relationFieldId: 'T_4',
                    },
                },
            ],

            guestOrderLines: [
                {
                    productVariantId: 'T_3',
                    quantity: 4,
                    customFields: {
                        relationFieldId: 'T_1',
                    },
                },
            ],
        });

        const existingLine = result.lines.find(line => line.quantity === 2);
        const guestLine = result.lines.find(line => line.quantity === 4);

        expect(existingLine?.customFields.relationField?.id).toBe('T_4');
        expect(guestLine?.customFields.relationField?.id).toBe('T_1');
    });
});