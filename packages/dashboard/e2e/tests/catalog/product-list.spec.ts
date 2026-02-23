import { expect, test } from '@playwright/test';

import { BaseListPage } from '../../page-objects/list-page.base.js';

test.describe('Product List', () => {
    const listPage = (page: import('@playwright/test').Page) =>
        new BaseListPage(page, {
            path: '/products',
            title: 'Products',
            newButtonLabel: 'New Product',
        });

    test('should display the product list page', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();
    });

    test('should show products in the table', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        const rows = lp.getRows();
        await expect(rows.first()).toBeVisible();
        expect(await rows.count()).toBeGreaterThan(0);
    });

    test('should navigate to product detail when clicking a product', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        // Click the first product link in the table
        const firstProductLink = lp.getRows().first().getByRole('link').first();
        await firstProductLink.click();

        await expect(page).toHaveURL(/\/products\/.+/);
    });

    test('should display "New Product" button', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        await expect(lp.newButton).toBeVisible();
    });

    // #4393 — product list should default to sorting by updatedAt descending
    test('should apply descending updatedAt sort by default', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        const url = new URL(page.url());
        const sort = url.searchParams.get('sort');
        expect(sort).toContain('-updatedAt');
    });

    // #4393 — Reset button should be visible (outside scroll area) in column settings
    test('should show the Reset button in the column settings dropdown', async ({ page }) => {
        const lp = listPage(page);
        await lp.goto();
        await lp.expectLoaded();

        // The column settings trigger is the gear icon (Settings2) in the data table toolbar.
        // We exclude sidebar buttons (which also use Settings2) via :not([data-sidebar]).
        const columnSettingsTrigger = page.locator('button:not([data-sidebar])').filter({
            has: page.locator('svg.lucide-settings2'),
        });
        await columnSettingsTrigger.click();

        const dropdownContent = page.locator('[data-slot="dropdown-menu-content"]');
        await expect(dropdownContent).toBeVisible();

        const resetItem = page.getByRole('menuitem', { name: 'Reset' });
        await expect(resetItem).toBeVisible();
    });
});
