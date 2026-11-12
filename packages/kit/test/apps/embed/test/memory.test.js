import process from 'node:process';
import { expect } from '@playwright/test';
import { test, variant } from '../../../utils.js';

/** @typedef {import('@playwright/test').Frame} Frame */
/** @typedef {import('@playwright/test').Page} Page */

test.describe.configure({ mode: 'parallel' });

/**
 * @param {Page} page
 * @param {Record<string, string>} [options]
 */
async function mount(page, options = {}) {
	await page.goto(`/app/memory?${new URLSearchParams(options)}`);
	await expect(page.getByTestId('host-status')).toHaveText('ready');
	await expect.poll(() => page.frame({ name: 'memory-1' }) !== null).toBe(true);
	const frame = page.frame({ name: 'memory-1' });
	await expect(/** @type {Frame} */ (frame).getByTestId('runtime')).toHaveText('browser');
	await expect(/** @type {Frame} */ (frame).locator('body')).toHaveClass('started');
	return /** @type {Frame} */ (frame);
}

/** @param {Frame} frame @param {string} id */
async function json(frame, id) {
	return JSON.parse(/** @type {string} */ (await frame.getByTestId(id).textContent()));
}

/** @param {Frame} frame @param {string} slug */
async function expect_route(frame, slug) {
	await expect(frame.getByTestId('load-slug')).toHaveText(slug);
	await expect(frame.getByTestId('route-id')).toHaveText('/memory/route/[slug]');
	await expect(frame.getByTestId('load-route')).toHaveText('/memory/route/[slug]');
	await expect(frame.getByTestId('params')).toHaveText(JSON.stringify({ slug }));
	await expect(frame.getByTestId('server-slug')).toHaveText(slug);
	const href = /** @type {string} */ (await frame.getByTestId('page-url').textContent());
	expect(new URL(href).pathname).toBe(`/app/memory/route/${slug}`);
	await expect(frame.getByTestId('load-url')).toHaveText(href);
	await expect(frame.getByTestId('server-url')).toHaveText(href.split('#')[0]);
	await expect(frame.getByTestId('server-route')).toHaveText('/memory/route/[slug]');
}

/** @param {Frame} frame @param {string} transport */
async function expect_document(frame, transport) {
	const expected =
		transport === 'data' ? frame.url() : transport === 'blank' ? 'about:blank' : 'about:srcdoc';
	if (transport === 'data') expect(expected).toMatch(/^data:text\/html;charset=utf-8,/);
	expect(frame.url()).toBe(expected);
	expect(await frame.evaluate(() => location.href)).toBe(expected);
}

test.afterEach(async ({ page }, test_info) => {
	if (test_info.status === test_info.expectedStatus || !test_info.title.includes('reload')) return;
	const diagnostics = {
		frames: page.frames().map((frame) => ({ name: frame.name(), url: frame.url() })),
		documents: await page.evaluate(() =>
			Array.from(document.querySelectorAll('iframe'), (iframe) => {
				try {
					const doc = iframe.contentDocument;
					return {
						name: iframe.name,
						src: iframe.src,
						srcdoc_length: iframe.srcdoc.length,
						url: doc?.URL,
						ready: doc?.readyState,
						body: doc?.body?.innerText.slice(0, 1500),
						counter: doc?.querySelector('[data-testid="counter"]')?.textContent
					};
				} catch (error) {
					return { name: iframe.name, error: String(error) };
				}
			})
		)
	};
	console.log('inline reload diagnostics', JSON.stringify(diagnostics));
	await test_info.attach('inline-reload-diagnostics', {
		body: JSON.stringify(diagnostics, null, 2),
		contentType: 'application/json'
	});
});

for (const sandbox of [false, true]) {
	test(`native srcdoc reload control${sandbox ? ' in an opaque sandbox' : ''}`, async ({
		page,
		javaScriptEnabled
	}) => {
		test.skip(!javaScriptEnabled, 'The native control uses iframe scripts');
		await page.route('**/app/native-reload-control', (route) =>
			route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' })
		);
		await page.goto('/app/native-reload-control');
		await page.evaluate((sandbox) => {
			const iframe = document.createElement('iframe');
			iframe.name = 'native-reload';
			if (sandbox) iframe.setAttribute('sandbox', 'allow-scripts');
			iframe.srcdoc =
				'<!doctype html><body><p data-testid="counter">Count: 0</p><script>document.body.dataset.run = Math.random().toString()</' +
				'script>';
			document.body.append(iframe);
		}, sandbox);
		await expect.poll(() => page.frame({ name: 'native-reload' })).not.toBeNull();
		const frame = /** @type {Frame} */ (page.frame({ name: 'native-reload' }));
		await expect(frame.getByTestId('counter')).toHaveText('Count: 0');
		await expect(frame.locator('body')).toHaveAttribute('data-run', /.+/);
		const run = await frame.locator('body').getAttribute('data-run');
		await frame.evaluate(() => {
			/** @type {HTMLElement} */ (document.querySelector('[data-testid="counter"]')).textContent =
				'Count: 1';
		});
		await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
		await frame.evaluate(() => location.reload());
		await expect(frame.getByTestId('counter')).toHaveText('Count: 0');
		await expect(frame.locator('body')).not.toHaveAttribute(
			'data-run',
			/** @type {string} */ (run)
		);
	});
}

