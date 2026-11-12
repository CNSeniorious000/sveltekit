import fs from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
// @ts-expect-error jsdom is available for tests, but this package does not include its declarations.
import { JSDOM as JSDOMImplementation } from 'jsdom';
import { afterEach, expect, test } from 'vitest';

/** @typedef {{ window: Window & { HTMLAnchorElement: typeof HTMLAnchorElement } }} TestDOM */
/** @type {new (html: string, options: { url: string }) => TestDOM} */
const JSDOM = JSDOMImplementation;

// Run the actual link, beforeNavigate, popstate and hashchange callbacks. These
// are source/JSDOM tests, not browser document.write persistence guarantees.
const read = (/** @type {string} */ file) =>
	fs.readFileSync(join(import.meta.dirname, file), 'utf8');
const client = read('client.js');
const utils = read('utils.js');
const routing = read('routing.js');

/** @param {string} source @param {string} name */
function named(source, name) {
	const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}$`, 'm'));
	if (!match) throw new Error(`Missing source function: ${name}`);
	return match[0];
}

const click_handler = client.slice(
	client.indexOf("container.addEventListener('click', async (event) => {"),
	client.indexOf("container.addEventListener('submit'")
);
const history_handlers = client.slice(
	client.indexOf("addEventListener('popstate', async (event) => {"),
	client.indexOf('// fix link[rel=icon]')
);
/** @type {TestDOM[]} */
const documents = [];
/** @type {Set<() => void>} */
const observers = new Set();
afterEach(() => {
	for (const cancel of observers) cancel();
	for (const dom of documents.splice(0)) dom.window.close();
});

/**
 * @param {{ href?: string; initial?: string; memory?: boolean; base_uri?: string; guard?: 'unload' | 'all' | 'none'; on_before?: (context: vm.Context) => void }} [options]
 */
function runtime({
	href = 'data:text/html,inline',
	initial = href,
	memory = true,
	base_uri,
	guard = 'unload',
	on_before
} = {}) {
	const dom = new JSDOM(
		'<a id="link" href="#one">Anchor</a><p id="one">One</p><p id="two">Two</p>',
		{ url: href }
	);
	documents.push(dom);
	const { document, history, location } = dom.window;
	if (base_uri) {
		const base = document.createElement('base');
		base.href = base_uri;
		document.head.append(base);
	}
	const page = { url: new URL(initial), state: { counter: 17 }, shallow: null };
	/** @type {import('../app/navigation/public.js').BeforeNavigate[]} */
	const events = [];
	/** @type {unknown[]} */
	const routes = [];
	/** @param {...unknown} args */
	function record_route(...args) {
		return Promise.resolve(routes.push(args));
	}
	const context = {
		URL,
		document,
		history,
		location,
		window: dom.window,
		DEV: false,
		levels: { false: 0 },
		container: document.documentElement,
		HTMLAnchorElement: dom.window.HTMLAnchorElement,
		SVGAElement: class {},
		memory_routing: memory,
		opaque_hash_routing: false,
		initial_url: new URL(initial),
		base: '/app',
		app: { hash: false },
		HISTORY_METADATA_KEY: 'sveltekit:metadata',
		current: { url: new URL(initial), route: { id: '/source' }, params: { id: 'original' } },
		page,
		untrack: (/** @type {() => unknown} */ fn) => fn(),
		current_history_index: 100,
		current_navigation_index: 100,
		current_reset_index: 100,
		history_info: { 100: { resetIndex: 100 } },
		has_navigated: false,
		hash_navigating: null,
		navigation_token: {},
		invalidation_token: {},
		is_navigating: false,
		strip_hash: (/** @type {URL} */ url) => url.href.split('#')[0],
		scroll_state: () => ({ x: 0, y: 20 }),
		update_page: (/** @type {object} */ values) => Object.assign(page, values),
		parse: JSON.parse,
		addEventListener: dom.window.addEventListener.bind(dom.window),
		before_navigate_callbacks: new Set([
			(/** @type {import('../app/navigation/public.js').BeforeNavigate} */ navigation) => {
				events.push(navigation);
				on_before?.(c);
				if (guard === 'all' || (guard === 'unload' && navigation.willUnload)) {
					navigation.cancel();
				}
			}
		]),
		noop() {},
		_goto: record_route,
		navigate: record_route,
		capture_snapshot() {},
		capture_navigation_snapshot() {},
		restore_navigation_snapshot() {},
		current_registrations: () => [],
		blur_active_element() {},
		set_navigation() {},
		get_navigation_intent: () => Promise.reject(new Error('Unexpected route resolution')),
		scrollTo() {},
		requestAnimationFrame: (/** @type {() => void} */ fn) => setTimeout(fn, 0),
		setTimeout
	};
	const c = vm.createContext(context);
	vm.runInContext(named(routing, 'current_url'), c);
	vm.runInContext('const origin = memory_routing ? initial_url.origin : location.origin;', c);
	for (const name of [
		'find_anchor',
		'get_native_link_url',
		'get_link_info',
		'is_external_url',
		'link_option',
		'parent_element',
		'get_router_options'
	]) {
		vm.runInContext(named(utils, name), c);
	}
	for (const name of [
		'get_history_metadata',
		'set_history_options',
		'capture_scroll',
		'create_navigation',
		'_before_navigate'
	]) {
		vm.runInContext(named(client, name), c);
	}
	vm.runInContext('function update_url(url) { current.url = url; update_page({ url }); }', c);
	vm.runInContext(click_handler + '\n' + history_handlers, c);
	history.replaceState(
		{
			'sveltekit:metadata': {
				historyIndex: 100,
				navigationIndex: 100,
				resetIndex: 100,
				state: JSON.stringify(page.state),
				persistState: false,
				...(memory && new URL(initial).origin !== 'null' ? { url: initial } : {})
			}
		},
		''
	);
	for (const element of document.querySelectorAll('p')) element.scrollIntoView = () => {};

	/**
	 * JSDOM queues native link navigation and its history events separately.
	 * Location can already have changed while history.state is still empty.
	 * Observe completion instead of racing those tasks with a fixed sleep.
	 * @param {'hashchange' | 'popstate'} type
	 * @param {(event: Event) => boolean} [matches]
	 */
	function observe(type, matches = () => true) {
		let cancel = () => {};
		const promise = new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				cleanup();
				reject(new Error(`Timed out waiting for ${type} at ${location.href}`));
			}, 3000);
			/** @param {Event} event */
			function listener(event) {
				if (!matches(event)) return;
				cleanup();
				resolve(undefined);
			}
			function cleanup() {
				clearTimeout(timer);
				dom.window.removeEventListener(type, listener);
				observers.delete(cancel);
			}
			cancel = () => {
				cleanup();
				resolve(undefined);
			};
			observers.add(cancel);
			dom.window.addEventListener(type, listener);
		});
		// Keep a timeout handled if an earlier assertion fails before it is awaited.
		void promise.catch(() => {});
		return { promise, cancel };
	}

	/** @type {Promise<unknown>[]} */
	const pending_clicks = [];
	/** @type {MouseEvent | undefined} */
	let click_event;
	document.documentElement.addEventListener('click', (event) => {
		click_event = event;
	});

	async function settle() {
		await Promise.all(pending_clicks.splice(0));
	}

	/** @param {'hashchange' | 'popstate'} type @param {() => void} action */
	async function after_event(type, action) {
		const completion = observe(type);
		action();
		await completion.promise;
	}

	/**
	 * @param {string} destination
	 * @param {{ replace?: boolean; target?: string; rel?: string; reload?: boolean }} [options]
	 */
	function click(destination, { replace = false, target = '', rel = '', reload = false } = {}) {
		const anchor = /** @type {HTMLAnchorElement} */ (document.querySelector('#link'));
		anchor.setAttribute('href', destination);
		anchor.setAttribute('data-sveltekit-replacestate', String(replace));
		anchor.setAttribute('data-sveltekit-reload', String(reload));
		anchor.target = target;
		anchor.rel = rel;
		const href = anchor.href;
		const pending = c.hash_navigating;
		const completion = observe(
			'hashchange',
			(event) => /** @type {HashChangeEvent} */ (event).newURL === href
		);
		anchor.click();
		if (c.hash_navigating && c.hash_navigating !== pending) {
			pending_clicks.push(completion.promise);
		} else {
			// Cancelled, ignored and repeated-hash clicks do not produce hashchange.
			completion.cancel();
		}
		return /** @type {MouseEvent} */ (click_event);
	}

	/** @param {string} suffix @param {number} index */
	function aligned(suffix, index) {
		expect(location.href).toBe(href + suffix);
		expect(c.current_url().href).toBe(href + suffix);
		expect(c.current.url.href).toBe(href + suffix);
		expect(page.url.href).toBe(href + suffix);
		expect(history.state['sveltekit:metadata'].historyIndex).toBe(index);
		expect(c.current_history_index).toBe(index);
		expect(c.is_navigating).toBe(false);
		expect(c.hash_navigating).toBeNull();
		expect(routes).toEqual([]);
		expect(page.state).toEqual({ counter: 17 });
		for (const field of ['url', 'replace', 'fulfil', 'reject', 'token']) {
			expect(history.state['sveltekit:metadata']).not.toHaveProperty(field);
		}
	}
	return {
		c,
		document,
		history,
		location,
		page,
		events,
		routes,
		click,
		aligned,
		settle,
		after_event
	};
}

/**
 * Model a completed alpha -> beta route navigation, so the active logical URL
 * differs from both the initial route and the unchanged document base. Route
 * loading is stubbed by this harness; the fragment/history callbacks are real.
 * @param {string} href
 * @param {'unload' | 'all'} [guard]
 */
function routed_runtime(href, guard = 'unload') {
	const initial = 'https://app.example/app/alpha?source=initial';
	const logical = 'https://app.example/app/beta?source=current';
	const r = runtime({ href, initial, base_uri: initial, guard });
	r.history.pushState(
		{
			'sveltekit:metadata': {
				...r.history.state['sveltekit:metadata'],
				historyIndex: 101,
				navigationIndex: 101,
				url: logical
			}
		},
		''
	);
	r.c.current_history_index = 101;
	r.c.current_navigation_index = 101;
	r.c.history_info[101] = { resetIndex: 100 };
	r.c.has_navigated = true;
	r.c.current.url = new URL(logical);
	r.page.url = new URL(logical);
	return { ...r, logical, initial };
}

/**
 * @param {ReturnType<typeof routed_runtime>} r
 * @param {string} href
 * @param {string} suffix
 * @param {number} index
 */
function logical_fragment_aligned(r, href, suffix, index) {
	expect(r.location.href).toBe(href + suffix);
	expect(r.c.current_url().href).toBe(r.logical + suffix);
	expect(r.c.current.url.href).toBe(r.logical + suffix);
	expect(r.page.url.href).toBe(r.logical + suffix);
	expect(r.document.baseURI).toBe(r.initial);
	expect(r.history.state['sveltekit:metadata']).toMatchObject({
		historyIndex: index,
		navigationIndex: 101,
		url: r.logical + suffix,
		state: JSON.stringify({ counter: 17 })
	});
	expect(r.c.current_history_index).toBe(index);
	expect(r.c.current_navigation_index).toBe(101);
	expect(r.c.current.route).toEqual({ id: '/source' });
	expect(r.c.current.params).toEqual({ id: 'original' });
	expect(r.page.state).toEqual({ counter: 17 });
	expect(r.c.is_navigating).toBe(false);
	expect(r.c.hash_navigating).toBeNull();
	expect(r.routes).toEqual([]);
	for (const field of ['replace', 'fulfil', 'reject', 'token']) {
		expect(r.history.state['sveltekit:metadata']).not.toHaveProperty(field);
	}
}

for (const options of [{}, { rel: 'external' }]) {
	test(`an already-current actual fragment ${JSON.stringify(options)} synchronizes a different logical hash without adding history`, async () => {
		const r = routed_runtime('about:srcdoc#one');
		const logical = r.logical + '#different';
		const metadata = {
			...r.history.state['sveltekit:metadata'],
			url: logical,
			pageUrl: r.initial,
			persistState: true
		};
		r.history.replaceState(
			{
				...r.history.state,
				host: { selection: 'keep' },
				'sveltekit:metadata': metadata
			},
			''
		);
		r.c.current.url = new URL(logical);
		r.page.url = new URL(logical);
		expect(r.c.current_url().href).toBe(logical);
		const length = r.history.length;
		let scrolled = 0;
		/** @type {HTMLElement} */ (r.document.getElementById('one')).scrollIntoView = () => {
			scrolled += 1;
		};

		r.click('about:srcdoc#one', options);
		await r.settle();
		expect(scrolled).toBe(1);
		expect(r.location.href).toBe('about:srcdoc#one');
		expect(r.history.length).toBe(length);
		expect(r.c.current_history_index).toBe(101);
		expect(r.events).toHaveLength('rel' in options ? 1 : 0);
		if ('rel' in options) {
			expect(r.events[0].willUnload).toBe(false);
			expect(r.events[0].to?.url.href).toBe('about:srcdoc#one');
			await expect(r.events[0].complete).resolves.toBeUndefined();
		}
		// No native hashchange fires for a repeated actual fragment. The existing
		// entry still needs to reflect the fragment selected on the logical route.
		logical_fragment_aligned(r, 'about:srcdoc', '#one', 101);
		// Synchronizing the fragment must preserve host state and existing shallow
		// entry fields, not rebuild the entry with only the logical URL.
		expect(r.history.state).toEqual({
			host: { selection: 'keep' },
			'sveltekit:metadata': { ...metadata, url: r.logical + '#one' }
		});
	});
}

for (const mode of ['before initialization', 'rendered route', 'shallow route']) {
	test(`current_url falls back to the ${mode} without modifying unknown history state`, () => {
		const r = routed_runtime('about:srcdoc#one');
		r.page.url = new URL(mode === 'before initialization' ? 'a:' : r.logical + '#different');
		const shallow_url = 'https://app.example/app/modal?view=open';
		r.c.page.shallow =
			mode === 'shallow route' ? { url: new URL(shallow_url + '#different') } : null;
		const expected =
			mode === 'before initialization'
				? r.initial
				: mode === 'shallow route'
					? shallow_url
					: r.logical;
		const original_page = r.page.url.href;
		const original_shallow = r.c.page.shallow?.url.href;
		const length = r.history.length;
		for (const state of [
			null,
			{ owner: 'host', position: 7 },
			{ owner: 'host', 'sveltekit:metadata': { historyIndex: 77, state: '{"host":true}' } }
		]) {
			r.history.replaceState(state, '');
			const retained_state = r.history.state;
			expect(r.c.current_url().href).toBe(expected + '#one');
			expect(r.history.state).toBe(retained_state);
			expect(r.history.state).toEqual(state);
			expect(r.history.length).toBe(length);
			expect(r.c.current_history_index).toBe(101);
			expect(r.page.url.href).toBe(original_page);
			expect(r.c.page.shallow?.url.href).toBe(original_shallow);
		}
	});
}

for (const href of ['about:srcdoc', 'data:text/html,inline']) {
	for (const options of [{}, { rel: 'external' }]) {
		test(`${href}: actual fragments ${JSON.stringify(options)} preserve additional hash characters and repeat the complete target`, async () => {
			const r = routed_runtime(href);
			const target = r.document.createElement('p');
			target.id = 'one#sub2';
			let scrolled = 0;
			target.scrollIntoView = () => {
				scrolled += 1;
			};
			r.document.body.append(target);

			r.click(`${href}#one#sub1`, options);
			await r.settle();
			logical_fragment_aligned(r, href, '#one#sub1', 102);
			r.click(`${href}#one#sub2`, options);
			await r.settle();
			logical_fragment_aligned(r, href, '#one#sub2', 103);
			expect(r.history.length).toBe(4);

			const previous_scrolls = scrolled;
			r.click(`${href}#one#sub2`, options);
			await r.settle();
			logical_fragment_aligned(r, href, '#one#sub2', 103);
			expect(r.history.length).toBe(4);
			expect(scrolled).toBe(previous_scrolls + 1);
			expect(r.events).toHaveLength('rel' in options ? 3 : 0);
			if ('rel' in options) {
				expect(r.events.map((event) => event.to?.url.href)).toEqual([
					`${href}#one#sub1`,
					`${href}#one#sub2`,
					`${href}#one#sub2`
				]);
				for (const event of r.events) {
					expect(event.willUnload).toBe(false);
					await expect(event.complete).resolves.toBeUndefined();
				}
			}
		});
	}

	for (const options of [{}, { reload: true }, { rel: 'external' }, { target: '_self' }]) {
		test(`${href}: actual fragments ${JSON.stringify(options)} retain the current logical route through replace and traversal`, async () => {
			const r = routed_runtime(href);
			const opt_out = 'rel' in options || 'target' in options;
			r.click(`${href}#one`, options);
			await r.settle();
			logical_fragment_aligned(r, href, '#one', 102);
			expect(r.history.length).toBe(3);
			expect(r.events).toHaveLength(opt_out ? 1 : 0);
			if (opt_out) {
				expect(r.events[0].willUnload).toBe(false);
				expect(r.events[0].to?.url.href).toBe(`${href}#one`);
				await expect(r.events[0].complete).resolves.toBeUndefined();
			}

			r.click(`${href}#one`, options);
			await r.settle();
			logical_fragment_aligned(r, href, '#one', 102);
			expect(r.history.length).toBe(3);
			if (opt_out) await expect(r.events[1].complete).resolves.toBeUndefined();

			r.click(`${href}#two`, { ...options, replace: true });
			await r.settle();
			// Native opt-outs retain precedence over data-sveltekit-replacestate.
			const replaced_index = opt_out ? 103 : 102;
			logical_fragment_aligned(r, href, '#two', replaced_index);
			expect(r.history.length).toBe(opt_out ? 4 : 3);
			if (opt_out) await expect(r.events[2].complete).resolves.toBeUndefined();

			await r.after_event('popstate', () => r.history.back());
			logical_fragment_aligned(r, href, opt_out ? '#one' : '', opt_out ? 102 : 101);
			await r.after_event('popstate', () => r.history.forward());
			logical_fragment_aligned(r, href, '#two', replaced_index);
			expect(r.events).toHaveLength(opt_out ? 3 : 0);
		});
	}

	for (const options of [{ rel: 'external' }, { target: '_self' }]) {
		test(`${href}: cancelling an actual fragment ${JSON.stringify(options)} preserves the logical route and history`, async () => {
			const r = routed_runtime(href, 'all');
			expect(r.click(`${href}#one`, options).defaultPrevented).toBe(true);
			expect(r.events).toHaveLength(1);
			expect(r.events[0].willUnload).toBe(false);
			expect(r.events[0].to?.url.href).toBe(`${href}#one`);
			await expect(r.events[0].complete).rejects.toThrow('navigation cancelled');
			await r.settle();
			logical_fragment_aligned(r, href, '', 101);
			expect(r.history.length).toBe(2);
		});
	}

	test(`${href}: an empty actual fragment with reload completes without unloading the logical route`, async () => {
		const r = routed_runtime(href);
		r.click(`${href}#`, { reload: true });
		expect(r.events).toHaveLength(1);
		expect(r.events[0].willUnload).toBe(false);
		await r.settle();
		await expect(r.events[0].complete).resolves.toBeUndefined();
		logical_fragment_aligned(r, href, '#', 102);
	});

	test(`${href}: script hash changes immediately retain the latest logical pathname`, async () => {
		const r = routed_runtime(href);
		for (const hash of ['#one', '#two']) {
			await r.after_event('hashchange', () => {
				if (hash === '#one') r.location.hash = hash;
				else r.location.replace(href + hash);
			});
			expect(r.location.href).toBe(href + hash);
			expect(r.c.current_url().href).toBe(r.logical + hash);
			expect(r.c.current.url.href).toBe(r.logical + hash);
			expect(r.page.url.href).toBe(r.logical + hash);
			expect(r.page.state).toEqual({ counter: 17 });
			expect(r.routes).toEqual([]);
			expect(r.events).toEqual([]);
		}
		// Arbitrary script-created hash entries do not carry Kit metadata. This
		// checks immediate synchronization, not unguaranteed Back/Forward behavior.
	});

	for (const options of [{ reload: true }, { rel: 'external' }, { target: '_self' }]) {
		test(`${href}: bare fragments ${JSON.stringify(options)} still unload toward the HTTP document base`, async () => {
			const r = routed_runtime(href);
			expect(r.click('#one', options).defaultPrevented).toBe(true);
			expect(r.events).toHaveLength(1);
			expect(r.events[0].willUnload).toBe(true);
			expect(r.events[0].to?.url.href).toBe(`${r.initial}#one`);
			await expect(r.events[0].complete).rejects.toThrow('navigation cancelled');
			await r.settle();
			logical_fragment_aligned(r, href, '', 101);
		});
	}

	test(`${href}: an ordinary bare fragment still routes toward the HTTP document base`, async () => {
		const r = routed_runtime(href);
		r.click('#one');
		await expect.poll(() => r.routes.length, { timeout: 3000 }).toBe(1);
		expect(/** @type {URL[]} */ (r.routes[0])[0].href).toBe(`${r.initial}#one`);
		expect(r.location.href).toBe(href);
		expect(r.events).toEqual([]);
	});
}

