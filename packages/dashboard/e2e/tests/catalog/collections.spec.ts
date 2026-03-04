import { type Page, expect, test } from '@playwright/test';

import { BaseDetailPage } from '../../page-objects/detail-page.base.js';
import { createCrudTestSuite } from '../../utils/crud-test-factory.js';
import { VendureAdminClient } from '../../utils/vendure-admin-client.js';

createCrudTestSuite({
    entityName: 'collection',
    entityNamePlural: 'collections',
    listPath: '/collections',
    listTitle: 'Collections',
    newButtonLabel: 'New Collection',
    newPageTitle: 'New collection',
    createFields: [{ label: 'Name', value: 'E2E Test Collection' }],
    afterFillCreate: async (_page, detail) => {
        await expect(detail.formItem('Slug').getByRole('textbox')).not.toHaveValue('', { timeout: 5_000 });
    },
});

// #4389 — After 3.5.4, collections with filters are not noticed as changed when
// editing name or description, because the combineWithAnd arg (added in 3.5.4) is
// required with a defaultValue, but legacy collections don't have it stored. The
// validity check in ConfigurableOperationInput treated it as permanently invalid,
// keeping the Update button disabled via the filtersArgsValid gate.
test.describe('Issue #4389: Collection form dirty state with filters', () => {
    test.describe.configure({ mode: 'serial' });

    let collectionId: string;

    const detailPage = (page: Page) =>
        new BaseDetailPage(page, {
            newPath: '/collections/new',
            pathPrefix: '/collections/',
            newTitle: 'New collection',
        });

    // Create a collection with a facet-value-filter that deliberately omits the
    // combineWithAnd arg — this simulates legacy collections created before 3.5.4
    // added that argument, which is the root cause of #4389.
    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();

        // Get a facet value ID to use in the filter
        const { facetValues } = await client.gql(`
            query { facetValues(options: { take: 1 }) { items { id name } } }
        `);
        const facetValueId = facetValues.items[0].id as string;

        // Create collection with filter — note: combineWithAnd is intentionally
        // omitted to reproduce the legacy-data bug
        const { createCollection } = await client.gql(
            `
            mutation ($input: CreateCollectionInput!) {
                createCollection(input: $input) { id }
            }
        `,
            {
                input: {
                    translations: [
                        {
                            languageCode: 'en',
                            name: 'E2E Filter Test',
                            slug: 'e2e-filter-test',
                            description: '',
                        },
                    ],
                    filters: [
                        {
                            code: 'facet-value-filter',
                            arguments: [
                                { name: 'facetValueIds', value: `["${facetValueId}"]` },
                                { name: 'containsAny', value: 'false' },
                            ],
                        },
                    ],
                },
            },
        );
        collectionId = createCollection.id;
        await page.close();
    });

    test.afterAll(async ({ browser }) => {
        if (!collectionId) return;
        const page = await browser.newPage();
        const client = new VendureAdminClient(page);
        await client.login();
        await client.gql(
            `
            mutation ($id: ID!) { deleteCollection(id: $id) { result } }
        `,
            { id: collectionId },
        );
        await page.close();
    });

    async function goToCollection(page: Page) {
        await page.goto(`/collections/${collectionId}`);
        // Wait for the filter card to render — confirms the detail page loaded
        await expect(page.getByText('facet-value-filter')).toBeVisible({ timeout: 10_000 });
    }

    test('should enable Update button when editing the Name field', async ({ page }) => {
        await goToCollection(page);
        const dp = detailPage(page);

        // Update button should be disabled initially
        await expect(dp.updateButton).toBeDisabled();

        // Edit the name
        await dp.fillInput('Name', 'E2E Filter Test Updated');

        // Update button should now be enabled
        await expect(dp.updateButton).toBeEnabled({ timeout: 5_000 });
    });

    test('should enable Update button when editing the Description field', async ({ page }) => {
        await goToCollection(page);
        const dp = detailPage(page);

        await expect(dp.updateButton).toBeDisabled();

        // The description is a TipTap rich text editor (contenteditable),
        // not a regular input. Click the editor area and type.
        const editor = page.locator('.rich-text-editor');
        await editor.click();
        await page.keyboard.type('A test description');

        // Click elsewhere to blur and trigger change detection
        await page.getByText('Filters').first().click();

        await expect(dp.updateButton).toBeEnabled({ timeout: 5_000 });
    });

    test('should persist changes after saving', async ({ page }) => {
        await goToCollection(page);
        const dp = detailPage(page);

        await expect(dp.updateButton).toBeDisabled();

        // Edit the name
        await dp.fillInput('Name', 'E2E Filter Test Saved');
        await expect(dp.updateButton).toBeEnabled({ timeout: 5_000 });

        // Save
        await dp.clickUpdate();
        await dp.expectSuccessToast(/updated/i);

        // Reload and verify the change persisted
        await page.reload();
        await expect(page.getByText('facet-value-filter')).toBeVisible({ timeout: 10_000 });
        await expect(dp.formItem('Name').getByRole('textbox')).toHaveValue('E2E Filter Test Saved');
    });
});
