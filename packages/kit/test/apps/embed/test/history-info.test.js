import { expect } from '@playwright/test';
import { test, variant } from '../../../utils.js';

test('shallow history survives reload without session storage', async ({ page }) => {
	test.skip(variant !== 'memory');
	/** @type {string[]} */
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	// Isolate missing persisted metadata from native opaque-document reload limitations.
	await page.addInitScript(() => {
		Object.defineProperty(window, 'sessionStorage', {
			get() {
				throw new DOMException('Storage is unavailable', 'SecurityError');
			}
		});
	});
	await page.goto('/app/memory/simple/alpha');
	await expect(page.getByTestId('runtime')).toHaveText('browser');
	await expect(page.locator('body')).toHaveClass('started');
	await page.getByTestId('push-one').click();
	await page.getByTestId('push-two').click();
	await expect(page.getByTestId('state')).toHaveText('{"modal":"two"}');
	const before = await page.evaluate(() => performance.timeOrigin);
	await page.reload();
	expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(before);
	await expect(page.locator('body')).toHaveClass('started');
	await expect(page.getByTestId('state')).toHaveText('{"modal":"two"}');
	await page.getByTestId('history-back').click();
	await expect(page.getByTestId('state')).toHaveText('{"modal":"one"}');
	await page.getByTestId('history-forward').click();
	await expect(page.getByTestId('state')).toHaveText('{"modal":"two"}');
	expect(errors).toEqual([]);
});
