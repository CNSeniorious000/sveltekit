import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import * as devalue from 'devalue';

const state = vi.hoisted(() => ({
	memory: true,
	initial_url: new URL('https://app.example/app/route?x=1'),
	prerender_responses: /** @type {Record<string, any>} */ ({})
}));

// Exercise the real request producers, isolating only router and hydration state.
// The initial memory URL is obtained from the real effective-base initialization below.
vi.mock('../routing.js', async (import_original) => ({
	...(await import_original()),
	get memory_routing() {
		return state.memory;
	},
	get initial_url() {
		return state.initial_url;
	},
	current_url: () => new URL(state.initial_url)
}));

vi.mock(new URL('../client.js', import.meta.url).pathname, () => ({
	app: { encoders: {}, decoders: {} },
	query_map: new Map(),
	query_responses: {},
	live_query_map: new Map(),
	get prerender_responses() {
		return state.prerender_responses;
	},
	_goto: vi.fn(),
	handle_error: (/** @type {Error} */ error) => ({ message: error.message, status: 500 })
}));

vi.mock('#app/paths', () => ({ base: '/app', app_dir: '_app' }));

vi.mock('#app/state/client', () => ({
	get page() {
		return { url: state.initial_url };
	},
	navigating: null,
	notify_version: vi.fn()
}));

const endpoint = '/app/_app/remote/hash/example';
const app_endpoint = `https://app.example${endpoint}`;
const original_url = location.href;
// Vitest exposes the active JSDOM instance, so these tests can also cover an
// opaque document whose relative requests stop resolving after base removal.
const dom = /** @type {{ reconfigure: (options: { url: string }) => void }} */ (
	/** @type {any} */ (globalThis).jsdom
);

