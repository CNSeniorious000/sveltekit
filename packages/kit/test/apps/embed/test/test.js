import { expect } from '@playwright/test';
import { test, variant } from '../../../utils.js';

/** @typedef {import('@playwright/test').Response} Response */

test.describe.configure({ mode: 'parallel' });

test.describe('embed', () => {
	test.skip(variant === 'memory', 'The inline variant has a separate iframe host');
	test('serves embedded components in page', async ({ page, javaScriptEnabled }) => {
		await page.goto('/embed');

		if (javaScriptEnabled) {
			await expect(page.getByTestId('a')).toHaveText('a (browser)');
			await expect(page.getByTestId('b')).toHaveText('b (browser)');
		} else {
			expect(await page.textContent('[data-testid="a"]')).toBe('a (server)');
			expect(await page.textContent('[data-testid="b"]')).toBe('b (server)');
		}
	});
});