for (const href of ['data:text/html,inline', 'about:srcdoc']) {
	test(`${href}: native fragment callbacks keep replace and popstate metadata aligned`, async () => {
		const r = runtime({ href });
		r.click('#one');
		await r.settle();
		r.aligned('#one', 101);
		r.click('#two', { replace: true });
		await r.settle();
		r.aligned('#two', 101);
		expect(r.history.length).toBe(2);
		await r.after_event('popstate', () => r.history.back());
		r.aligned('', 100);
		await r.after_event('popstate', () => r.history.forward());
		r.aligned('#two', 101);
		expect(r.events).toEqual([]);
	});
}

test('about:blank source callbacks preserve state on click and replace', async () => {
	// A browser document.write-created iframe may discard its document on Back.
	// Do not infer that browser lifecycle from this JSDOM source-level check.
	const r = runtime({ href: 'about:blank' });
	r.click('#one');
	await r.settle();
	r.aligned('#one', 101);
	r.click('#two', { replace: true });
	await r.settle();
	r.aligned('#two', 101);
});

test.each([{ rel: 'external' }, { target: '_self' }])(
	'explicit native opt-out %j retains a non-unloading, completing beforeNavigate hook',
	async (options) => {
		const r = runtime();
		r.click('#one', options);
		expect(r.events).toHaveLength(1);
		expect(r.events[0].willUnload).toBe(false);
		await r.settle();
		await expect(r.events[0].complete).resolves.toBeUndefined();
		r.aligned('#one', 101);
		r.click('#one', options);
		await expect(r.events[1].complete).resolves.toBeUndefined();
		r.aligned('#one', 101);
		expect(r.history.length).toBe(2);
	}
);

