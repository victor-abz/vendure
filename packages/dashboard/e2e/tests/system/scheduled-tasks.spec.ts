import { expect, test } from '@playwright/test';

// Scheduled Tasks page displays a DataTable of registered scheduled tasks
// with their schedule, execution status, and action controls.

test.describe('Scheduled Tasks', () => {
    test('should display the scheduled tasks page', async ({ page }) => {
        await page.goto('/scheduled-tasks');
        await expect(page.getByTestId('page-heading')).toBeVisible();
    });

    test('should show the data table', async ({ page }) => {
        await page.goto('/scheduled-tasks');
        await expect(page.getByTestId('page-heading')).toBeVisible();
        await expect(page.getByRole('table')).toBeVisible();
    });
});
