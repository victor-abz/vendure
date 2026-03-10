/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    mergeConfig,
    MergedOrderLine,
    MergeOrdersStrategy,
    Order,
    OrderMergeStrategy,
    RequestContext,
    UseExistingStrategy,
    UseGuestIfExistingEmptyStrategy,
    UseGuestStrategy,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import * as Codegen from './graphql/generated-e2e-admin-types';
import { AttemptLoginMutation, AttemptLoginMutationVariables } from './graphql/generated-e2e-admin-types';
import {
    AddItemToOrderMutation,
    AddItemToOrderMutationVariables,
    GetNextOrderStatesQuery,
    TestOrderFragmentFragment,
    UpdatedOrderFragment,
} from './graphql/generated-e2e-shop-types';
import { ATTEMPT_LOGIN, GET_CUSTOMER_LIST, UPDATE_PRODUCT } from './graphql/shared-definitions';
import { GET_NEXT_STATES, TEST_ORDER_FRAGMENT } from './graphql/shop-definitions';
import { sortById } from './utils/test-order-utils';

/**
 * Allows us to change the active OrderMergeStrategy per-test and delegates to the current
 * activeStrategy.
 */
class DelegateMergeStrategy implements OrderMergeStrategy {
    static activeStrategy: OrderMergeStrategy = new MergeOrdersStrategy();
    merge(ctx: RequestContext, guestOrder: Order, existingOrder: Order): MergedOrderLine[] {
        return DelegateMergeStrategy.activeStrategy.merge(ctx, guestOrder, existingOrder);
    }
}

type AddItemToOrderWithCustomFields = AddItemToOrderMutationVariables & {
    customFields?: { inscription?: string };
};

