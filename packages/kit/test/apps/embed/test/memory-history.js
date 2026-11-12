import { expect } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Frame} Frame */
/** @type {WeakMap<Page, boolean>} */
const retained = new WeakMap();

/** Observe from Node: WebKit may navigate the host, destroying DOM observers.
 * @param {Page} page @param {Frame} frame
 */
export async function observe_history(page, frame) {
	const host = page.url();
	await frame.addScriptTag({
		content: `
		const output = document.createElement('pre');
		output.dataset.testid = 'native-history-steps';
		const push = document.createElement('button');
		push.dataset.testid = 'native-history-push';
		push.textContent = 'Native push';
		push.onclick = () => {
			const steps = [];
			for (const native of [0, 1, 2]) {
				if (native === 0) history.replaceState({ native }, '');
				else history.pushState({ native }, '');
				steps.push({ native, length: history.length, state: history.state });
			}
			output.textContent = JSON.stringify(steps);
		};
		const back = document.createElement('button');
		back.dataset.testid = 'native-history-back';
		back.textContent = 'Native back';
		back.onclick = () => history.back();
		document.body.append(push, back, output);
	`
	});
	await frame.getByTestId('native-history-push').click();
	const pushes = JSON.parse(
		/** @type {string} */ (await frame.getByTestId('native-history-steps').textContent())
	);
	/** @type {{main: boolean, url: string}[]} */
	const navigations = [];
	/** @param {Frame} changed */
	const record = (changed) =>
		navigations.push({ main: changed === page.mainFrame(), url: changed.url() });
	page.on('framenavigated', record);
	try {
		await frame
			.getByTestId('native-history-back')
			.click()
			.catch(() => {});
		// Observation window, not a success condition. Assertions below still require traversal.
		await new Promise((resolve) => setTimeout(resolve, 1000));
		const snapshot = await frame
			.evaluate(() => ({
				href: location.href,
				state: history.state,
				retained:
					!!document.body?.dataset.nativeWritten ||
					document.documentElement.dataset.nativeReady === 'true',
				body: document.body?.textContent
			}))
			.catch((error) => ({ error: String(error) }));
		return { host, host_after: page.url(), pushes, navigations, document: snapshot };
	} finally {
		page.off('framenavigated', record);
	}
}

/** @param {Page} page */
async function retains_written_document(page) {
	if (retained.has(page)) return retained.get(page);
	const control = await page.context().newPage();
	try {
		await control.goto(page.url());
		await control.evaluate(() => {
			const iframe = document.createElement('iframe');
			iframe.dataset.testid = 'history-control';
			iframe.src = 'about:blank';
			iframe.onload = () => {
				iframe.onload = null;
				const doc = /** @type {Document} */ (iframe.contentDocument);
				const script = doc.createElement('script');
				script.textContent =
					'setTimeout(() => { document.open(); document.write("<body data-native-written=true>native control</body>"); document.close(); }, 0);';
				doc.body.append(script);
			};
			document.body.append(iframe);
		});
		await expect(
			control.frameLocator('[data-testid="history-control"]').locator('body')
		).toHaveAttribute('data-native-written', 'true');
		const element = await control.getByTestId('history-control').elementHandle();
		const frame = await element?.contentFrame();
		if (!frame) throw new Error('Missing native history frame');
		const observation = await observe_history(control, frame);
		console.log('Native history capability:', JSON.stringify(observation));
		expect(observation.host_after).toBe(observation.host);
		const result = observation.document;
		if ('error' in result) throw new Error(result.error);
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
