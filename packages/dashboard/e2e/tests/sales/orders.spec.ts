import { type Page, expect, test } from '@playwright/test';

import { VENDURE_PORT } from '../../constants.js';
import { BaseListPage } from '../../page-objects/list-page.base.js';

// Orders use a multi-step draft flow rather than a single CRUD form.
// Each action (set customer, add line, set address, set shipping) is an
// individual mutation — there's no "Create" button. The "Complete draft"
// button finalizes the order once all requirements are met.

test.describe('Orders', () => {
    test.describe.configure({ mode: 'serial' });

    const listPage = (page: Page) =>
        new BaseListPage(page, {
            path: '/orders',
            title: 'Orders',
            newButtonLabel: 'Draft order',
            newButtonRole: 'button',
        });

    test('should display the orders list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    test('should show "Draft order" button', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await expect(lp.newButton).toBeVisible();
    });

    test('should create, configure, and complete a draft order', async ({ page }) => {
        test.setTimeout(60_000); // Draft order flow involves multiple mutations

        // Step 1: Create a draft order from the list page
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.newButton.click();
        await expect(page).toHaveURL(/\/orders\/draft\//, { timeout: 10_000 });

        // Step 2: Set a customer — CustomerSelector uses Command/Popover
        await page.getByRole('button', { name: /Select customer/i }).click();
        await page.getByPlaceholder('Search customers...').fill('hayden');
        // CommandItems have role="option"; wait for search results to load
        await expect(page.getByRole('option').first()).toBeVisible({ timeout: 5_000 });
        await page.getByRole('option').first().click();
        // Wait for the set-customer mutation to complete and re-render
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Step 3: Add a product variant — ProductVariantSelector uses Command/Popover
        // The button has role="combobox" but no aria-label, so we match by role + text content
        const addItemButton = page.locator('[role="combobox"]').filter({ hasText: 'Add item to order' });
        await addItemButton.scrollIntoViewIfNeeded();
        await addItemButton.click();
        await page.getByPlaceholder('Add item to order...').fill('laptop');
        await expect(page.getByRole('option').first()).toBeVisible({ timeout: 5_000 });
        await page.getByRole('option').first().click();
        // Wait for add-line mutation — the combobox should close
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Step 4: Set shipping address — CustomerAddressSelector uses Popover with Card elements
        // There are two "Select address" buttons (shipping + billing); target the first one
        await page
            .getByRole('button', { name: /Select address/i })
            .first()
            .click();
        // Address cards are plain divs in the popover — click the first one
        await page.locator('[data-slot="popover-content"]').locator('[data-slot="card"]').first().click();
        // Wait for set-address mutation
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Step 5: Select a shipping method — inline cards (not a popover)
        // Shipping methods appear after address is set; wait for them
        // Use exact text match to avoid ambiguity with the outer wrapper card
        const shippingLabel = page.getByText('Standard Shipping', { exact: true });
        await shippingLabel.scrollIntoViewIfNeeded();
        await expect(shippingLabel).toBeVisible({ timeout: 5_000 });
        await shippingLabel.click();
        // Wait for set-shipping-method mutation
        await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

        // Step 6: Complete the draft order
        const completeDraftButton = page.getByRole('button', { name: /Complete draft/i });
        await completeDraftButton.scrollIntoViewIfNeeded();
        await expect(completeDraftButton).toBeEnabled({ timeout: 5_000 });
        await completeDraftButton.click();
        // After completion, navigates to the regular order detail page
        await expect(page).toHaveURL(/\/orders\/[^/]+$/, { timeout: 10_000 });
        await expect(page).not.toHaveURL(/\/draft\//);
    });

    test('should show the completed order in the list', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.expectRowCountGreaterThan(0);
    });

    test('should create and delete a draft order', async ({ page }) => {
        // Create a new draft
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
        await lp.newButton.click();
        await expect(page).toHaveURL(/\/orders\/draft\//, { timeout: 10_000 });

        // Delete the draft without configuring it
        await page.getByRole('button', { name: /Delete draft/i }).click();
        // Confirm the deletion dialog — AlertDialog uses "Continue" as the action button
        await page.locator('[role="alertdialog"]').getByRole('button', { name: 'Continue' }).click();
        // Should navigate back to the orders list (URL may include query params)
        await expect(page).not.toHaveURL(/\/draft\//, { timeout: 15_000 });
        await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible();
    });

    // #4393 — custom order history entry types should be displayed with key-value data
    test('should display custom order history entry types', async ({ page }) => {
        test.setTimeout(60_000);

        const client = new VendureAdminClient(page);
        await client.login();
        const orderId = await createPaidOrder(client);

        await client.gql(
            `mutation ($orderId: ID!, $message: String!) {
                addCustomOrderHistoryEntry(orderId: $orderId, message: $message) { id }
            }`,
            { orderId, message: 'Hello from a custom plugin' },
        );

        await page.goto(`/orders/${orderId}`);
        // Wait for the order detail page to load
        await expect(page.getByRole('button', { name: /Fulfill order/i })).toBeVisible({ timeout: 10_000 });

        // Scroll down to the Order history section (CardTitle is a div, not a heading)
        const historyTitle = page.locator('[data-slot="card-title"]').filter({ hasText: 'Order history' });
        await historyTitle.scrollIntoViewIfNeeded();
        await expect(historyTitle).toBeVisible();

        // The fallback renderer displays the entry type as a humanised title
        // and renders the data as key-value pairs
        await expect(page.getByText('custom type')).toBeVisible({ timeout: 5_000 });
        await expect(page.getByText('message:')).toBeVisible();
        await expect(page.getByText('Hello from a custom plugin')).toBeVisible();
    });

    // #4393 — order modify page should show a "Recalculate shipping" checkbox
    test('should show recalculate shipping checkbox on modify page', async ({ page }) => {
        test.setTimeout(60_000);

        const orderId = await createModifyingOrder(page);

        await page.goto(`/orders/${orderId}/modify`);
        await expect(page.getByRole('heading', { name: 'Modify order' })).toBeVisible({ timeout: 10_000 });

        // Checkbox should be visible but disabled when no modifications made
        const recalculateCheckbox = page.getByRole('checkbox', { name: /Recalculate shipping/i });
        await expect(recalculateCheckbox).toBeVisible();
        await expect(recalculateCheckbox).toBeChecked();
        await expect(recalculateCheckbox).toBeDisabled();

        // Make a modification (change quantity) to enable the checkbox
        const quantityInput = page.locator('input[type="number"]').first();
        await quantityInput.fill('2');

        await expect(recalculateCheckbox).toBeEnabled();
        await expect(recalculateCheckbox).toBeChecked();

        // Should be togglable
        await recalculateCheckbox.click();
        await expect(recalculateCheckbox).not.toBeChecked();
        await recalculateCheckbox.click();
        await expect(recalculateCheckbox).toBeChecked();
    });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_API = `http://localhost:${VENDURE_PORT}/admin-api`;

/** Thin wrapper around Playwright's request API with Vendure bearer-token auth. */
class VendureAdminClient {
    private authToken: string | null = null;
    constructor(private page: Page) {}

    async login(username = 'superadmin', password = 'superadmin') {
        const response = await this.page.request.post(ADMIN_API, {
            data: {
                query: `mutation ($u: String!, $p: String!) {
                    login(username: $u, password: $p) {
                        ... on CurrentUser { id }
                        ... on ErrorResult { errorCode message }
                    }
                }`,
                variables: { u: username, p: password },
            },
        });
        this.authToken = response.headers()['vendure-auth-token'] ?? null;
        const json = await response.json();
        if (json.errors?.length) {
            throw new Error(`Login failed: ${String(json.errors[0].message)}`);
        }
    }

    async gql(query: string, variables?: Record<string, unknown>) {
        if (!this.authToken) throw new Error('Call login() first');
        const response = await this.page.request.post(ADMIN_API, {
            headers: { Authorization: `Bearer ${this.authToken}` },
            data: { query, variables },
        });
        const newToken = response.headers()['vendure-auth-token'];
        if (newToken) this.authToken = newToken;
        const json = await response.json();
        if (json.errors?.length) {
            throw new Error(`GraphQL error: ${String(json.errors[0].message)}`);
        }
        return json.data;
    }
}

/**
 * Creates a payment method (idempotent), builds a fully-paid order via the
 * Admin API, and returns the order ID in "PaymentSettled" state.
 */
async function createPaidOrder(client: VendureAdminClient): Promise<string> {
    // Ensure a payment method exists
    const { paymentMethods } = await client.gql(`query { paymentMethods { items { id } } }`);
    if (paymentMethods.items.length === 0) {
        await client.gql(`
            mutation {
                createPaymentMethod(input: {
                    code: "test-payment"
                    enabled: true
                    handler: {
                        code: "dummy-payment-handler",
                        arguments: [{ name: "automaticSettle", value: "true" }]
                    }
                    translations: [{ languageCode: en, name: "Test Payment", description: "" }]
                }) { id }
            }
        `);
    }

    const { createDraftOrder } = await client.gql(`mutation { createDraftOrder { id } }`);
    const orderId: string = createDraftOrder.id;

    const { customers } = await client.gql(`query { customers(options: { take: 1 }) { items { id } } }`);
    await client.gql(
        `
        mutation ($orderId: ID!, $customerId: ID!) {
            setCustomerForDraftOrder(orderId: $orderId, customerId: $customerId) {
                ... on Order { id } ... on ErrorResult { errorCode message }
            }
        }
    `,
        { orderId, customerId: customers.items[0].id },
    );

    const { productVariants } = await client.gql(
        `query { productVariants(options: { take: 1 }) { items { id } } }`,
    );
    await client.gql(
        `
        mutation ($orderId: ID!, $variantId: ID!) {
            addItemToDraftOrder(orderId: $orderId, input: {
                productVariantId: $variantId, quantity: 1
            }) { ... on Order { id } ... on ErrorResult { errorCode message } }
        }
    `,
        { orderId, variantId: productVariants.items[0].id },
    );

    await client.gql(
        `
        mutation ($orderId: ID!) {
            setDraftOrderShippingAddress(orderId: $orderId, input: {
                fullName: "Test User", streetLine1: "123 Main St",
                city: "London", countryCode: "GB"
            }) { id }
        }
    `,
        { orderId },
    );

    const { eligibleShippingMethodsForDraftOrder: methods } = await client.gql(
        `
        query ($orderId: ID!) {
            eligibleShippingMethodsForDraftOrder(orderId: $orderId) { id }
        }
    `,
        { orderId },
    );
    await client.gql(
        `
        mutation ($orderId: ID!, $methodId: ID!) {
            setDraftOrderShippingMethod(orderId: $orderId, shippingMethodId: $methodId) {
                ... on Order { id } ... on ErrorResult { errorCode message }
            }
        }
    `,
        { orderId, methodId: methods[0].id },
    );

    await client.gql(
        `
        mutation ($id: ID!) {
            transitionOrderToState(id: $id, state: "ArrangingPayment") {
                ... on Order { id state }
                ... on OrderStateTransitionError { errorCode message transitionError }
            }
        }
    `,
        { id: orderId },
    );

    await client.gql(
        `
        mutation ($orderId: ID!) {
            addManualPaymentToOrder(input: {
                orderId: $orderId, method: "test-payment",
                transactionId: "e2e-test-tx-${orderId}", metadata: {}
            }) { ... on Order { id state } ... on ErrorResult { errorCode message } }
        }
    `,
        { orderId },
    );

    return orderId;
}

/**
 * Creates a fully-paid order and transitions it to the "Modifying" state.
 */
async function createModifyingOrder(page: Page): Promise<string> {
    const client = new VendureAdminClient(page);
    await client.login();
    const orderId = await createPaidOrder(client);

    await client.gql(
        `
        mutation ($id: ID!) {
            transitionOrderToState(id: $id, state: "Modifying") {
                ... on Order { id state }
                ... on OrderStateTransitionError { errorCode message transitionError }
            }
        }
    `,
        { id: orderId },
    );

    return orderId;
}