test('a native opt-out hook can cancel the fragment without leaving pending state', async () => {
	const r = runtime({ guard: 'all' });
	expect(r.click('#one', { rel: 'external' }).defaultPrevented).toBe(true);
	await expect(r.events[0].complete).rejects.toThrow('navigation cancelled');
	await r.settle();
	r.aligned('', 100);
	expect(r.history.length).toBe(1);
});

test('native opt-out keeps precedence over replace, just as for ordinary HTTP links', async () => {
	const r = runtime();
	r.click('#one', { rel: 'external', replace: true });
	await r.settle();
	await expect(r.events[0].complete).resolves.toBeUndefined();
	r.aligned('#one', 101);
	expect(r.history.length).toBe(2);
});

test('a newer fragment rejects the overwritten native hook and completes the latest one', async () => {
	const r = runtime();
	r.click('#one', { rel: 'external' });
	r.click('#two', { rel: 'external' });
	await expect(r.events[0].complete).rejects.toThrow('navigation aborted');
	await r.settle();
	await expect(r.events[1].complete).resolves.toBeUndefined();
	r.aligned('#two', 101);
});

test('a newer navigation token rejects a pending fragment without overwriting its state', async () => {
	const r = runtime();
	r.click('#one', { rel: 'external' });
	// Model the token transition made synchronously by a newer navigation.
	r.c.navigation_token = {};
	await r.settle();
	await expect(r.events[0].complete).rejects.toThrow('navigation aborted');
	expect(r.c.hash_navigating).toBeNull();
	expect(r.c.current_history_index).toBe(100);
	expect(r.history.state).toBeUndefined();
});

