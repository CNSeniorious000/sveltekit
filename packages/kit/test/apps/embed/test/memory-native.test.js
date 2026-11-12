import { expect } from '@playwright/test';
import { test, variant } from '../../../utils.js';

/** @param {import('@playwright/test').Page} page @param {string} head */
async function mount_native(page, head) {
	await page.evaluate((head) => {
		const frame = document.createElement('iframe');
		frame.name = 'native-probe';
		frame.dataset.testid = 'native-probe';
		frame.src = 'about:blank';
		const html = `<!doctype html><html><head>${head}</head><body><p>Native control without SvelteKit</p><script>document.documentElement.dataset.nativeReady = 'true';<\/script></body></html>`;
		frame.onload = () => {
			frame.onload = null;
			const doc = /** @type {Document} */ (frame.contentDocument);
			// Match the host: a new task removes the parent entry settings.
			const script = doc.createElement('script');
			script.textContent = `setTimeout(() => { document.open(); document.write(${JSON.stringify(html)}); document.close(); }, 0);`;
			doc.body.append(script);
		};
		document.body.append(frame);
	}, head);
	await expect(page.frameLocator('[data-testid="native-probe"]').locator('html')).toHaveAttribute(
		'data-native-ready',
		'true'
	);
	const frame = page.frame({ name: 'native-probe' });
	expect(frame).not.toBeNull();
	return /** @type {import('@playwright/test').Frame} */ (frame);
}

test.describe('native document-written about:blank base controls', () => {
	test.skip(variant !== 'memory', 'Runs alongside the inline document regressions');

	for (const base of ['inherited', 'relative', 'absolute', 'blocked']) {
		test(base, async ({ page, javaScriptEnabled }) => {
			test.skip(!javaScriptEnabled, 'The native document is created with JavaScript');
			/** @type {string[]} */
			const errors = [];
			page.on('console', (message) => {
				if (message.type() === 'error') errors.push(message.text());
			});
			page.on('pageerror', (error) => errors.push(error.message));
			await page.goto('/app/memory?simple&base=opaque');
			await expect(page.getByTestId('host-status')).toHaveText('ready');
			const head =
				base === 'inherited'
					? ''
					: base === 'blocked'
						? `<meta http-equiv="Content-Security-Policy" content="base-uri 'none'"><base href="https://blocked.example/resources/">`
						: `<base href="${base === 'absolute' ? new URL(page.url()).origin : ''}/app/memory/route/alpha">`;
			const frame = await mount_native(page, head);
			const result = await /** @type {import('@playwright/test').Frame} */ (frame).evaluate(() => {
				let resolved;
				let resolution_error;
				try {
					resolved = new URL('../data.json', document.baseURI).href;
				} catch (error) {
					resolution_error = String(error);
				}
				return {
					href: location.href,
					base: document.baseURI,
					declared_base: document.querySelector('base')?.getAttribute('href') ?? null,
					resolved,
					resolution_error,
					parent_access: parent.document.location.href
				};
			});
			const report = JSON.stringify({
				browser: test.info().project.name,
				case: base,
				result,
				errors
			});
			console.log('Native document base control:', report);
			await test.info().attach('native-document-base', {
				body: report,
				contentType: 'application/json'
			});
			expect(result.href).toBe('about:blank');
			expect(result.parent_access).toBe(page.url());
			if (base === 'absolute') {
				expect(result.base).toBe(new URL('/app/memory/route/alpha', page.url()).href);
			}
			if (base === 'blocked') expect(result.base).not.toContain('blocked.example');
			// Observe the native result rather than making Kit invent an HTTP origin.
			if (result.base.startsWith('http:')) {
				expect(result.resolved).toBe(new URL('../data.json', result.base).href);
				expect(result.resolution_error).toBeUndefined();
			} else {
				expect(result.base).toBe('about:blank');
				expect(result.resolved).toBeUndefined();
				expect(result.resolution_error).toBeTruthy();
			}
		});
	}

	test('native history traversal of the written document', async ({ page, javaScriptEnabled }) => {
		test.skip(!javaScriptEnabled, 'The native document is created with JavaScript');
		await page.goto('/app/memory?simple&base=opaque');
		await expect(page.getByTestId('host-status')).toHaveText('ready');
		const frame = await mount_native(page, '');
		await frame.evaluate(() => {
			history.replaceState({ native: 0 }, '');
			history.pushState({ native: 1 }, '');
			history.pushState({ native: 2 }, '');
		});
		await page.evaluate(() => {
			const result = document.createElement('pre');
			result.dataset.testid = 'native-history-result';
			result.textContent = 'pending';
			document.body.append(result);
			const frame = /** @type {HTMLIFrameElement} */ (
				document.querySelector('[data-testid="native-probe"]')
			);
			/** @param {string} event */
			function record(event) {
				const win = /** @type {Window} */ (frame.contentWindow);
				result.textContent = JSON.stringify({
					event,
					href: win.location.href,
					state: win.history.state,
					retained_document: win.document.documentElement.dataset.nativeReady === 'true',
					body: win.document.body?.textContent
				});
			}
			frame.contentWindow?.addEventListener('popstate', () => record('popstate'), { once: true });
			frame.addEventListener('load', () => record('load'), { once: true });
			frame.contentWindow?.history.back();
		});
		await expect(page.getByTestId('native-history-result')).not.toHaveText('pending');
		const result = JSON.parse(
			/** @type {string} */ (await page.getByTestId('native-history-result').textContent())
		);
		const report = JSON.stringify({ browser: test.info().project.name, result });
		console.log('Native written-document history control:', report);
		await test.info().attach('native-written-document-history', {
			body: report,
			contentType: 'application/json'
		});
		expect(result.href).toBe('about:blank');
		// Report whether the engine keeps a document.write-created Document. Kit
		// cannot handle popstate in a Document the browser discarded altogether.
		if (result.retained_document) expect(result.state).toEqual({ native: 1 });
	});
});

