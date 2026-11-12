import { expect } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Frame} Frame */
/** @type {WeakMap<Page, boolean>} */
const retained = new WeakMap();

/** Compare with the engine's native document.write lifetime, not its name.
 * @param {Page} page
 */
async function retains_written_document(page) {
	if (retained.has(page)) return retained.get(page);
	const control = await page.context().newPage();
	try {
		await control.goto(page.url());
		const result = await control.evaluate(
			() =>
				new Promise((resolve) => {
					const iframe = document.createElement('iframe');
					iframe.src = 'about:blank';
					iframe.onload = () => {
						iframe.onload = null;
						const doc = /** @type {Document} */ (iframe.contentDocument);
						const script = doc.createElement('script');
						script.textContent =
							'setTimeout(() => { document.open(); document.write("<body data-native-written=true>native control</body>"); document.close(); }, 0);';
						doc.body.append(script);
						// Wait for the asynchronously written document before creating entries.
						iframe.onload = () => {
							iframe.onload = null;
							const win = /** @type {Window} */ (iframe.contentWindow);
							win.history.replaceState({ native: 0 }, '');
							win.history.pushState({ native: 1 }, '');
							win.history.pushState({ native: 2 }, '');
							const record = () =>
								win.history.state?.native === 1 &&
								resolve({
									retained: win.document.body?.dataset.nativeWritten === 'true',
									state: win.history.state,
									href: win.location.href
								});
							win.addEventListener('popstate', record, { once: true });
							iframe.addEventListener('load', record, { once: true });
							win.history.back();
						};
					};
					document.body.append(iframe);
				})
		);
		expect(result.href).toBe('about:blank');
		expect(result.state).toEqual({ native: 1 });
		retained.set(page, result.retained);
		return result.retained;
	} finally {
		await control.close();
	}
}

/** Returns false only after asserting the native document-disposal boundary.
 * @param {Page} page @param {Frame} frame @param {string} transport
 */
export async function back(page, frame, transport) {
	const keeps_document = transport !== 'blank' || (await retains_written_document(page));
	await frame.evaluate(() => history.back());
	if (keeps_document) return true;
	await expect(frame.locator('body')).toBeEmpty();
	expect(await frame.evaluate(() => location.href)).toBe('about:blank');
	await expect(frame.getByTestId('runtime')).toHaveCount(0);
	return false;
}