test('a normal hash reload option retains the existing no-hook behavior', async () => {
	const r = runtime();
	r.click('#one', { reload: true });
	await r.settle();
	r.aligned('#one', 101);
	expect(r.events).toEqual([]);
});

test('an empty fragment with reload retains its hook and completes', async () => {
	const r = runtime();
	r.click('#', { reload: true });
	await r.settle();
	await expect(r.events[0].complete).resolves.toBeUndefined();
	expect(r.events[0].willUnload).toBe(false);
	r.aligned('#', 101);
});

test('another target is ignored before navigation hooks', async () => {
	const r = runtime();
	r.click('#one', { target: '_blank' });
	await r.settle();
	r.aligned('', 100);
	expect(r.events).toEqual([]);
});

test('HTTP-backed logical routing retains native opt-out unload behavior', async () => {
	const r = runtime({
		href: 'about:srcdoc',
		initial: 'https://app.example/app/source',
		base_uri: 'https://app.example/app/source'
	});
	expect(r.click('#one', { rel: 'external' }).defaultPrevented).toBe(true);
	expect(r.events[0].willUnload).toBe(true);
	await expect(r.events[0].complete).rejects.toThrow('navigation cancelled');
	expect(r.location.href).toBe('about:srcdoc');
	expect(r.c.current_url().href).toBe('https://app.example/app/source');
});

test('ordinary HTTP opt-out hook behavior is unchanged', async () => {
	const r = runtime({ href: 'https://app.example/app/source', memory: false });
	expect(r.click('#one', { target: '_self' }).defaultPrevented).toBe(true);
	expect(r.events[0].willUnload).toBe(true);
	await expect(r.events[0].complete).rejects.toThrow('navigation cancelled');
	expect(r.location.href).toBe('https://app.example/app/source');
});

test('a newer navigation started inside beforeNavigate prevents the old fragment', async () => {
	const r = runtime({
		on_before: (context) => {
			context.navigation_token = {};
		}
	});
	expect(r.click('#one', { rel: 'external' }).defaultPrevented).toBe(true);
	await expect(r.events[0].complete).rejects.toThrow('navigation aborted');
	await r.settle();
	r.aligned('', 100);
	expect(r.history.length).toBe(1);
});
