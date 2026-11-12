import process from 'node:process';
import { expect } from '@playwright/test';
import { test, port, variant } from '../../../utils.js';

test.skip(
	({ javaScriptEnabled }) => !javaScriptEnabled || !!process.env.DEV || variant !== 'inline'
);
test.describe.configure({ mode: 'parallel' });

const origin = `http://localhost:${port}`;

for (const mode of ['srcdoc', 'blank', 'data']) {
	test.describe(`inline hash routing in ${mode}`, () => {
		test('startup, raw links and goto preserve the document instance', async ({ page }) => {
			await page.goto(`${origin}/hash-inline/host.html?mode=${mode}&route=/inline/b`);
			const frame = page.frameLocator('iframe');
			await expect(frame.getByRole('heading', { name: 'Hash page B' })).toBeVisible();
			await expect(frame.locator('[data-document-url]')).toHaveText(
				mode === 'data'
					? /^data:.*#\/inline\/b$/s
					: `about:${mode === 'blank' ? 'blank' : 'srcdoc'}#/inline/b`
			);
			await expect(frame.locator('[data-document-base]')).toHaveText(`${origin}/network/embedded/`);
			const instance = await frame.locator('[data-instance]').textContent();
			const document_url = await frame.locator('[data-document-url]').textContent();
			const url_probe = await frame.locator('html').evaluate(() => {
				const parsed = new URL('#/inline/a', location.href);
				const pathname = new URL(parsed);
				pathname.pathname = pathname.pathname;
				const search = new URL(parsed);
				search.search = search.search;
				return {
					document: location.href,
					parsed: parsed.href,
					pathname: pathname.href,
					search: search.href
				};
			});
			console.log('opaque URL probe', mode, {
				parsed_document_matches:
					url_probe.parsed.split('#')[0] === url_probe.document.split('#')[0],
				pathname_setter_changed: url_probe.pathname !== url_probe.parsed,
				search_setter_changed: url_probe.search !== url_probe.parsed
			});
			await test.info().attach('opaque-url-parser-and-setters', {
				body: JSON.stringify(url_probe, null, 2),
				contentType: 'application/json'
			});

			await frame.getByRole('link', { name: 'Raw hash A', exact: true }).click();
			await expect(frame.getByRole('heading', { name: 'Hash page A' })).toBeVisible();
			await expect(frame.locator('[data-document-url]')).toHaveText(
				document_url?.replace(/#.*$/, '#/inline/a') || ''
			);
			await frame.getByRole('button', { name: 'Hash goto B', exact: true }).click();
			await expect(frame.getByRole('heading', { name: 'Hash page B' })).toBeVisible();
			await expect(frame.locator('[data-instance]')).toHaveText(instance || '');
			await expect(frame.locator('[data-document-url]')).toHaveText(document_url || '');
		});

		test('fragment history supports back and forward', async ({ page }) => {
			// Browsers can discard document-written blank content during history traversal.
			test.skip(mode === 'blank');
			await page.goto(`${origin}/hash-inline/host.html?mode=${mode}&route=/inline/b`);
			const frame = page.frameLocator('iframe');
			await frame.getByRole('link', { name: 'Raw hash A', exact: true }).click();
			await expect(frame.getByRole('heading', { name: 'Hash page A' })).toBeVisible();
			await frame.getByRole('button', { name: 'Hash goto B', exact: true }).click();
			await expect(frame.getByRole('heading', { name: 'Hash page B' })).toBeVisible();
			await frame.getByRole('button', { name: 'Frame back', exact: true }).click();
			await expect(frame.getByRole('heading', { name: 'Hash page A' })).toBeVisible();
			await frame.getByRole('button', { name: 'Frame forward', exact: true }).click();
			await expect(frame.getByRole('heading', { name: 'Hash page B' })).toBeVisible();
		});

		test('reload restarts the app at the current fragment', async ({ page }) => {
			// A document-written about:blank frame has no native source to reload.
			test.skip(mode === 'blank');
			await page.goto(`${origin}/hash-inline/host.html?mode=${mode}`);
			const frame = page.frameLocator('iframe');
			await frame.getByRole('link', { name: 'Raw hash B', exact: true }).click();
			await expect(frame.getByRole('heading', { name: 'Hash page B' })).toBeVisible();
			const instance = await frame.locator('[data-instance]').textContent();
			await frame.getByRole('button', { name: 'Frame reload', exact: true }).click();
			await expect(frame.getByRole('heading', { name: 'Hash page B' })).toBeVisible();
			await expect(frame.locator('[data-instance]')).not.toHaveText(instance || '');
		});

		test('relative load.fetch uses the effective HTTP base, not the hash route', async ({
			page
		}) => {
			await page.goto(`${origin}/hash-inline/host.html?mode=${mode}`);
			const frame = page.frameLocator('iframe');
			await frame.getByRole('link', { name: 'Relative load fetch', exact: true }).click();
			await expect(frame.locator('[data-fetch-status]')).toHaveText('200');
			await expect(frame.locator('[data-fetch-result]')).toHaveText(
				JSON.stringify({ method: 'GET', pathname: '/network/embedded/probe.json' })
			);
		});

		test('POST remains a native request against the effective base', async ({ page }) => {
			await page.goto(`${origin}/hash-inline/host.html?mode=${mode}`);
			const frame = page.frameLocator('iframe');
			await frame.getByRole('button', { name: 'Native POST', exact: true }).click();
			await expect(frame.getByRole('heading', { name: 'Native request' })).toBeVisible();
			await expect(frame.locator('pre')).toHaveText(
				JSON.stringify({
					method: 'POST',
					pathname: '/network/embedded/submit',
					body: 'message=hash-native-post'
				})
			);
		});

		test('native window.fetch POST uses the effective base without an invalidation URL error', async ({
			page
		}) => {
			await page.goto(`${origin}/hash-inline/host.html?mode=${mode}`);
			const frame = page.frameLocator('iframe');
			await frame.getByRole('button', { name: 'Native fetch POST', exact: true }).click();
			await expect(frame.locator('[data-native-fetch-result]')).toHaveText(
				JSON.stringify({ method: 'POST', pathname: '/network/embedded/probe.json' })
			);
			await expect(frame.getByRole('heading', { name: 'Hash page A' })).toBeVisible();
		});

		for (const [name, pathname] of [
			['Native reload link', '/network/embedded/native'],
			['Native external hash', '/network/embedded/'],
			['Outside base link', '/outside']
		]) {
			test(`${name} retains native navigation`, async ({ page }) => {
				await page.goto(`${origin}/hash-inline/host.html?mode=${mode}`);
				const frame = page.frameLocator('iframe');
				await frame.getByRole('link', { name, exact: true }).click();
				await expect(frame.getByRole('heading', { name: 'Native request' })).toBeVisible();
				await expect(frame.locator('pre')).toHaveText(
					JSON.stringify({ method: 'GET', pathname, body: '' })
				);
			});
		}
	});
}

test('srcdoc without a base element inherits the host URL for load.fetch', async ({ page }) => {
	await page.goto(`${origin}/hash-inline/host.html?mode=srcdoc&base=inherited`);
	const frame = page.frameLocator('iframe');
	await frame.getByRole('link', { name: 'Relative load fetch', exact: true }).click();
	await expect(frame.locator('[data-fetch-result]')).toHaveText(
		JSON.stringify({ method: 'GET', pathname: '/hash-inline/probe.json' })
	);
});

test('data without an HTTP base still supports local hash navigation', async ({ page }) => {
	await page.goto(`${origin}/hash-inline/host.html?mode=data&base=none`);
	const frame = page.frameLocator('iframe');
	await expect(frame.getByRole('heading', { name: 'Hash page A' })).toBeVisible();
	await frame.getByRole('link', { name: 'Raw hash B', exact: true }).click();
	await expect(frame.getByRole('heading', { name: 'Hash page B' })).toBeVisible();
});

test('ordinary HTTP hash routing with a nonempty base is unchanged', async ({ page }) => {
	await page.goto(`${origin}/app/#/inline/a`);
	await expect(page.getByRole('heading', { name: 'Hash page A' })).toBeVisible();
	await page.getByRole('link', { name: 'Raw hash B', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Hash page B' })).toBeVisible();
	expect(page.url()).toBe(`${origin}/app/#/inline/b`);
	await page.getByRole('link', { name: 'Relative load fetch', exact: true }).click();
	await expect(page.locator('[data-fetch-result]')).toHaveText(
		JSON.stringify({ method: 'GET', pathname: '/app/probe.json' })
	);
});