// Some engines report CORS diagnostics as pageerror even when fetch is caught.
test('native data document catches a denied fetch', async ({ page, javaScriptEnabled }) => {
	test.skip(variant !== 'memory' || !javaScriptEnabled, 'Requires the scripted inline fixture');
	/** @type {string[]} */
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.goto('/app/memory?simple&base=opaque');
	await expect(page.getByTestId('host-status')).toHaveText('ready');
	const target = new URL('/app/native-denied-fetch', page.url()).href;
	await page.route(target, (route) =>
		route.fulfill({ contentType: 'application/json', body: '{}' })
	);
	await page.evaluate((target) => {
		const output = document.createElement('pre');
		output.dataset.testid = 'native-fetch-result';
		output.textContent = 'pending';
		document.body.append(output);
		const iframe = document.createElement('iframe');
		window.addEventListener('message', (event) => {
			if (event.source === iframe.contentWindow && event.data?.type === 'native-fetch-result') {
				output.textContent = JSON.stringify(event.data);
			}
		});
		const html = `<script>
		const unhandled = [];
		addEventListener('unhandledrejection', event => unhandled.push(String(event.reason)));
		fetch(${JSON.stringify(target)}).then(
			() => setTimeout(() => parent.postMessage({ type: 'native-fetch-result', caught: false, unhandled }, '*'), 0)
		).catch(error => setTimeout(() => parent.postMessage({ type: 'native-fetch-result', caught: true, error: String(error), unhandled }, '*'), 0));
		<\/script>`;
		iframe.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
		document.body.append(iframe);
	}, target);
	await expect(page.getByTestId('native-fetch-result')).not.toHaveText('pending');
	const result = JSON.parse(
		/** @type {string} */ (await page.getByTestId('native-fetch-result').textContent())
	);
	const report = JSON.stringify({ browser: test.info().project.name, result, errors });
	console.log('Native caught CORS fetch control:', report);
	await test
		.info()
		.attach('native-caught-cors-fetch', { body: report, contentType: 'application/json' });
	expect(result.caught).toBe(true);
	expect(result.unhandled).toEqual([]);
});
