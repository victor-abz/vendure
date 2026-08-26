import { expect, test } from '@playwright/test';

import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

// Regression: entity selector dropdowns must reflect newly created entities
// without a full page reload.
//
// The shared selector components (ZoneSelector, TaxCategorySelector, etc.)
// used to set a multi-minute `staleTime` on their list queries. The dashboard's
// global QueryClient defaults to `staleTime: 0` (refetch-on-mount), so removing
// those opt-ins is what makes the dropdowns pick up fresh data when a detail
// page mounts. This test covers the whole class via the Zone selector on the Tax
// Rate page (see #5177, #5182).
//
// It navigates entirely client-side (TanStack Router <Link>s in the sidebar)
// after a single initial load, so the in-memory QueryClient — and therefore the
// cached ['zones'] result — persists across page changes. A `page.goto()` or
// `page.reload()` would spin up a fresh QueryClient and mask the very bug under
// test, so there are deliberately none between priming the cache and the final
// assertion.
test.describe('Entity selectors refetch after mutation', () => {
    test.describe.configure({ mode: 'serial' });

    const uniqueZoneName = `E2E Selector Zone ${Date.now()}`;
    let zoneId = '';

    // Runs even if the test body throws, so the created zone never leaks into
    // subsequent runs (the e2e seed data is cached).
    test.afterEach(async ({ page }) => {
        if (!zoneId) return;
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(`mutation ($id: ID!) { deleteZone(id: $id) { result } }`, { id: zoneId });
        zoneId = '';
    });

    // #5177, #5182 — a newly created zone must appear in the Tax Rate page's
    // zone selector without a page reload (the class of selector-staleness bug).
    test('zone selector on the tax rate page shows a newly created zone without reload', async ({
        page,
    }) => {
        test.setTimeout(30_000);

        const sidebar = page.locator('[data-slot="sidebar"]');
        const gotoViaSidebar = (name: string) =>
            sidebar.getByRole('link', { name, exact: true }).click();

        const openTaxRateZoneDropdown = async () => {
            await gotoViaSidebar('Tax Rates');
            await page.getByRole('button', { name: 'New Tax Rate' }).click();
            await expect(page).toHaveURL(/\/tax-rates\/new$/);
            const zoneField = page.locator('[data-slot="field"]').filter({
                has: page.locator('[data-slot="field-label"]').getByText('Zone', { exact: true }),
            });
            await zoneField.getByRole('combobox').click();
        };

        // Initial (and only) full load. Everything after this is client-side, so
        // the QueryClient stays alive.
        await page.goto('/tax-rates');
        await expect(page.getByTestId('page-heading')).toBeVisible({ timeout: 10_000 });

        // Prime the ['zones'] cache and confirm the zone does not exist yet.
        await openTaxRateZoneDropdown();
        await expect(page.getByRole('option').first()).toBeVisible();
        await expect(page.getByRole('option', { name: uniqueZoneName })).toHaveCount(0);
        await page.keyboard.press('Escape');

        // Create the new zone, navigating client-side via the sidebar.
        await gotoViaSidebar('Zones');
        await page.getByRole('button', { name: 'New Zone' }).click();
        await expect(page).toHaveURL(/\/zones\/new$/);
        const nameField = page.locator('[data-slot="field"]').filter({
            has: page.locator('[data-slot="field-label"]').getByText('Name', { exact: true }),
        });
        await nameField.getByRole('textbox').fill(uniqueZoneName);
        await page.getByRole('button', { name: 'Create', exact: true }).click();
        await expect(page.locator('[data-sonner-toast]').filter({ hasText: /created/i })).toBeVisible({
            timeout: 10_000,
        });

        // Capture the created zone id from the URL for cleanup in afterEach.
        await expect(page).toHaveURL(/\/zones\/(?!new$)[^/]+$/);
        zoneId = new URL(page.url()).pathname.split('/').pop() ?? '';

        // Re-open the Tax Rate page (client-side). ZoneSelector remounts and,
        // with the staleTime opt-in removed, refetches ['zones'] — so the new
        // zone appears without any reload.
        await openTaxRateZoneDropdown();
        await expect(page.getByRole('option', { name: uniqueZoneName })).toBeVisible({
            timeout: 10_000,
        });
        await page.keyboard.press('Escape');
    });
});
