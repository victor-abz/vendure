import { expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

const productDetailConfig = {
    newPath: '/products/new',
    pathPrefix: '/products/',
    newTitle: 'New product',
};

// #4478 — Product option groups & variant generation flow
test.describe('product variant generation', () => {
    test.describe.configure({ mode: 'serial' });

    let productId: string;

    test('should create a product for variant testing', async ({ page }) => {
        const detail = new BaseDetailPage(page, productDetailConfig);
        await detail.gotoNew();
        await detail.expectNewPageLoaded();
        await detail.fillFields([{ label: 'Product name', value: 'E2E Variant Test Product' }]);
        // Wait for slug auto-generation
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
        await detail.clickCreate();
        await detail.expectSuccessToast(/created/i);
        await detail.expectNavigatedToExisting();

        // Extract the product ID from the URL
        const url = page.url();
        const match = url.match(/\/products\/([^/]+)$/);
        expect(match).not.toBeNull();
        productId = (match as RegExpMatchArray)[1];
    });

    test('should add an option group to the product via the sidebar dialog', async ({ page }) => {
        await page.goto(`/products/${productId}`);
        await expect(page.getByRole('heading', { name: 'E2E Variant Test Product' })).toBeVisible();

        // The empty state card should have an inline "Add option group" button
        await expect(page.getByRole('button', { name: 'Add option group' })).toBeVisible();

        // Click the "Add option group" button
        await page.getByRole('button', { name: 'Add option group' }).click();

        // The dialog should open with "Assign existing" and "Create new" tabs
        await expect(page.getByRole('dialog')).toBeVisible();

        // Switch to the "Create new" tab
        await page.getByRole('tab', { name: 'Create new' }).click();

        // Fill in the option group name
        await page.getByPlaceholder('e.g. Size').fill('Size');

        // Add option values by typing and pressing Enter
        const optionInput = page.getByPlaceholder('Enter value and press Enter');
        await optionInput.fill('Small');
        await optionInput.press('Enter');
        await optionInput.fill('Medium');
        await optionInput.press('Enter');
        await optionInput.fill('Large');
        await optionInput.press('Enter');

        // Verify badges appeared for the option values
        await expect(
            page.getByRole('dialog').locator('[data-slot="badge"]', { hasText: 'Small' }),
        ).toBeVisible();
        await expect(
            page.getByRole('dialog').locator('[data-slot="badge"]', { hasText: 'Medium' }),
        ).toBeVisible();
        await expect(
            page.getByRole('dialog').locator('[data-slot="badge"]', { hasText: 'Large' }),
        ).toBeVisible();

        // Save the option group
        await page.getByRole('button', { name: 'Save option group' }).click();

        // Wait for success toast
        await expect(
            page
                .locator('[data-sonner-toast]')
                .filter({ hasText: /created/i })
                .first(),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('should show the generate variants panel after adding an option group', async ({ page }) => {
        await page.goto(`/products/${productId}`);
        await expect(page.getByRole('heading', { name: 'E2E Variant Test Product' })).toBeVisible();

        // The "Product variants" block should now show the GenerateVariantsPanel
        // with rows for each option value (Small, Medium, Large)
        await expect(page.getByText('Product variants', { exact: true })).toBeVisible();
        await expect(page.locator('table')).toBeVisible();

        // Each variant row should have a SKU input
        const skuInputs = page.locator('table input[placeholder="SKU"]');
        await expect(skuInputs).toHaveCount(3);
    });

    test('should generate variants by filling in the form and submitting', async ({ page }) => {
        await page.goto(`/products/${productId}`);
        await expect(page.getByRole('heading', { name: 'E2E Variant Test Product' })).toBeVisible();

        // Fill in SKU and stock for each variant row
        const skuInputs = page.locator('table input[placeholder="SKU"]');
        await skuInputs.nth(0).fill('EVTP-SM');
        await skuInputs.nth(1).fill('EVTP-MD');
        await skuInputs.nth(2).fill('EVTP-LG');

        const stockInputs = page.locator('table input[type="number"]');
        await stockInputs.nth(0).fill('10');
        await stockInputs.nth(1).fill('10');
        await stockInputs.nth(2).fill('10');

        // Click "Create 3 variants"
        await page.getByRole('button', { name: /Create 3 variants/i }).click();

        // Wait for success toast
        await expect(
            page
                .locator('[data-sonner-toast]')
                .filter({ hasText: /created/i })
                .first(),
        ).toBeVisible({ timeout: 10_000 });
    });

    test('should show variants in the product variants table after generation', async ({ page }) => {
        await page.goto(`/products/${productId}`);
        await expect(page.getByRole('heading', { name: 'E2E Variant Test Product' })).toBeVisible();

        // The variants table should now show the generated variants (may need scrolling)
        // Variant names follow the pattern: "ProductName OptionName"
        const variantLink = page.getByRole('link', { name: /E2E Variant Test Product Small/i });
        await variantLink.scrollIntoViewIfNeeded();
        await expect(variantLink).toBeVisible({ timeout: 10_000 });

        // Verify multiple variants exist
        await expect(page.getByRole('link', { name: /E2E Variant Test Product Medium/i })).toBeVisible();
        await expect(page.getByRole('link', { name: /E2E Variant Test Product Large/i })).toBeVisible();

        // The "Manage variants" link should be visible
        const manageLink = page.getByRole('link', { name: /Manage variants/i });
        await manageLink.scrollIntoViewIfNeeded();
        await expect(manageLink).toBeVisible();
    });

    // Clean up the test product via the Admin API
    test.afterAll(async ({ browser }) => {
        if (!productId) return;
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(`mutation ($id: ID!) { deleteProduct(id: $id) { result } }`, { id: productId });
        await page.close();
    });
});

// #4478 — Add and delete individual variants on the manage variants page
test.describe('manage product variants', () => {
    test.describe.configure({ mode: 'serial' });

    // Use "Laptop" from seed data — it already has option groups and variants
    let laptopId: string;
    let uniqueOptionId: string;
    let firstGroupId: string;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        // Find the Laptop product and its option groups
        const result = await client.gql(`
            query {
                products(options: { filter: { name: { eq: "Laptop" } }, take: 1 }) {
                    items {
                        id
                        optionGroups {
                            id
                            code
                            options { id code name }
                        }
                    }
                }
            }
        `);
        laptopId = result.products.items[0].id;
        firstGroupId = result.products.items[0].optionGroups[0].id;

        // Create a unique option in the first group so we have a guaranteed non-duplicate combo
        const optionResult = await client.gql(
            `mutation ($input: CreateProductOptionInput!) {
                createProductOption(input: $input) { id code name }
            }`,
            {
                input: {
                    productOptionGroupId: firstGroupId,
                    code: 'e2e-unique-test',
                    translations: [{ languageCode: 'en', name: 'E2E Unique Test' }],
                },
            },
        );
        uniqueOptionId = optionResult.createProductOption.id;
        await page.close();
    });

    test('should display the manage variants page with existing variants', async ({ page }) => {
        await page.goto(`/products/${laptopId}/variants`);

        // Wait for the page to load
        await expect(page.getByRole('heading', { name: /Manage variants/i })).toBeVisible();

        // The option groups section should show the existing groups (scoped to main to avoid breadcrumb match)
        await expect(page.getByRole('main').getByText('Option Groups')).toBeVisible();

        // The variants table should show existing variants
        const table = page.locator('table');
        await expect(table).toBeVisible();
        const rows = table.locator('tbody tr');
        await expect(rows.first()).toBeVisible();
    });

    test('should delete a variant using the confirmation dialog', async ({ page }) => {
        await page.goto(`/products/${laptopId}/variants`);
        await expect(page.getByRole('heading', { name: /Manage variants/i })).toBeVisible();

        // Count initial variants
        const table = page.locator('table');
        await expect(table).toBeVisible();
        const initialRowCount = await table.locator('tbody tr').count();

        // Click the delete button (trash icon) on the last variant row
        const lastRow = table.locator('tbody tr').last();
        await lastRow
            .getByRole('button')
            .filter({
                has: page.locator('svg.text-destructive'),
            })
            .click();

        // The confirmation dialog should appear (AlertDialog, not native window.confirm)
        const alertDialog = page.locator('[role="alertdialog"]');
        await expect(alertDialog).toBeVisible();
        await expect(alertDialog.getByText('Delete variant')).toBeVisible();
        await expect(alertDialog.getByText('Are you sure you want to delete this variant?')).toBeVisible();

        // Confirm the deletion
        await alertDialog.getByRole('button', { name: 'Continue' }).click();

        // Wait for success toast
        await expect(
            page
                .locator('[data-sonner-toast]')
                .filter({ hasText: /deleted/i })
                .first(),
        ).toBeVisible({ timeout: 10_000 });

        // Verify one fewer row in the table
        await expect(table.locator('tbody tr')).toHaveCount(initialRowCount - 1);
    });

    test('should add a new variant via the Add variant dialog', async ({ page }) => {
        await page.goto(`/products/${laptopId}/variants`);
        await expect(page.getByRole('heading', { name: /Manage variants/i })).toBeVisible();

        const initialRowCount = await page.locator('table tbody tr').count();

        // Click "Add variant" button
        await page.getByRole('button', { name: 'Add variant' }).click();

        // The dialog should open
        const dialog = page.getByRole('dialog');
        await expect(dialog).toBeVisible();

        // Select an option for each option group using the combobox selectors.
        // For the first group, select our unique option ("E2E Unique Test") created in beforeAll.
        // For the remaining groups, select the first available option.
        const comboboxes = dialog.getByRole('combobox');
        const comboboxCount = await comboboxes.count();

        for (let i = 0; i < comboboxCount; i++) {
            await comboboxes.nth(i).click();
            if (i === 0) {
                // Select our unique option that's guaranteed not to be a duplicate
                await page.getByRole('option', { name: 'E2E Unique Test' }).click();
            } else {
                await page.getByRole('option').first().click();
            }
        }

        // Fill in the SKU
        const skuInput = dialog
            .locator('[data-slot="form-item"]')
            .filter({
                has: page.locator('[data-slot="form-label"]').getByText('SKU', { exact: true }),
            })
            .getByRole('textbox');
        await skuInput.fill('E2E-LAPTOP-UNIQUE');

        // Submit the form
        await dialog.getByRole('button', { name: 'Create variant' }).click();

        // Wait for success toast
        await expect(
            page
                .locator('[data-sonner-toast]')
                .filter({ hasText: /created/i })
                .first(),
        ).toBeVisible({ timeout: 10_000 });

        // Verify the new variant appears in the table
        await expect(page.locator('table tbody tr')).toHaveCount(initialRowCount + 1);
    });

    // Clean up the unique test option
    test.afterAll(async ({ browser }) => {
        if (!uniqueOptionId) return;
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(`mutation ($id: ID!) { deleteProductOption(id: $id) { result } }`, {
            id: uniqueOptionId,
        });
        await page.close();
    });
});
