import { expect, test } from '@playwright/test';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Frame} Frame */
/** @type {WeakMap<Page, 'retained' | 'discarded' | 'host-navigation'>} */
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
	/** @type {{ native: number, length: number, state: { native: number } }[]} */
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
		// A detached child can precede the host's navigation event. Wait for the
		// actual traversal outcome instead of sampling after an arbitrary delay.
		const capture = () =>
			frame
				.evaluate(() => ({
					href: location.href,
					state: history.state,
					ready: document.readyState,
					retained:
						!!document.body?.dataset.nativeWritten ||
						document.documentElement.dataset.nativeReady === 'true',
					body: document.body?.textContent
				}))
				.catch((error) => ({ error: String(error) }));
		let snapshot = await capture();
		await expect
			.poll(
				async () => {
					snapshot = await capture();
					return (
						page.url() !== host ||
						(!('error' in snapshot) &&
							snapshot.state?.native === 1 &&
							snapshot.ready === 'complete')
					);
				},
				{ timeout: 10_000 }
			)
			.toBe(true);
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
		// No Kit siblings: iframe histories contribute to the same joint history.
		await control.route(page.url(), (route) =>
			route.fulfill({
				contentType: 'text/html',
				body: '<!doctype html><body>Native control</body>'
			})
		);
		await control.goto(page.url());
		await control.evaluate(() => {
			const iframe = document.createElement('iframe');
			iframe.dataset.testid = 'history-control';
			iframe.srcdoc = '<!doctype html><body>Initialize document</body>';
			iframe.onload = () => {
				if (iframe.hasAttribute('srcdoc')) {
					iframe.removeAttribute('srcdoc');
					iframe.src = 'about:blank';
					return;
				}
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
		// WebKit can replace the initial about:blank history entry instead of
		// appending. Compare Kit with that same native limitation below.
		if (observation.host_after !== observation.host) {
			expect(observation.host_after).toBe('about:blank');
			expect(observation.pushes.map((step) => step.state)).toEqual([
				{ native: 0 },
				{ native: 1 },
				{ native: 2 }
			]);
			expect(new Set(observation.pushes.map((step) => step.length)).size).toBe(1);
			retained.set(page, 'host-navigation');
			return 'host-navigation';
		}
		const result = observation.document;
		if ('error' in result) throw new Error(result.error);
		expect(result.href).toBe('about:blank');
		expect(result.state).toEqual({ native: 1 });
		const behavior = result.retained ? 'retained' : 'discarded';
		retained.set(page, behavior);
		return behavior;
	} finally {
		await control.close();
	}
}

/** Returns false only after asserting the native document-disposal boundary.
 * @param {Page} page @param {Frame} frame @param {string} transport
 */
export async function back(page, frame, transport) {
	const behavior = transport !== 'blank' ? 'retained' : await retains_written_document(page);
	expect(behavior).toBe('retained');
	await frame.evaluate(() => history.back());
	if (behavior === 'retained') return true;
	test.info().annotations.push({
		type: 'native-history-boundary',
		description:
			behavior === 'host-navigation'
				? 'Back leaves the host in both native and Kit documents; document persistence was not verified'
				: 'Back discards the written document in both native and Kit documents; document persistence was not verified'
	});
	if (behavior === 'host-navigation') {
		await expect(page).toHaveURL('about:blank');
		await expect(page.locator('body')).toBeEmpty();
		return false;
	}
	await expect(frame.locator('body')).toBeEmpty();
	expect(await frame.evaluate(() => location.href)).toBe('about:blank');
	await expect(frame.getByTestId('runtime')).toHaveCount(0);
	return false;
}

/** Match the same history operation in a document with no Kit runtime.
 * @param {Page} page
 * @param {'anchor' | 'push-state'} operation
 * @param {boolean} after_navigation
 */
export async function blank_history_delta(page, operation, after_navigation) {
	const control = await page.context().newPage();
	try {
		// No Kit siblings: iframe histories contribute to the same joint history.
		await control.route(page.url(), (route) =>
			route.fulfill({
				contentType: 'text/html',
				body: '<!doctype html><body>Native control</body>'
			})
		);
		await control.goto(page.url());
		await control.evaluate(
			({ operation, after_navigation }) => {
				const iframe = document.createElement('iframe');
				iframe.dataset.testid = 'fragment-control';
				iframe.srcdoc = '<!doctype html><body>Initialize document</body>';
				iframe.onload = () => {
				if (iframe.hasAttribute('srcdoc')) {
					iframe.removeAttribute('srcdoc');
					iframe.src = 'about:blank';
					return;
				}
					iframe.onload = null;
					const doc = /** @type {Document} */ (iframe.contentDocument);
					const script = doc.createElement('script');
					const html = `<body data-native-written=true><a id="anchor" href="about:blank#anchor">Anchor</a></body>`;
					script.textContent = `setTimeout(() => {
					document.open(); document.write(${JSON.stringify(html)}); document.close();
					history.replaceState({ native: 0 }, '');
					if (${after_navigation}) history.pushState({ native: 1 }, '');
					if (${JSON.stringify(operation)} === 'push-state') document.getElementById('anchor').onclick = event => {
						event.preventDefault(); history.pushState({ native: 2 }, '', undefined);
					};
				}, 0);`;
					doc.body.append(script);
				};
				document.body.append(iframe);
			},
			{ operation, after_navigation }
		);
		await expect(
			control.frameLocator('[data-testid="fragment-control"]').locator('body')
		).toHaveAttribute('data-native-written', 'true');
		const element = await control.getByTestId('fragment-control').elementHandle();
		const frame = await element?.contentFrame();
		if (!frame) throw new Error('Missing native fragment frame');
		const before = await frame.evaluate(() => history.length);
		await frame.locator('#anchor').click();
		await expect
			.poll(() => frame.evaluate(() => location.href))
			.toBe(operation === 'anchor' ? 'about:blank#anchor' : 'about:blank');
		if (operation === 'push-state')
			expect(await frame.evaluate(() => history.state)).toEqual({ native: 2 });
		const after = await frame.evaluate(() => history.length);
		const delta = after - before;
		expect([0, 1]).toContain(delta);
		console.log(
			'Native blank history operation:',
			JSON.stringify({ operation, after_navigation, before, after, delta })
		);
		return delta;
	} finally {
		await control.close();
	}
}
