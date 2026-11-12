import { expect } from '@playwright/test';
import { test, variant } from '../../../utils.js';

/** @typedef {import('@playwright/test').Frame} Frame */

test.describe.configure({ mode: 'parallel' });

/** @param {Frame} frame @param {Record<string, unknown>} result */
async function expect_form(frame, result) {
	await expect
		.poll(async () => JSON.parse((await frame.getByTestId('form-prop').textContent()) || 'null'))
		.toEqual(result);
	await expect
		.poll(async () => JSON.parse((await frame.getByTestId('form-state').textContent()) || 'null'))
		.toEqual(result);
}

test.describe('inline enhanced forms', () => {
	test.skip(variant !== 'memory', 'Requires the inline output variant');
	test.beforeEach(({ javaScriptEnabled }) => {
		test.skip(!javaScriptEnabled, 'The HTTP host inserts iframe documents with JavaScript');
	});

	for (const transport of ['srcdoc', 'blank']) {
		test.describe(transport, () => {
			/** @param {import('@playwright/test').Page} page @param {string} mode */
			async function mount(page, mode) {
				await page.goto(`/app/memory?transport=${transport}&forms=${mode}`);
				await expect(page.getByTestId('host-status')).toHaveText('ready');
				const frame = /** @type {Frame} */ (page.frame({ name: 'memory-1' }));
				await expect(frame.getByTestId('runtime')).toHaveText('browser');
				await expect(frame.locator('body')).toHaveClass('started');
				await expect(frame.getByTestId('route-id')).toHaveText(`/memory/forms/${mode}`);
				return frame;
			}

			/** @param {Frame} frame */
			async function expect_document(frame) {
				const href = transport === 'blank' ? 'about:blank' : 'about:srcdoc';
				expect(frame.url()).toBe(href);
				expect(await frame.evaluate(() => location.href)).toBe(href);
			}

			test('submits absent and empty actions to the logical current page', async ({ page }) => {
				const frame = await mount(page, 'default');
				await frame.getByTestId('implicit-action').click();
				await expect_form(frame, {
					action: 'default',
					pathname: '/app/memory/forms/default',
					value: 'implicit'
				});
				await frame.getByTestId('empty-action').click();
				await expect_form(frame, {
					action: 'default',
					pathname: '/app/memory/forms/default',
					value: 'empty'
				});
				await expect(frame.getByTestId('status')).toHaveText('200');
				await expect(frame.getByTestId('route-id')).toHaveText('/memory/forms/default');
				await expect_document(frame);
			});

			test('resolves named actions and submitter overrides against the source document base', async ({
				page
			}) => {
				const frame = await mount(page, 'named');
				await frame.getByTestId('named-action').click();
				await expect_form(frame, {
					action: 'save',
					pathname: '/app/memory/forms/named',
					value: 'named'
				});
				await frame.getByTestId('submitter-action').click();
				await expect_form(frame, {
					action: 'other',
					pathname: '/app/memory/forms/named',
					value: 'named',
					submitter: 'button'
				});
				await expect(frame.getByTestId('status')).toHaveText('200');
				await expect(frame.getByTestId('route-id')).toHaveText('/memory/forms/named');
				await expect_document(frame);
			});

			for (const outcome of ['success', 'failure']) {
				test(`navigates internally for cross-page action ${outcome}`, async ({ page }) => {
					const frame = await mount(page, 'default');
					await frame.getByTestId(`cross-${outcome}`).click();
					await expect(frame.getByTestId('route-id')).toHaveText('/memory/forms/named');
					await expect_form(frame, {
						action: outcome === 'success' ? 'save' : 'reject',
						pathname: '/app/memory/forms/named',
						value: 'cross-page'
					});
					await expect(frame.getByTestId('status')).toHaveText(
						outcome === 'success' ? '200' : '422'
					);
					await expect(frame.getByTestId('page-url')).toContainText('/app/memory/forms/named');
					await expect_document(frame);
					await frame.evaluate(() => history.back());
					await expect(frame.getByTestId('route-id')).toHaveText('/memory/forms/default');
				});
			}

			test('follows an enhanced action redirect without native navigation', async ({ page }) => {
				const frame = await mount(page, 'named');
				await frame.getByTestId('redirect-action').click();
				await expect(frame.getByTestId('load-slug')).toHaveText('from-action');
				await expect(frame.getByTestId('route-id')).toHaveText('/memory/route/[slug]');
				await expect_document(frame);
			});
		});
	}
});
