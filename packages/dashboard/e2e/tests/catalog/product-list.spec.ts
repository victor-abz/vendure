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

    // #4408 — Facet value filter on product list
    test.describe('Facet value filter', () => {
        test('should display facets in browse mode and filter products by facet value', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            // Click the "Facet values" filter button in the toolbar
            const facetFilterButton = page.getByRole('button', { name: 'Facet values' });
            await expect(facetFilterButton).toBeVisible();
            await facetFilterButton.click();

            // The popover should open showing facets in browse mode
            const popover = page.locator('[data-slot="popover-content"]');
            await expect(popover).toBeVisible();
            await expect(popover.getByText('Facets')).toBeVisible();

            // Should show the "category" facet
            const categoryItem = popover.getByRole('option', { name: 'category' });
            await expect(categoryItem).toBeVisible();

            // Click into the "category" facet to see its values
            await categoryItem.click();

            // Should show the back button and facet values
            await expect(popover.getByRole('option', { name: 'Back' })).toBeVisible();

            // Select "photo" facet value
            const photoItem = popover.getByRole('option', { name: 'photo' });
            await expect(photoItem).toBeVisible();
            await photoItem.click();

            // Wait for the filtered results to load
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // Close the popover by pressing Escape
            await page.keyboard.press('Escape');

            // Should show exactly the 4 products with the "photo" facet value
            await lp.expectRowCount(4);
            const expectedProducts = ['Camera Lens', 'Instant Camera', 'Slr Camera', 'Tripod'];
            for (const name of expectedProducts) {
                await expect(lp.getRows().filter({ hasText: name })).toHaveCount(1);
            }

            // The filter button should now show the selected facet value label
            await expect(facetFilterButton).toContainText('photo');
        });

        test('should persist facet value names after page reload', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            // Open facet filter and select a value
            const facetFilterButton = page.getByRole('button', { name: 'Facet values' });
            await facetFilterButton.click();

            const popover = page.locator('[data-slot="popover-content"]');
            await expect(popover).toBeVisible();

            // Drill into "category" facet
            await popover.getByRole('option', { name: 'category' }).click();
            await expect(popover.getByRole('option', { name: 'Back' })).toBeVisible();

            // Select "electronics"
            await popover.getByRole('option', { name: 'electronics' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);
            await page.keyboard.press('Escape');

            // Verify the badge shows the name, not an ID
            await expect(facetFilterButton).toContainText('electronics');

            // Reload the page
            await page.reload();
            await lp.expectLoaded();

            // After reload, the filter button should still show the facet value name
            const reloadedButton = page.getByRole('button', { name: /Facet values/ });
            await expect(reloadedButton).toContainText('electronics');
            // Ensure it does NOT show a numeric ID instead of the name
            await expect(reloadedButton).not.toContainText(/^\d+$/);
        });

        test('should clear facet value filter', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            const initialRowCount = await lp.getRows().count();

            // Open facet filter and select a value
            const facetFilterButton = page.getByRole('button', { name: 'Facet values' });
            await facetFilterButton.click();

            const popover = page.locator('[data-slot="popover-content"]');
            await popover.getByRole('option', { name: 'category' }).click();
            await popover.getByRole('option', { name: 'electronics' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // Close and reopen to access "Clear filters"
            await page.keyboard.press('Escape');

            // Reopen the filter
            await facetFilterButton.click();
            await expect(popover).toBeVisible();

            // Click "Clear filters"
            await popover.getByRole('option', { name: 'Clear filters' }).click();
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // The list should now show all products again
            await expect(lp.getRows()).toHaveCount(initialRowCount);
        });

        test('should search facet values by name', async ({ page }) => {
            const lp = listPage(page);
            await lp.goto();
            await lp.expectLoaded();

            // Open the facet filter
            const facetFilterButton = page.getByRole('button', { name: 'Facet values' });
            await facetFilterButton.click();

            const popover = page.locator('[data-slot="popover-content"]');
            await expect(popover).toBeVisible();

            // Type in the search box
            const searchInput = popover.getByPlaceholder('Search facet values...');
            await searchInput.fill('electr');

            // Wait for search results
            await page.waitForResponse(resp => resp.url().includes('/admin-api') && resp.status() === 200);

            // Should show "electronics" in the search results
            await expect(popover.getByRole('option', { name: 'electronics' })).toBeVisible();
        });
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