describe('Order merging', () => {
    type OrderSuccessResult = UpdatedOrderFragment | TestOrderFragmentFragment;
    const orderResultGuard: ErrorResultGuard<OrderSuccessResult> = createErrorResultGuard(
        input => !!input.lines,
    );

    let customers: Codegen.GetCustomerListQuery['customers']['items'];

    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                mergeStrategy: new DelegateMergeStrategy(),
            },
            customFields: {
                OrderLine: [{ name: 'inscription', type: 'string' }],
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
        const result = await adminClient.query<Codegen.GetCustomerListQuery>(GET_CUSTOMER_LIST);
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
        const { strategy, customerEmailAddress, existingOrderLines, guestOrderLines } = options;
        DelegateMergeStrategy.activeStrategy = strategy;

        await shopClient.asUserWithCredentials(customerEmailAddress, 'test');
        for (const line of existingOrderLines) {
            await shopClient.query<AddItemToOrderMutation, AddItemToOrderWithCustomFields>(
                ADD_ITEM_TO_ORDER_WITH_CUSTOM_FIELDS,
                line,
            );
        }

        await shopClient.asAnonymousUser();
        for (const line of guestOrderLines) {
            await shopClient.query<AddItemToOrderMutation, AddItemToOrderWithCustomFields>(
                ADD_ITEM_TO_ORDER_WITH_CUSTOM_FIELDS,
                line,
            );
        }

        await shopClient.query<Codegen.AttemptLoginMutation, Codegen.AttemptLoginMutationVariables>(
            ATTEMPT_LOGIN,
            {
                username: customerEmailAddress,
                password: 'test',
            },
        );
        const { activeOrder } = await shopClient.query(GET_ACTIVE_ORDER_WITH_CUSTOM_FIELDS);
        return activeOrder;
    }

    it('MergeOrdersStrategy adds new line', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[0].emailAddress,
            existingOrderLines: [{ productVariantId: 'T_1', quantity: 1 }],
            guestOrderLines: [{ productVariantId: 'T_2', quantity: 1 }],
        });

        expect(
            result.lines.map(line => ({ productVariantId: line.productVariant.id, quantity: line.quantity })),
        ).toEqual([
            { productVariantId: 'T_1', quantity: 1 },
            { productVariantId: 'T_2', quantity: 1 },
        ]);
    });

    it('MergeOrdersStrategy uses guest quantity', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[1].emailAddress,
            existingOrderLines: [{ productVariantId: 'T_1', quantity: 1 }],
            guestOrderLines: [{ productVariantId: 'T_1', quantity: 3 }],
        });

        expect(
            result.lines.map(line => ({ productVariantId: line.productVariant.id, quantity: line.quantity })),
        ).toEqual([{ productVariantId: 'T_1', quantity: 3 }]);
    });

    it('MergeOrdersStrategy accounts for customFields', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[2].emailAddress,
            existingOrderLines: [
                { productVariantId: 'T_1', quantity: 1, customFields: { inscription: 'foo' } },
            ],
            guestOrderLines: [{ productVariantId: 'T_1', quantity: 3, customFields: { inscription: 'bar' } }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
                customFields: line.customFields,
            })),
        ).toEqual([
            { productVariantId: 'T_1', quantity: 1, customFields: { inscription: 'foo' } },
            { productVariantId: 'T_1', quantity: 3, customFields: { inscription: 'bar' } },
        ]);
    });

    it('UseGuestStrategy', async () => {
        const result = await testMerge({
            strategy: new UseGuestStrategy(),
            customerEmailAddress: customers[3].emailAddress,
            existingOrderLines: [
                { productVariantId: 'T_1', quantity: 1 },
                { productVariantId: 'T_3', quantity: 1 },
            ],
            guestOrderLines: [{ productVariantId: 'T_5', quantity: 3 }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_5', quantity: 3 }]);
    });

    it('UseGuestStrategy with conflicting lines', async () => {
        const result = await testMerge({
            strategy: new UseGuestStrategy(),
            customerEmailAddress: customers[8].emailAddress,
            existingOrderLines: [
                { productVariantId: 'T_7', quantity: 1 },
                { productVariantId: 'T_8', quantity: 1 },
            ],
            guestOrderLines: [{ productVariantId: 'T_8', quantity: 3 }],
        });

        expect(
            (result?.lines || []).sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_8', quantity: 3 }]);
    });

    it('UseGuestIfExistingEmptyStrategy with empty existing', async () => {
        const result = await testMerge({
            strategy: new UseGuestIfExistingEmptyStrategy(),
            customerEmailAddress: customers[4].emailAddress,
            existingOrderLines: [],
            guestOrderLines: [{ productVariantId: 'T_2', quantity: 3 }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_2', quantity: 3 }]);
    });

    it('UseGuestIfExistingEmptyStrategy with non-empty existing', async () => {
        const result = await testMerge({
            strategy: new UseGuestIfExistingEmptyStrategy(),
            customerEmailAddress: customers[5].emailAddress,
            existingOrderLines: [{ productVariantId: 'T_5', quantity: 5 }],
            guestOrderLines: [{ productVariantId: 'T_2', quantity: 3 }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_5', quantity: 5 }]);
    });

    it('UseExistingStrategy', async () => {
        const result = await testMerge({
            strategy: new UseExistingStrategy(),
            customerEmailAddress: customers[6].emailAddress,
            existingOrderLines: [{ productVariantId: 'T_8', quantity: 1 }],
            guestOrderLines: [{ productVariantId: 'T_2', quantity: 3 }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_8', quantity: 1 }]);
    });

    // https://github.com/vendurehq/vendure/issues/1454
    it('does not throw FK error when merging with a cart with an existing session', async () => {
        await shopClient.asUserWithCredentials(customers[7].emailAddress, 'test');
        // Create an Order linked with the current session
        const { nextOrderStates } = await shopClient.query<GetNextOrderStatesQuery>(GET_NEXT_STATES);

        // unset last auth token to simulate a guest user in a different browser
        shopClient.setAuthToken('');
        await shopClient.query<AddItemToOrderMutation, AddItemToOrderWithCustomFields>(
            ADD_ITEM_TO_ORDER_WITH_CUSTOM_FIELDS,
            { productVariantId: '1', quantity: 2 },
        );

        const { login } = await shopClient.query<AttemptLoginMutation, AttemptLoginMutationVariables>(
            ATTEMPT_LOGIN,
            { username: customers[7].emailAddress, password: 'test' },
        );

        expect(login.id).toBe(customers[7].user?.id);
    });

    // https://github.com/vendurehq/vendure/issues/4481
    // When the merge fails mid-operation (e.g. a guest cart item's product has been disabled),
    // the merge should fail gracefully: the login should succeed and the existing order
    // should be preserved unchanged.
    it('should preserve existing order and succeed login when merge fails mid-operation', async () => {
        DelegateMergeStrategy.activeStrategy = new UseGuestStrategy();

        // Step 1: Customer logs in and adds an item to their order
        await shopClient.asUserWithCredentials(customers[9].emailAddress, 'test');
        await shopClient.query<AddItemToOrderMutation, AddItemToOrderWithCustomFields>(
            ADD_ITEM_TO_ORDER_WITH_CUSTOM_FIELDS,
            { productVariantId: 'T_1', quantity: 2 },
        );

        // Step 2: Log out and create a guest order with a different product
        await shopClient.asAnonymousUser();
        await shopClient.query<AddItemToOrderMutation, AddItemToOrderWithCustomFields>(
            ADD_ITEM_TO_ORDER_WITH_CUSTOM_FIELDS,
            { productVariantId: 'T_5', quantity: 1 },
        );

        // Step 3: Disable the product that owns variant T_5 (Curvy Monitor = product T_2).
        // This will cause addItemsToOrder to throw EntityNotFoundError when the merge
        // tries to insert the guest line into the existing order.
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_2', enabled: false },
        });

        // Step 4: Attempt login — triggers mergeOrders with UseGuestStrategy.
        // UseGuestStrategy says "replace existing order contents with guest order contents",
        // so the merge flow is:
        //   1. deleteOrder(guestOrder) — DB mutation
        //   2. removeItemFromOrder(T_1) — DB mutation (removes existing line)
        //   3. addItemsToOrder([T_5]) — THROWS (product disabled)
        // Without the fix: the error propagates, login fails
        // With the fix: merge error is caught, rolled back, login succeeds
        const { login } = await shopClient.query<AttemptLoginMutation, AttemptLoginMutationVariables>(
            ATTEMPT_LOGIN,
            { username: customers[9].emailAddress, password: 'test' },
        );
        expect(login.id).toBeDefined();

        // Step 5: The existing order should be preserved with its original line
        const { activeOrder } = await shopClient.query(GET_ACTIVE_ORDER_WITH_CUSTOM_FIELDS);
        expect(activeOrder).not.toBeNull();
        expect(activeOrder.lines.length).toBe(1);
        expect(activeOrder.lines[0].productVariant.id).toBe('T_1');
        expect(activeOrder.lines[0].quantity).toBe(2);

        // Cleanup: re-enable the product
        await adminClient.query(UPDATE_PRODUCT, {
            input: { id: 'T_2', enabled: true },
        });
    });
});

export const ADD_ITEM_TO_ORDER_WITH_CUSTOM_FIELDS = gql`
    mutation AddItemToOrder(
        $productVariantId: ID!
        $quantity: Int!
        $customFields: OrderLineCustomFieldsInput
    ) {
        addItemToOrder(
            productVariantId: $productVariantId
            quantity: $quantity
            customFields: $customFields
        ) {
            ... on Order {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`;

export const GET_ACTIVE_ORDER_WITH_CUSTOM_FIELDS = gql`
    query GetActiveOrder {
        activeOrder {
            ...TestOrderFragment
            ... on Order {
                lines {
                    customFields {
                        inscription
                    }
                }
            }
        }
    }
    ${TEST_ORDER_FRAGMENT}
`;