test.describe('inline routing in about/data documents', () => {
	test.skip(variant !== 'memory', 'Requires the inline output variant');
	test.beforeEach(({ javaScriptEnabled }) => {
		test.skip(!javaScriptEnabled, 'The HTTP host inserts iframe documents with JavaScript');
	});

	test('keeps ordinary pathname navigation for an inline bundle opened over HTTP', async ({
		page
	}) => {
		await page.goto('/app/memory/route/alpha?token=http-control');
		await expect(page.getByTestId('runtime')).toHaveText('browser');
		await expect(page.locator('body')).toHaveClass('started');
		await page.getByTestId('goto').click();
		await expect(page).toHaveURL(/\/app\/memory\/route\/next\?token=http-control$/);
		await expect(page.getByTestId('page-url')).toHaveText(page.url());
		expect(await page.evaluate(() => history.state['sveltekit:metadata'].url)).toBeUndefined();
		await page.goBack();
		await expect(page.getByTestId('load-slug')).toHaveText('alpha');
	});

	for (const transport of ['srcdoc', 'blank', 'data']) {
		test.describe(transport, () => {
			test('hydrates and invalidates a self-contained SSR route without an HTTP document base', async ({
				page
			}) => {
				test.skip(
					!!process.env.DEV,
					'A baseless document requires the self-contained production bundle'
				);
				/** @type {string[]} */
				const errors = [];
				/** @type {string[]} */
				const data_requests = [];
				page.on('pageerror', (error) => errors.push(error.message));
				page.on('request', (request) => {
					if (
						new URL(request.url()).pathname.endsWith('/data.json') ||
						new URL(request.url()).pathname.endsWith('/__data.json')
					)
						data_requests.push(request.url());
				});
				const frame = await mount(page, { transport, simple: '', base: 'opaque' });
				const ssr = JSON.parse(
					/** @type {string} */ (await page.getByTestId('ssr-1').textContent())
				);
				expect(ssr).toMatchObject({
					runtime: 'server',
					'route-id': '/memory/simple/[slug]',
					params: '{"slug":"alpha"}'
				});
				expect(await frame.evaluate(() => document.baseURI)).toBe('about:blank');
				await expect(frame.getByTestId('route-id')).toHaveText('/memory/simple/[slug]');
				await expect(frame.getByTestId('params')).toHaveText('{"slug":"alpha"}');
				await expect(frame.getByTestId('page-url')).toHaveText(frame.url());
				await expect(frame.getByTestId('load-count')).toHaveText('1');
				await expect(frame.getByTestId('load-route')).toHaveText('/memory/simple/[slug]');
				await expect(frame.getByTestId('load-params')).toHaveText('{"slug":"alpha"}');
				await frame.getByTestId('counter').click();
				await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
				/** @type {string[]} */
				const invalidation_requests = [];
				page.on('request', (request) => {
					if (!request.serviceWorker() && request.frame() === frame) {
						invalidation_requests.push(request.url());
					}
				});
				await frame.getByTestId('refresh').click();
				await expect(frame.getByTestId('load-count')).toHaveText('2');
				await expect(frame.getByTestId('load-route')).toHaveText('/memory/simple/[slug]');
				await expect(frame.getByTestId('load-params')).toHaveText('{"slug":"alpha"}');
				await expect(frame.getByTestId('route-id')).toHaveText('/memory/simple/[slug]');
				await expect(frame.getByTestId('params')).toHaveText('{"slug":"alpha"}');
				await expect(frame.getByTestId('load-url')).toHaveText(frame.url());
				await expect(frame.getByTestId('counter')).toHaveText('Count: 1');

				expect(errors).toEqual([]);
				expect(data_requests).toEqual([]);
				expect(invalidation_requests).toEqual([]);
				await expect_document(frame, transport);
			});
		});
	}

	for (const transport of ['srcdoc', 'blank']) {
		test.describe(transport, () => {
			test('a bare fragment retains the effective document-base destination', async ({ page }) => {
				test.skip(
					!!process.env.DEV,
					'A baseless document requires the self-contained production bundle'
				);
				const frame = await mount(page, { transport, simple: '', base: 'opaque' });
				const host_url = page.url();
				const link = frame.getByTestId('document-base-anchor');
				await expect(link).toHaveAttribute('href', '#base-anchor');
				expect(
					await link.evaluate((anchor) => /** @type {HTMLAnchorElement} */ (anchor).href)
				).toBe('about:blank#base-anchor');
				await link.click();
				await expect
					.poll(() => frame.evaluate(() => location.href))
					.toBe('about:blank#base-anchor');
				if (transport === 'srcdoc') {
					// The effective base names a different document. This is a native document
					// navigation, not a fragment of the logical route or original srcdoc.
					await expect(frame.getByTestId('counter')).toHaveCount(0);
				} else {
					await expect(frame.getByTestId('counter')).toHaveText('Count: 0');
					await expect(frame.getByTestId('page-url')).toHaveText('about:blank#base-anchor');
				}
				expect(page.url()).toBe(host_url);
			});

			test(
				transport === 'srcdoc'
					? 'preserves baseless native fragments through replace and back/forward'
					: 'preserves baseless blank-document fragments through push and replace',
				async ({ page }) => {
					test.skip(
						!!process.env.DEV,
						'A baseless document requires the self-contained production bundle'
					);
					/** @type {string[]} */
					const errors = [];
					page.on('pageerror', (error) => errors.push(error.message));
					const frame = await mount(page, { transport, simple: '', base: 'opaque' });
					const href = transport === 'blank' ? 'about:blank' : 'about:srcdoc';
					const length = await frame.evaluate(() => history.length);
					await frame.getByTestId('counter').click();
					await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
					await expect(frame.getByTestId('native-anchor')).toHaveAttribute(
						'href',
						`${href}#anchor`
					);
					await frame.getByTestId('native-anchor').click();
					await expect.poll(() => frame.evaluate(() => location.href)).toBe(`${href}#anchor`);
					await expect(frame.getByTestId('page-url')).toHaveText(`${href}#anchor`);
					expect(await frame.evaluate(() => history.length)).toBe(length + 1);
					await expect
						.poll(() =>
							frame.evaluate(() =>
								Math.abs(document.getElementById('anchor')?.getBoundingClientRect().top ?? Infinity)
							)
						)
						.toBeLessThan(1);

					await frame.getByTestId('native-anchor-replace').click();
					await expect.poll(() => frame.evaluate(() => location.href)).toBe(`${href}#replacement`);
					await expect(frame.getByTestId('page-url')).toHaveText(`${href}#replacement`);
					expect(await frame.evaluate(() => history.length)).toBe(length + 1);
					if (transport === 'srcdoc') {
						await frame.getByTestId('history-back').click();
						await expect.poll(() => frame.evaluate(() => location.href)).toBe(href);
						await expect(frame.getByTestId('page-url')).toHaveText(href);
						await frame.getByTestId('history-forward').click();
						await expect
							.poll(() => frame.evaluate(() => location.href))
							.toBe(`${href}#replacement`);
						await expect(frame.getByTestId('page-url')).toHaveText(`${href}#replacement`);
					}
					// Returning to the original no-fragment entry can discard document.write
					// content even without Kit. Do not promise blank-document persistence.
					await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
					await expect(frame.getByTestId('load-count')).toHaveText('1');
					await expect(frame.getByTestId('route-id')).toHaveText('/memory/simple/[slug]');
					await expect(frame.getByTestId('params')).toHaveText('{"slug":"alpha"}');
					expect(errors).toEqual([]);
				}
			);

			for (const id of [
				'document-anchor',
				'document-anchor-reload',
				'document-anchor-external',
				'document-anchor-self'
			]) {
				test(`${id} preserves a later logical route through native fragments`, async ({ page }) => {
					const frame = await mount(page, { transport });
					const host_url = page.url();
					const href = transport === 'blank' ? 'about:blank' : 'about:srcdoc';
					const document_base = await frame.evaluate(() => document.baseURI);
					await frame.getByTestId('goto').click();
					await expect_route(frame, 'next');
					const logical = /** @type {string} */ (await frame.getByTestId('page-url').textContent());
					expect(new URL(logical).pathname).not.toBe(new URL(document_base).pathname);
					const length = await frame.evaluate(() => history.length);
					const index = await frame.evaluate(
						() => history.state['sveltekit:metadata'].historyIndex
					);
					const navigations = await json(frame, 'navigation-log');
					const opt_out = id === 'document-anchor-external' || id === 'document-anchor-self';
					await frame.getByTestId('counter').click();
					await frame.getByTestId('unsaved-guard').check();

					/** @param {string} hash @param {number} expected_index */
					async function expect_fragment(hash, expected_index) {
						await expect.poll(() => frame.evaluate(() => location.href)).toBe(href + hash);
						await expect(frame.getByTestId('page-url')).toHaveText(logical + hash);
						await expect
							.poll(() => frame.evaluate(() => history.state['sveltekit:metadata']))
							.toMatchObject({ url: logical + hash, historyIndex: expected_index });
						await expect(frame.getByTestId('load-url')).toHaveText(logical);
						await expect(frame.getByTestId('load-slug')).toHaveText('next');
						await expect(frame.getByTestId('route-id')).toHaveText('/memory/route/[slug]');
						await expect(frame.getByTestId('params')).toHaveText('{"slug":"next"}');
						await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
						await expect(frame.getByTestId('unsaved-guard')).toBeChecked();
						expect(await frame.evaluate(() => document.baseURI)).toBe(document_base);
						expect(page.url()).toBe(host_url);
					}

					await expect(frame.getByTestId(id)).toHaveAttribute('href', `${href}#anchor`);
					for (let click = 0; click < 2; click += 1) {
						await frame.getByTestId(id).click();
						await expect_fragment('#anchor', index + 1);
						expect(await frame.evaluate(() => history.length)).toBe(length + 1);
						if (opt_out) {
							navigations.push({ willUnload: false, toUrl: `${href}#anchor`, type: 'link' });
						}
						await expect(frame.getByTestId('navigation-log')).toHaveText(
							JSON.stringify(navigations)
						);
						await expect
							.poll(() =>
								frame.evaluate(() =>
									Math.abs(
										document.getElementById('anchor')?.getBoundingClientRect().top ?? Infinity
									)
								)
							)
							.toBeLessThan(1);
					}

					await frame.getByTestId('document-anchor-replace').click();
					await expect_fragment('#replacement', index + 1);
					expect(await frame.evaluate(() => history.length)).toBe(length + 1);
					if (transport === 'srcdoc') {
						await frame.getByTestId('back').click();
						await expect_fragment('', index);
						await frame.getByTestId('forward').click();
						await expect_fragment('#replacement', index + 1);
					}
					await expect(frame.getByTestId('navigation-log')).toHaveText(JSON.stringify(navigations));
				});
			}

			test('can cancel an actual document fragment without losing the later logical route', async ({
				page
			}) => {
				const frame = await mount(page, { transport });
				const href = transport === 'blank' ? 'about:blank' : 'about:srcdoc';
				await frame.getByTestId('goto').click();
				await expect_route(frame, 'next');
				const logical = await frame.getByTestId('page-url').textContent();
				const metadata = await frame.evaluate(() => history.state['sveltekit:metadata']);
				const length = await frame.evaluate(() => history.length);
				const navigations = await json(frame, 'navigation-log');
				await frame.getByTestId('counter').click();
				await frame.getByTestId('cancel-all').check();
				for (const id of ['document-anchor-external', 'document-anchor-self']) {
					await frame.getByTestId(id).click();
					navigations.push({ willUnload: false, toUrl: `${href}#anchor`, type: 'link' });
					await expect(frame.getByTestId('navigation-log')).toHaveText(JSON.stringify(navigations));
					await expect(frame.getByTestId('page-url')).toHaveText(/** @type {string} */ (logical));
					await expect_route(frame, 'next');
					await expect_document(frame, transport);
					await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
					expect(await frame.evaluate(() => history.state['sveltekit:metadata'])).toEqual(metadata);
					expect(await frame.evaluate(() => history.length)).toBe(length);
				}
			});

			test('native script hash changes retain the later logical pathname immediately', async ({
				page
			}) => {
				const frame = await mount(page, { transport });
				const href = transport === 'blank' ? 'about:blank' : 'about:srcdoc';
				await frame.getByTestId('goto').click();
				await expect_route(frame, 'next');
				const logical = /** @type {string} */ (await frame.getByTestId('page-url').textContent());
				const navigations = await frame.getByTestId('navigation-log').textContent();
				await frame.getByTestId('counter').click();
				await frame.getByTestId('unsaved-guard').check();
				for (const [id, hash] of [
					['native-hash', '#anchor'],
					['native-replace-hash', '#replacement']
				]) {
					await frame.getByTestId(id).click();
					await expect.poll(() => frame.evaluate(() => location.href)).toBe(href + hash);
					await expect(frame.getByTestId('page-url')).toHaveText(logical + hash);
					await expect(frame.getByTestId('load-url')).toHaveText(logical);
					await expect(frame.getByTestId('load-slug')).toHaveText('next');
					await expect(frame.getByTestId('params')).toHaveText('{"slug":"next"}');
					await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
					await expect(frame.getByTestId('navigation-log')).toHaveText(
						/** @type {string} */ (navigations)
					);
				}
				// Native script-created entries are not Kit navigations. Do not infer
				// arbitrary script-hash Back/Forward guarantees from immediate updates.
			});

			for (const base of ['inherited', 'relative']) {
				test(`hydrates using the browser's ${base} document base`, async ({ page }) => {
					const frame = await mount(page, { transport, base });
					await expect_route(frame, 'alpha');
					if (base === 'inherited') {
						expect(await frame.locator('base').count()).toBe(0);
						expect(await frame.evaluate(() => document.baseURI)).toBe(page.url());
					} else {
						expect(await frame.locator('base').getAttribute('href')).toMatch(/^\/app\//);
						expect(await frame.evaluate(() => document.baseURI)).toBe(
							await page.getByTestId('frame-1').getAttribute('data-source')
						);
					}
					await frame.getByTestId('counter').click();
					await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
					await expect_document(frame, transport);
				});
			}

			test('uses the effective inherited base when CSP blocks an explicit base', async ({
				page
			}) => {
				/** @type {string[]} */
				const blocked_requests = [];
				page.on('request', (request) => {
					if (new URL(request.url()).hostname === 'blocked.example') {
						blocked_requests.push(request.url());
					}
				});
				const frame = await mount(page, { transport, csp: 'base-none' });
				await expect_route(frame, 'alpha');
				expect(await frame.evaluate(() => document.baseURI)).toBe(page.url());
				expect(await frame.locator('base').getAttribute('href')).toBe(
					'https://blocked.example/resources/'
				);
				expect(blocked_requests).toEqual([]);
				await frame.getByTestId('counter').click();
				await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
				await expect_document(frame, transport);
			});

			for (const cache of ['hit', 'miss']) {
				test(`hydrates a dynamic SSR route with a fetch cache ${cache}`, async ({ page }) => {
					/** @type {string[]} */
					const errors = [];
					/** @type {string[]} */
					const gets = [];
					page.on('pageerror', (error) => errors.push(error.message));
					page.on('request', (request) => {
						if (new URL(request.url()).pathname === '/app/memory/data.json') {
							gets.push(request.method());
						}
					});
					const frame = await mount(page, { transport, cache });
					await expect_route(frame, 'alpha');
					await expect_document(frame, transport);
					const initial = await page.getByTestId('frame-1').getAttribute('data-source');
					await expect(frame.getByTestId('page-url')).toHaveText(/** @type {string} */ (initial));
					const ssr = JSON.parse(
						/** @type {string} */ (await page.getByTestId('ssr-1').textContent())
					);
					expect(ssr.runtime).toBe('server');
					expect(ssr['route-id']).toBe('/memory/route/[slug]');
					expect(ssr.params).toBe('{"slug":"alpha"}');
					expect(ssr['page-url']).toBe(initial);
					expect(ssr['load-url']).toBe(initial);
					expect(ssr['server-url']).toBe(initial);
					expect(JSON.parse(ssr.fetched)).toMatchObject({ source: 'server', version: 0 });
					expect(await json(frame, 'fetched')).toMatchObject({
						method: 'GET',
						path: '/app/memory/data.json',
						source: cache === 'hit' ? 'server' : 'network',
						version: 0
					});
					expect(gets).toEqual(cache === 'hit' ? [] : ['GET']);
					await frame.getByTestId('counter').click();
					await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
					expect(errors).toEqual([]);
				});
			}

			test('navigates by goto and links, then restores back and forward', async ({ page }) => {
				const frame = await mount(page, { transport });
				const host_url = page.url();
				await frame.getByTestId('goto').click();
				await expect_route(frame, 'next');
				await frame.getByTestId('link').click();
				await expect_route(frame, 'linked');
				await frame.getByTestId('relative-link').click();
				await expect_route(frame, 'relative');
				await frame.evaluate(() => history.back());
				await expect_route(frame, 'linked');
				await frame.evaluate(() => history.back());
				await expect_route(frame, 'next');
				await frame.evaluate(() => history.back());
				await expect_route(frame, 'alpha');
				await frame.evaluate(() => history.forward());
				await expect_route(frame, 'next');
				await expect_document(frame, transport);
				expect(page.url()).toBe(host_url);
			});

			test('preloads server and universal data before navigating', async ({ page }) => {
				const frame = await mount(page, { transport });
				/** @type {string[]} */
				const data_requests = [];
				page.on('request', (request) => {
					if (new URL(request.url()).pathname.endsWith('/preloaded/__data.json')) {
						data_requests.push(request.url());
					}
				});
				await frame.getByTestId('preload').click();
				await expect(frame.getByTestId('operation')).toHaveText('preloaded:loaded');
				await expect_route(frame, 'alpha');
				expect(data_requests).toHaveLength(1);
				await frame.getByTestId('goto-preloaded').click();
				await expect_route(frame, 'preloaded');
				expect(data_requests).toHaveLength(1);
				await expect_document(frame, transport);
			});

			test('reuses max-age GET data and evicts it after a native relative POST', async ({
				page
			}) => {
				const frame = await mount(page, { transport });
				await frame.getByTestId('refresh').click();
				await expect(frame.getByTestId('operation')).toHaveText('refreshed');
				expect(await json(frame, 'fetched')).toMatchObject({ source: 'server', version: 0 });
				await frame.getByTestId('post').click();
				await expect(frame.getByTestId('operation')).toHaveText('posted');
				expect(await json(frame, 'native-posted')).toMatchObject({
					method: 'POST',
					source: 'network',
					version: 1,
					body: 'from-window'
				});
				expect(await json(frame, 'fetched')).toMatchObject({ source: 'network', version: 1 });
				await expect_route(frame, 'alpha');
				await expect_document(frame, transport);
			});

			test('resolves relative load POST and fetch redirects at the target route', async ({
				page
			}) => {
				const frame = await mount(page, { transport });
				await frame.getByTestId('load-post').click();
				await expect_route(frame, 'posted');
				expect(await json(frame, 'load-posted')).toMatchObject({
					method: 'POST',
					path: '/app/memory/data.json',
					source: 'network',
					version: 1,
					body: 'from-load'
				});
				expect(await json(frame, 'fetched')).toMatchObject({ source: 'network', version: 1 });
				await frame.getByTestId('fetch-redirect').click();
				await expect_route(frame, 'fetch-redirect');
				expect(await json(frame, 'redirected-fetch')).toMatchObject({
					method: 'GET',
					path: '/app/memory/data.json',
					source: 'network',
					version: 1
				});
				await expect_document(frame, transport);
			});

			test('follows server redirects without navigating the real document', async ({ page }) => {
				const frame = await mount(page, { transport });
				await frame.getByTestId('redirect').click();
				await expect_route(frame, 'redirected');
				await expect_document(frame, transport);
				await frame.evaluate(() => history.back());
				await expect_route(frame, 'alpha');
			});

			test('keeps shallow history URLs distinct from the rendered page URL', async ({ page }) => {
				const frame = await mount(page, { transport });
				const original = await frame.getByTestId('page-url').textContent();
				const length = await frame.evaluate(() => history.length);
				await frame.getByTestId('shallow-push').click();
				await expect(frame.getByTestId('state')).toHaveText('{"modal":"open"}');
				await expect_route(frame, 'alpha');
				await expect(frame.getByTestId('shallow-slug')).toHaveText('modal');
				let metadata = await frame.evaluate(() => history.state['sveltekit:metadata']);
				expect(metadata.pageUrl).toBe(original);
				expect(new URL(metadata.url).pathname).toBe('/app/memory/route/modal');
				expect(await frame.evaluate(() => history.length)).toBe(length + 1);
				await frame.getByTestId('shallow-replace').click();
				await expect(frame.getByTestId('state')).toHaveText('{"modal":"replaced"}');
				await expect(frame.getByTestId('shallow-slug')).toHaveText('replaced');
				metadata = await frame.evaluate(() => history.state['sveltekit:metadata']);
				expect(metadata.pageUrl).toBe(original);
				expect(new URL(metadata.url).pathname).toBe('/app/memory/route/replaced');
				expect(await frame.evaluate(() => history.length)).toBe(length + 1);
				await frame.evaluate(() => history.back());
				await expect(frame.getByTestId('state')).toHaveText('{}');
				await expect(frame.getByTestId('shallow-url')).toHaveText('');
				await expect_route(frame, 'alpha');
				await frame.evaluate(() => history.forward());
				await expect(frame.getByTestId('state')).toHaveText('{"modal":"replaced"}');
				await expect(frame.getByTestId('shallow-slug')).toHaveText('replaced');
				await expect_route(frame, 'alpha');
				await expect_document(frame, transport);
			});

			test('scrolls to anchors and restores scroll after history traversal', async ({ page }) => {
				const frame = await mount(page, { transport });
				// The diagnostic log grows in beforeNavigate. Test Kit's saved scroll,
				// without the browser independently anchoring that changing layout.
				await frame.addStyleTag({ content: 'html { overflow-anchor: none; }' });
				await frame.getByTestId('anchor-link').click();
				await expect(frame.getByTestId('page-url')).toContainText('#anchor');
				await expect
					.poll(() =>
						frame.evaluate(() =>
							Math.abs(document.getElementById('anchor')?.getBoundingClientRect().top ?? Infinity)
						)
					)
					.toBeLessThan(1);
				const position = await frame.evaluate(() => scrollY);
				expect(position).toBeGreaterThan(1000);
				// Programmatic navigation avoids Playwright scrolling the top button into view.
				await frame.evaluate(() =>
					document
						.querySelector('[data-testid="goto"]')
						?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
				);
				await expect_route(frame, 'next');
				await expect.poll(() => frame.evaluate(() => scrollY)).toBe(0);
				await frame.evaluate(() => history.back());
				await expect(frame.getByTestId('page-url')).toContainText('#anchor');
				await expect.poll(() => frame.evaluate(() => scrollY)).toBe(position);
				await expect_document(frame, transport);
			});

			test('uses the current route for default GET forms and the document base for explicit actions', async ({
				page
			}) => {
				const frame = await mount(page, { transport });
				await frame.getByTestId('get-form').click();
				await expect(frame.getByTestId('page-url')).toContainText('query=form');
				await expect_route(frame, 'alpha');
				await frame.getByTestId('relative-get-form').click();
				await expect_route(frame, 'relative');
				await expect_document(frame, transport);
			});

			for (const control of ['relative-link', 'relative-goto', 'relative-get-form']) {
				test(`${control} preserves the explicit base pathname`, async ({ page }) => {
					// Remove the SSR max-age cache so this case exercises a network URL.
					const frame = await mount(page, { transport, base: 'alternate', cache: 'miss' });
					await expect_route(frame, 'alpha');
					await frame.getByTestId(control).click();
					await expect(frame.getByTestId('route-id')).toHaveText('/memory/client/[slug]');
					await expect(frame.getByTestId('load-slug')).toHaveText('relative');
					await expect(frame.getByTestId('page-url')).toContainText('/app/memory/client/relative?');
					expect(await json(frame, 'fetched')).toMatchObject({
						path: '/app/memory/data.json',
						source: 'network'
					});
					await expect_document(frame, transport);
				});
			}

			test('isolates logical history and shallow state in two iframe documents', async ({
				page
			}) => {
				const first = await mount(page, { transport, two: '' });
				const second = /** @type {Frame} */ (page.frame({ name: 'memory-2' }));
				await expect(second.getByTestId('runtime')).toHaveText('browser');
				await first.getByTestId('goto').click();
				await expect_route(first, 'next');
				await expect_route(second, 'alpha');
				await second.getByTestId('shallow-push').click();
				await expect(second.getByTestId('state')).toHaveText('{"modal":"open"}');
				await expect(first.getByTestId('state')).toHaveText('{}');
				await expect_route(first, 'next');
				await second.evaluate(() => history.back());
				await expect(second.getByTestId('state')).toHaveText('{}');
				await expect_route(first, 'next');
				await first.evaluate(() => history.back());
				await expect_route(first, 'alpha');
				await expect_route(second, 'alpha');
				await expect_document(first, transport);
				await expect_document(second, transport);
			});

			test('mounts an SSR-disabled dynamic route at its original pathname', async ({ page }) => {
				const frame = await mount(page, { transport, csr: '' });
				await expect(frame.getByTestId('route-id')).toHaveText('/memory/client/[slug]');
				await expect(frame.getByTestId('params')).toHaveText('{"slug":"alpha"}');
				await expect(frame.getByTestId('page-url')).toContainText('/app/memory/client/alpha?');
				expect(await json(frame, 'fetched')).toMatchObject({ source: 'network', version: 0 });
				await frame.getByTestId('goto').click();
				await expect_route(frame, 'next');
				await expect_document(frame, transport);
			});

			test('handles a browser-only hydration redirect without leaving the iframe', async ({
				page
			}) => {
				const frame = await mount(page, { transport, redirect: '' });
				await expect_route(frame, 'hydration-redirected');
				expect(await frame.evaluate(() => history.length)).toBe(
					await frame.evaluate(() => window.memory_initial_history_length)
				);
				const ssr = JSON.parse(
					/** @type {string} */ (await page.getByTestId('ssr-1').textContent())
				);
				expect(ssr.params).toBe('{"slug":"alpha"}');
				await expect_document(frame, transport);
			});

			test('cancels native links using their real destination without losing unsaved state', async ({
				page
			}) => {
				const frame = await mount(page, { transport, base: 'alternate' });
				const host_url = page.url();
				const logical_url = /** @type {string} */ (
					await frame.getByTestId('page-url').textContent()
				);
				await frame.getByTestId('unsaved-guard').check();
				await frame.getByTestId('counter').click();
				/** @type {Array<{ willUnload: boolean; toUrl: string; type: string }>} */
				const navigations = [];

				for (const id of [
					'native-reload-root',
					'native-reload-absolute',
					'native-external-root',
					'native-external-absolute',
					'native-self-root',
					'native-self-absolute',
					'native-reload-relative',
					'native-reload-hash'
				]) {
					const link = frame.getByTestId(id);
					const href = await link.evaluate((a) => /** @type {HTMLAnchorElement} */ (a).href);
					if (id === 'native-reload-relative' || id === 'native-reload-hash') {
						const raw = /** @type {string} */ (await link.getAttribute('href'));
						expect(href).not.toBe(new URL(raw, logical_url).href);
					}
					await link.click();
					navigations.push({ willUnload: true, toUrl: href, type: 'link' });
					await expect(frame.getByTestId('navigation-log')).toHaveText(JSON.stringify(navigations));
					await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
					await expect(frame.getByTestId('unsaved-guard')).toBeChecked();
					await expect(frame.getByTestId('page-url')).toHaveText(logical_url);
					await expect_route(frame, 'alpha');
					await expect_document(frame, transport);
					expect(page.url()).toBe(host_url);
				}
			});

			test('treats sibling mount links as document navigations rather than local 404s', async ({
				page
			}) => {
				const frame = await mount(page, { transport });
				const host_url = page.url();
				const logical_url = /** @type {string} */ (
					await frame.getByTestId('page-url').textContent()
				);
				await frame.getByTestId('unsaved-guard').check();
				await frame.getByTestId('counter').click();
				/** @type {Array<{ willUnload: boolean; toUrl: string; type: string }>} */
				const navigations = [];

				for (const [id, path] of [
					['sibling-application', '/application'],
					['sibling-app2-query', '/app2?query=1#anchor'],
					['sibling-app2-slash', '/app2/'],
					['sibling-app-encoded', '/app%2foutside']
				]) {
					const link = frame.getByTestId(id);
					await expect(link).toHaveAttribute('href', path);
					// These are ordinary links. Classification must follow the base path boundary,
					// rather than an explicit opt-out from client-side routing.
					for (const attribute of ['data-sveltekit-reload', 'rel', 'target']) {
						expect(await link.getAttribute(attribute)).toBeNull();
					}
					const href = await link.evaluate((a) => /** @type {HTMLAnchorElement} */ (a).href);
					expect(new URL(href).origin).toBe(new URL(logical_url).origin);
					await link.click();
					navigations.push({ willUnload: true, toUrl: href, type: 'link' });
					await expect(frame.getByTestId('navigation-log')).toHaveText(JSON.stringify(navigations));
					await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
					await expect(frame.getByTestId('unsaved-guard')).toBeChecked();
					await expect(frame.getByTestId('page-url')).toHaveText(logical_url);
					await expect(frame.locator('h1')).toHaveText('Memory route: alpha');
					await expect_route(frame, 'alpha');
					await expect_document(frame, transport);
					expect(page.url()).toBe(host_url);
				}
			});

			test('allows matched pages but cancels unmatched HTTP destinations with the unload guard', async ({
				page
			}) => {
				const frame = await mount(page, { transport });
				await frame.getByTestId('unsaved-guard').check();
				await frame.getByTestId('goto').click();
				await expect_route(frame, 'next');
				const navigations = [
					{
						willUnload: false,
						toUrl: await frame.getByTestId('page-url').textContent(),
						type: 'goto'
					}
				];
				for (const id of ['missing-route', 'endpoint-link', 'static-link']) {
					const link = frame.getByTestId(id);
					const href = await link.evaluate((a) => /** @type {HTMLAnchorElement} */ (a).href);
					await link.click();
					navigations.push({ willUnload: true, toUrl: href, type: 'link' });
					await expect(frame.getByTestId('navigation-log')).toHaveText(JSON.stringify(navigations));
					await expect_route(frame, 'next');
					await expect_document(frame, transport);
				}
			});

			for (const [id, text] of [
				['endpoint-link', '"source":"network"'],
				['static-link', 'Static embedded-navigation control.']
			]) {
				test(`loads the ordinary HTTP destination of ${id}`, async ({ page }) => {
					const frame = await mount(page, { transport });
					const host_url = page.url();
					const link = frame.getByTestId(id);
					const href = await link.evaluate((a) => /** @type {HTMLAnchorElement} */ (a).href);
					await link.click();
					await frame.waitForURL(href);
					await expect(frame.locator('body')).toContainText(text);
					expect(page.url()).toBe(host_url);
				});
			}

			test('lets the server handle unknown HTTP routes', async ({ page }) => {
				const frame = await mount(page, { transport });
				await frame.getByTestId('missing-route').click();
				await frame.waitForURL(/\/app\/memory\/not-found$/);
				await expect(frame.locator('h1')).toContainText('404');
			});
		});
	}

	test('hydrates from SSR cache in an opaque srcdoc sandbox without granting same-origin access', async ({
		page
	}) => {
		test.skip(
			!!process.env.DEV,
			'The opaque sandbox requires the self-contained production inline bundle, not Vite module requests'
		);
		/** @type {string[]} */
		const data_requests = [];
		page.on('request', (request) => {
			if (new URL(request.url()).pathname.endsWith('/data.json')) {
				data_requests.push(request.method());
			}
		});
		const frame = await mount(page, { transport: 'srcdoc', sandbox: '', cache: 'hit' });
		await expect(page.getByTestId('frame-1')).toHaveAttribute(
			'sandbox',
			'allow-scripts allow-forms'
		);
		await expect_route(frame, 'alpha');
		expect(await json(frame, 'fetched')).toMatchObject({ source: 'server', version: 0 });
		expect(data_requests).toEqual([]);
		expect(
			await frame.evaluate(() => {
				try {
					void document.cookie;
					return null;
				} catch (error) {
					return error instanceof DOMException ? error.name : String(error);
				}
			})
		).toBe('SecurityError');
		await frame.getByTestId('counter').click();
		await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
		await expect_document(frame, 'srcdoc');
	});

	for (const sandbox of [false, true]) {
		test(
			sandbox
				? 'restores retained opaque history or replays the source snapshot after a hash-only reload'
				: 'rehydrates a hash-only srcdoc reload from the snapshot and preserves saved scroll',
			async ({ page }) => {
				test.skip(
					sandbox && !!process.env.DEV,
					'The opaque sandbox requires the self-contained production inline bundle, not Vite module requests'
				);
				const frame = await mount(page, {
					transport: 'srcdoc',
					cache: 'hit',
					...(sandbox ? { sandbox: '' } : {})
				});
				const initial_url = /** @type {string} */ (
					await frame.getByTestId('page-url').textContent()
				);
				expect(await json(frame, 'fetched')).toMatchObject({ source: 'server', version: 0 });
				if (sandbox) {
					await expect(page.getByTestId('frame-1')).toHaveAttribute(
						'sandbox',
						'allow-scripts allow-forms'
					);
					expect(
						await frame.evaluate(() => {
							try {
								void window.sessionStorage;
								return null;
							} catch (error) {
								return error instanceof DOMException ? error.name : String(error);
							}
						})
					).toBe('SecurityError');
				}

				/** @type {string[]} */
				const data_requests = [];
				page.on('request', (request) => {
					const pathname = new URL(request.url()).pathname;
					if (pathname.endsWith('/data.json') || pathname.endsWith('/__data.json')) {
						data_requests.push(request.url());
					}
				});
				await frame.getByTestId('counter').click();
				await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
				await frame.getByTestId('anchor-link').click();
				await expect(frame.getByTestId('page-url')).toHaveText(`${initial_url}#anchor`);
				await expect
					.poll(() =>
						frame.evaluate(() =>
							Math.abs(document.getElementById('anchor')?.getBoundingClientRect().top ?? Infinity)
						)
					)
					.toBeLessThan(1);
				const anchor_position = await frame.evaluate(() => scrollY);
				expect(anchor_position).toBeGreaterThan(1000);
				if (!sandbox) {
					// A saved position takes precedence over scrolling the hash target into view again.
					await frame.evaluate((y) => scrollTo(0, y + 80), anchor_position);
					await expect.poll(() => frame.evaluate(() => scrollY)).toBe(anchor_position + 80);
				}
				const saved_position = await frame.evaluate(() => scrollY);
				// Clicking the reload button would scroll it into view before the position is saved.
				await frame.evaluate(() => location.reload());
				await expect(frame.getByTestId('counter')).toHaveText('Count: 0');
				await expect(frame.getByTestId('runtime')).toHaveText('browser');
				await expect(frame.locator('body')).toHaveClass('started');
				// This marker runs before Kit starts, so it observes what the browser retained.
				const retained_url = await frame
					.locator('html')
					.getAttribute('data-memory-initial-history-url');
				expect(retained_url).not.toBeNull();
				if (sandbox) {
					test.info().annotations.push({
						type: 'opaque-history-on-reload',
						description:
							retained_url === ''
								? 'Source replay: no logical URL before startup'
								: 'Logical URL retained before startup'
					});
				}
				if (sandbox && retained_url === '') {
					// Some browsers discard opaque history.state on reload. Replay the source without
					// fabricating a logical URL or granting the sandbox additional permissions.
					await expect(frame.getByTestId('page-url')).toHaveText(initial_url);
				} else {
					expect(retained_url).toBe(`${initial_url}#anchor`);
					await expect(frame.getByTestId('page-url')).toHaveText(`${initial_url}#anchor`);
					if (sandbox) {
						// Retained history can supply the hash even when session storage is unavailable.
						await expect
							.poll(() =>
								frame.evaluate(() =>
									Math.abs(
										document.getElementById('anchor')?.getBoundingClientRect().top ?? Infinity
									)
								)
							)
							.toBeLessThan(1);
					} else {
						await expect.poll(() => frame.evaluate(() => scrollY)).toBe(saved_position);
					}
				}
				await expect_route(frame, 'alpha');
				expect(await json(frame, 'fetched')).toMatchObject({ source: 'server', version: 0 });
				expect(data_requests).toEqual([]);
				await expect_document(frame, 'srcdoc');
			}
		);
	}

	test('replays the source snapshot when reloading unchanged logical URL', async ({ page }) => {
		const frame = await mount(page);
		const initial_url = /** @type {string} */ (await frame.getByTestId('page-url').textContent());
		expect(await json(frame, 'fetched')).toMatchObject({ source: 'server', version: 0 });
		await frame.getByTestId('counter').click();
		await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
		await frame.getByTestId('post').click();
		await expect(frame.getByTestId('operation')).toHaveText('posted');
		expect(await json(frame, 'fetched')).toMatchObject({ source: 'network', version: 1 });
		await expect(frame.getByTestId('page-url')).toHaveText(initial_url);
		await expect_route(frame, 'alpha');

		/** @type {string[]} */
		const data_requests = [];
		page.on('request', (request) => {
			if (new URL(request.url()).pathname.endsWith('/data.json')) {
				data_requests.push(request.method());
			}
		});
		await frame.getByTestId('reload').click();
		await expect(frame.getByTestId('counter')).toHaveText('Count: 0');
		// Wait for the new app to hydrate, rather than just observing the replayed SSR markup.
		await expect(frame.getByTestId('runtime')).toHaveText('browser');
		await expect(frame.locator('body')).toHaveClass('started');
		await expect(frame.getByTestId('page-url')).toHaveText(initial_url);
		await expect_route(frame, 'alpha');
		expect(await json(frame, 'fetched')).toMatchObject({ source: 'server', version: 0 });
		expect(data_requests).toEqual([]);
		await expect_document(frame, 'srcdoc');
	});

	test('reloads srcdoc at the logical destination rather than hydrating stale SSR markup', async ({
		page
	}) => {
		const frame = await mount(page);
		await frame.getByTestId('post').click();
		await expect(frame.getByTestId('operation')).toHaveText('posted');
		expect(await json(frame, 'fetched')).toMatchObject({ source: 'network', version: 1 });
		await frame.getByTestId('goto').click();
		await expect_route(frame, 'next');
		await frame.getByTestId('counter').click();
		await expect(frame.getByTestId('counter')).toHaveText('Count: 1');
		await frame.getByTestId('reload').click();
		await expect(frame.getByTestId('counter')).toHaveText('Count: 0');
		await expect_route(frame, 'next');
		await expect_document(frame, 'srcdoc');
		expect(await json(frame, 'fetched')).toMatchObject({ source: 'network', version: 1 });
		// The source HTML still contains alpha. Reload must perform a fresh client render for next.
		expect(
			JSON.parse(/** @type {string} */ (await page.getByTestId('ssr-1').textContent())).params
		).toBe('{"slug":"alpha"}');
	});
});