describe.each(['memory', 'pathname', 'hash'])(
	'%s remote transport after the document base changes',
	(mode) => {
		/** @type {typeof import('./shared.svelte.js')} */
		let shared;
		/** @type {typeof import('./command.svelte.js').command} */
		let command;
		/** @type {typeof import('./prerender.svelte.js').prerender} */
		let prerender;
		/** @type {typeof import('./query-live/iterator.js').create_live_iterator} */
		let create_live_iterator;
		/** @type {string[]} */
		let requests;
		/** @type {ReturnType<typeof vi.fn<typeof fetch>>} */
		let fetch_mock;
		/** @type {{ match: ReturnType<typeof vi.fn<Cache['match']>>, put: ReturnType<typeof vi.fn<Cache['put']>>, delete: ReturnType<typeof vi.fn<Cache['delete']>> }} */
		let cache;

		beforeEach(async () => {
			vi.resetModules();
			state.memory = mode === 'memory';
			state.prerender_responses = {};
			dom.reconfigure({
				url: state.memory
					? 'about:srcdoc'
					: `https://host.example/app/${mode === 'hash' ? '#/route?x=1' : 'route?x=1'}`
			});
			document.head.innerHTML = '<base href="https://app.example/resources/">';
			vi.stubGlobal('__SVELTEKIT_DEV__', false);

			const { get_initial_url } = await import('../routing.js');
			state.initial_url = state.memory
				? get_initial_url(location.href, document.baseURI, '/app/route?x=1')
				: new URL(location.href);

			requests = [];
			// Model browser URL resolution without making network requests. This does
			// not test CORS, credentials on the wire, or a browser's Cache API.
			fetch_mock = vi.fn((url) =>
				Promise.resolve().then(() => {
					requests.push(new URL(String(url), document.baseURI).href);
					return Response.json({ type: 'result', data: devalue.stringify({ _: 'network' }) });
				})
			);
			vi.stubGlobal('fetch', fetch_mock);
			cache = {
				match: vi.fn(() => Promise.resolve(undefined)),
				put: vi.fn(() => Promise.resolve()),
				delete: vi.fn(() => Promise.resolve(true))
			};
			vi.stubGlobal('caches', {
				open: vi.fn(() => Promise.resolve(cache)),
				keys: vi.fn(() => Promise.resolve([])),
				delete: vi.fn(() => Promise.resolve(true))
			});

			shared = await import('./shared.svelte.js');
			({ command } = await import('./command.svelte.js'));
			({ prerender } = await import('./prerender.svelte.js'));
			({ create_live_iterator } = await import('./query-live/iterator.js'));
		});

		afterEach(() => {
			vi.unstubAllGlobals();
			document.head.innerHTML = '';
			dom.reconfigure({ url: original_url });
		});

		/** @param {string} change */
		function change_base(change) {
			const base = /** @type {HTMLBaseElement} */ (document.querySelector('base'));
			if (change === 'removed') base.remove();
			else base.href = 'https://cdn.example/assets/';
		}

		/** @param {string} [suffix] */
		function expected_url(suffix = '') {
			return (state.memory ? app_endpoint : endpoint) + suffix;
		}

		/** @param {string} [suffix] */
		function expect_fetch(suffix = '') {
			expect(fetch_mock).toHaveBeenCalledOnce();
			expect(fetch_mock.mock.calls[0][0]).toBe(expected_url(suffix));
			expect(requests).toEqual([
				state.memory ? app_endpoint + suffix : new URL(endpoint + suffix, document.baseURI).href
			]);
		}

		test.each([
			'//other.example/app/_app/remote/example',
			'/\\other.example/app/_app/remote/example',
			'https://app.example/app/_app/remote/example'
		])('root-relative endpoint %s cannot replace the memory origin', async (path) => {
			const expected = state.memory
				? new URL(path.startsWith('/') ? state.initial_url.origin + path : path).href
				: path;
			expect(shared.resolve_remote_url(path)).toBe(expected);
			expect(shared.resolve_remote_url(expected)).toBe(expected);
			await shared.remote_request(path);
			expect(fetch_mock.mock.calls[0][0]).toBe(expected);
			if (state.memory) expect(new URL(requests[0]).origin).toBe(state.initial_url.origin);
		});

		if (mode === 'memory') {
			test.each(['about:srcdoc', 'about:blank', 'data:text/html,inline'])(
				'serialized prerender data needs no network base: %s',
				async (href) => {
					state.initial_url = new URL(href);
					state.prerender_responses['hash/example/'] = { v: 'ssr' };
					await expect(Promise.resolve(prerender('hash/example')(undefined))).resolves.toBe('ssr');
					expect(cache.match).not.toHaveBeenCalled();
					expect(cache.put).not.toHaveBeenCalled();
					expect(fetch_mock).not.toHaveBeenCalled();
				}
			);
			test.each(['about:srcdoc', 'about:blank', 'data:text/html,inline'])(
				'a prerender cache miss still requires a network base: %s',
				async (href) => {
					state.initial_url = new URL(href);
					await expect(Promise.resolve(prerender('hash/example')(undefined))).rejects.toMatchObject(
						{ body: { message: expect.stringContaining('usable HTTP(S) base URL') } }
					);
					expect(cache.match).not.toHaveBeenCalled();
					expect(cache.put).not.toHaveBeenCalled();
					expect(fetch_mock).not.toHaveBeenCalled();
				}
			);
		}

		describe.each(['changed', 'removed'])('base %s', (change) => {
			beforeEach(() => change_base(change));

			test('remote_request keeps RequestInit and its body, headers and credentials intact', async () => {
				const body = new Blob(['synthetic input']);
				const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
				const controller = new AbortController();
				/** @type {RequestInit} */
				const init = {
					method: 'POST',
					body,
					headers,
					credentials: 'omit',
					mode: 'cors',
					signal: controller.signal
				};
				await expect(shared.remote_request(endpoint, init)).resolves.toEqual({ _: 'network' });
				expect_fetch();
				expect(fetch_mock.mock.calls[0][1]).toBe(init);
				expect(headers.has('origin')).toBe(false);
			});

			test('command retains its body and route headers without changing fetch defaults', async () => {
				await expect(command('hash/example')({ message: 'synthetic input' })).resolves.toBe(
					'network'
				);
				expect_fetch();
				const init = /** @type {RequestInit} */ (fetch_mock.mock.calls[0][1]);
				expect(init).toEqual({
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'x-sveltekit-pathname': state.initial_url.pathname,
						'x-sveltekit-search': state.initial_url.search
					},
					body: expect.any(String)
				});
				const body = JSON.parse(/** @type {string} */ (init.body));
				expect(devalue.parse(atob(body.payload))).toEqual({ message: 'synthetic input' });
				expect(body.refreshes).toEqual([]);
			});

			test('query.live resolves its independent fetch and keeps the SSE signal and headers', async () => {
				fetch_mock.mockImplementationOnce((url) => {
					requests.push(new URL(String(url), document.baseURI).href);
					return Promise.resolve(
						new Response(
							`data: ${JSON.stringify({ type: 'result', result: devalue.stringify(42) })}\n\n`,
							{ headers: { 'Content-Type': 'text/event-stream' } }
						)
					);
				});
				const controller = new AbortController();
				const on_connect = vi.fn();
				const iterator = create_live_iterator('hash/example', 'payload', controller, on_connect);
				await expect(iterator.next()).resolves.toEqual({ value: 42, done: false });
				await expect(iterator.next()).resolves.toEqual({ value: undefined, done: true });
				expect(on_connect).toHaveBeenCalledOnce();
				expect_fetch('?payload=payload');
				expect(fetch_mock.mock.calls[0][1]).toEqual({
					headers: { accept: 'text/event-stream' },
					signal: controller.signal
				});
			});

			test('prerender cache misses match, fetch and put the same URL', async () => {
				await expect(Promise.resolve(prerender('hash/example')(undefined))).resolves.toBe(
					'network'
				);
				expect_fetch();
				expect(cache.match).toHaveBeenCalledExactlyOnceWith(expected_url());
				expect(cache.put).toHaveBeenCalledExactlyOnceWith(expected_url(), expect.any(Response));
				expect(devalue.parse(await cache.put.mock.calls[0][1].text())).toBe('network');
				expect(cache.delete).not.toHaveBeenCalled();
			});

			test('prerender cache hits retain the URL and avoid fetch', async () => {
				cache.match.mockResolvedValueOnce(new Response(devalue.stringify('cached')));
				await expect(Promise.resolve(prerender('hash/example')(undefined))).resolves.toBe('cached');
				expect(cache.match).toHaveBeenCalledExactlyOnceWith(expected_url());
				expect(cache.put).not.toHaveBeenCalled();
				expect(fetch_mock).not.toHaveBeenCalled();
			});

			test('invalid prerender cache entries are deleted using the same URL', async () => {
				cache.match.mockResolvedValueOnce(new Response('invalid devalue'));
				await expect(Promise.resolve(prerender('hash/example')(undefined))).resolves.toBe(
					'network'
				);
				expect_fetch();
				expect(cache.match).toHaveBeenCalledExactlyOnceWith(expected_url());
				expect(cache.delete).toHaveBeenCalledExactlyOnceWith(expected_url());
				expect(cache.put).toHaveBeenCalledExactlyOnceWith(expected_url(), expect.any(Response));
			});

			test('SSR prerender responses populate the cache without fetching', async () => {
				state.prerender_responses['hash/example/'] = { v: 'ssr' };
				await expect(Promise.resolve(prerender('hash/example')(undefined))).resolves.toBe('ssr');
				expect(cache.put).toHaveBeenCalledExactlyOnceWith(expected_url(), expect.any(Response));
				expect(devalue.parse(await cache.put.mock.calls[0][1].text())).toBe('ssr');
				expect(cache.match).not.toHaveBeenCalled();
				expect(fetch_mock).not.toHaveBeenCalled();
			});

			test('application window.fetch still receives relative URLs and uses the live document base', async () => {
				expect(window.fetch).toBe(fetch_mock);
				if (state.memory && change === 'removed') {
					await expect(window.fetch('asset.json')).rejects.toThrow();
				} else {
					await window.fetch('asset.json');
					expect(requests).toEqual([new URL('asset.json', document.baseURI).href]);
				}
				expect(fetch_mock).toHaveBeenCalledExactlyOnceWith('asset.json');
			});
		});
	}
);
