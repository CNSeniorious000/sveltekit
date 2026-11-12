import fs from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { decode_pathname } from '../../utils/url.js';
import { fetch_cache_url } from '../shared.js';

const state = vi.hoisted(() => ({ href: 'about:srcdoc#/a', opaque: true }));
vi.mock('./routing.js', () => ({
	memory_routing: false,
	get opaque_hash_routing() {
		return state.opaque;
	},
	get initial_url() {
		return new URL(state.href);
	},
	current_url: () => new URL(state.href)
}));
vi.mock('esm-env', () => ({ DEV: false }));

const document_urls = ['about:srcdoc', 'about:blank', 'data:text/html,app'];
const original_fetch = window.fetch;
const native_fetch = vi.fn(() => Promise.resolve(new Response('network')));
const client_source = fs.readFileSync(join(import.meta.dirname, 'client.js'), 'utf8');

beforeEach(() => {
	vi.resetModules();
	native_fetch.mockReset();
	native_fetch.mockImplementation(() => Promise.resolve(new Response('network')));
	window.fetch = native_fetch;
	document.head.innerHTML = '';
	document.body.innerHTML = '';
	// Vitest exposes the host Node URL on the main window. A fresh DOM window
	// supplies the browser URL parser, independent of the Node version.
	const frame = document.createElement('iframe');
	document.body.append(frame);
	vi.stubGlobal('URL', /** @type {typeof window} */ (frame.contentWindow).URL);
	frame.remove();
	// JSDOM does not expose this constructor. HTML anchors must take the HTML branch.
	vi.stubGlobal('SVGAElement', class {});
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	window.fetch = original_fetch;
	document.head.innerHTML = '';
	document.body.innerHTML = '';
});

/**
 * JSDOM does not navigate to these documents. Model the actual URL and effective
 * base separately; this is not a browser reload, sandbox, or History API test.
 * @param {string} href
 * @param {string} [base_uri]
 * @param {boolean} [hash]
 */
async function setup(href, base_uri = href, hash = true) {
	state.href = href;
	state.opaque = hash && ['about:', 'data:'].includes(new URL(href).protocol);
	vi.stubGlobal('location', new URL(href));
	vi.spyOn(document, 'baseURI', 'get').mockReturnValue(base_uri);
	return await import('./utils.js');
}

/** @param {string} href */
function anchor(href) {
	const a = document.createElement('a');
	a.setAttribute('href', href);
	return a;
}

/**
 * Exercise the private client helpers without booting a Svelte app. Their actual
 * source is used; only the route manifest and browser environment are doubles.
 * @param {typeof import('./utils.js')} utils
 * @param {string} [base]
 * @param {boolean} [hash]
 */
function client_helpers(utils, base = '/app', hash = true) {
	const names = [
		'get_navigation_intent',
		'get_url_path',
		'get_page_key',
		'resolve_route_url',
		'resolve_fetch_url',
		'resolve_intent'
	];
	const source = names.map((name) => {
		const match = client_source.match(
			new RegExp(`(?:export )?(?:async )?function ${name}\\([^]*?\\n\\}`)
		);
		if (!match) throw new Error(`Could not find client helper ${name}`);
		return match[0].replace(/^export /, '');
	});

	const initial_fetch = vi.fn(() => Promise.resolve(new Response('network')));
	const result = vm.runInNewContext(`${source.join('\n')}\n({ ${names.join(', ')} });`, {
		URL,
		Request,
		document,
		location,
		memory_routing: false,
		opaque_hash_routing: state.opaque,
		initial_url: new URL(state.href),
		current_url: () => new URL(state.href),
		origin: utils.origin,
		resolve_url: utils.resolve_url,
		is_external_url: utils.is_external_url,
		base,
		app: { hash },
		__SVELTEKIT_CLIENT_ROUTING__: true,
		get_rerouted_url: (/** @type {URL} */ url) => Promise.resolve(url),
		decode_pathname,
		fetch_cache_url,
		started: false,
		initial_fetch,
		routes: ['/a', '/b'].map((id) => ({
			id,
			exec: (/** @type {string} */ pathname) => (pathname === id ? {} : undefined)
		})),
		e: {
			navigation_external_url: () => {
				throw new Error('external URL');
			},
			navigation_route_missing: () => {
				throw new Error('missing route');
			}
		}
	});
	return { ...result, initial_fetch };
}

describe.each(document_urls)('hash routing in %s', (document_url) => {
	test.each(['', '/app'])('recognizes the startup route with base %j', async (base) => {
		const utils = await setup(`${document_url}#/a`);
		const client = client_helpers(utils, base);
		for (const fragment of ['', '#/a', '#/b?query=1#section']) {
			expect(utils.is_external_url(new URL(document_url + fragment), base, true)).toBe(false);
		}
		expect(await client.get_navigation_intent(new URL(`${document_url}#/a`), false)).toMatchObject({
			route: { id: '/a' }
		});
	});

	test.each([null, 'https://host.example/embed', 'https://app.example/resources/'])(
		'fragment links and goto retain the document URL with effective base %j',
		async (base_uri) => {
			const href = `${document_url}#/a`;
			const utils = await setup(href, base_uri ?? href);
			const client = client_helpers(utils);
			// Also model an inherited base: no explicit base element is required.
			expect(document.querySelector('base')).toBeNull();
			for (const reference of ['#/b', '#/b?query=1#section', ' \t#/b\n', `${document_url}#/b`]) {
				const expected = new URL(reference, href).href;
				const info = utils.get_link_info(anchor(reference), '/app', true);
				expect(info.external).toBe(false);
				expect(info.url?.href).toBe(expected);
				expect(utils.resolve_url(reference).href).toBe(expected);
				const intent = await client.resolve_intent(reference, 'goto');
				expect(intent.route.id).toBe('/b');
				expect(intent.url.href).toBe(expected);
			}

			const section = utils.get_link_info(anchor('#section'), '/app', true);
			expect(section.external).toBe(false);
			expect(section.url?.href).toBe(`${document_url}#/a#section`);
		}
	);

	test('does not reinterpret HTTP links or resolved URL objects as fragments', async () => {
		const utils = await setup(`${document_url}#/a`, 'https://host.example/embed');
		const url = new URL('https://host.example/embed#/b');
		expect(utils.resolve_url(url)).toBe(url);
		expect(utils.resolve_url('/app/#/b').href).toBe('https://host.example/app/#/b');
		expect(utils.is_external_url(url, '/app', true)).toBe(true);
		expect(utils.get_link_info(anchor('/app/#/b'), '/app', true).external).toBe(true);
		await expect(client_helpers(utils).resolve_intent(url, 'goto')).rejects.toThrow('external URL');
	});

	test.each([null, 'https://host.example/embed', 'https://app.example/resources/'])(
		'load fetch uses effective network base %j',
		async (base_uri) => {
			const href = `${document_url}#/a`;
			const utils = await setup(href, base_uri ?? href);
			const client = client_helpers(utils);
			for (const reference of ['data.json', '/api.json']) {
				if (base_uri) {
					const expected = new URL(reference, base_uri).href;
					expect(client.resolve_route_url(reference, new URL(href)).href).toBe(expected);
					const fetch = client.resolve_fetch_url(reference, undefined, new URL(href));
					expect(fetch.resolved.href).toBe(expected);
					expect(await (await fetch.promise).text()).toBe('network');
					expect(client.initial_fetch).toHaveBeenLastCalledWith(expected, undefined, expected);
				} else {
					expect(() => client.resolve_route_url(reference, new URL(href))).toThrow(
						'usable HTTP(S) base URL'
					);
				}
			}
			expect(client.resolve_route_url('https://api.example/data', new URL(href)).href).toBe(
				'https://api.example/data'
			);
		}
	);

	test('an unresolvable relative navigation gives a useful base error', async () => {
		const utils = await setup(document_url);
		expect(() => utils.resolve_url('/app/#/b')).toThrow('usable HTTP(S) base URL');
	});
});

test.each([
	['about:srcdoc', 'about:srcdoc?query=1#/a'],
	['about:srcdoc', 'custom:srcdoc#/a'],
	['about:srcdoc', 'about:blank#/a'],
	['about:blank', 'custom:blank#/a'],
	['data:text/html,app', 'data:text/html,app?query=1#/a'],
	['data:text/html,app', 'custom:text/html,app#/a'],
	['data:text/html,app', 'data:text/html,other#/a']
])('does not treat %s and %s as the same document', async (href, target) => {
	const { is_external_url } = await setup(href);
	expect(is_external_url(new URL(target), '', true)).toBe(true);
});

test.each([
	['target', '_blank'],
	['rel', 'external'],
	['download', ''],
	['data-sveltekit-reload', '']
])('native %s links retain the browser destination', async (attribute, value) => {
	const utils = await setup('about:srcdoc#/a', 'https://host.example/embed');
	// Use a real DOM base for a.href; the opaque document location is still a double.
	document.head.innerHTML = '<base href="https://host.example/embed">';
	const a = anchor('#/b');
	a.setAttribute(attribute, value);
	const info = utils.get_link_info(a, '/app', true);
	expect(info.url?.href).toBe('about:srcdoc#/b');
	expect(utils.get_native_link_url(a).href).toBe('https://host.example/embed#/b');
	if (attribute === 'target' || attribute === 'rel') expect(info.external).toBe(true);
	if (attribute === 'download') expect(info.download).toBe(true);
	if (attribute === 'data-sveltekit-reload') expect(utils.get_router_options(a).reload).toBe(true);
});

test('SVG fragment links use the raw href while native SVG links retain the base', async () => {
	const utils = await setup('about:srcdoc#/a', 'https://host.example/embed');
	const a = document.createElementNS('http://www.w3.org/2000/svg', 'a');
	a.setAttribute('href', '#/b');
	// JSDOM supplies an SVGElement rather than SVGAElement and omits these animated values.
	vi.stubGlobal('SVGAElement', class {});
	Object.defineProperty(SVGAElement, Symbol.hasInstance, {
		value: (/** @type {unknown} */ value) => value === a
	});
	Object.defineProperty(a, 'href', { value: { baseVal: '#/b' } });
	Object.defineProperty(a, 'target', { value: { baseVal: '' } });
	const svg = /** @type {SVGAElement} */ (a);
	expect(utils.get_link_info(svg, '/app', true).url?.href).toBe('about:srcdoc#/b');
	expect(utils.get_link_info(svg, '/app', true).external).toBe(false);
	expect(utils.get_native_link_url(svg).href).toBe('https://host.example/embed#/b');
});

test.each([
	['https://app.example/app/', '/app', 'https://app.example/app/#/a', false],
	['https://app.example/app/index.html', '/app', 'https://app.example/app/index.html#/a', false],
	[
		'https://app.example/app/index.html',
		'/app',
		'https://app.example/app/index.html?x=1#/a',
		false
	],
	['https://app.example/app/index.html', '/app', 'https://app.example/app/#/a', true],
	['https://app.example/app/', '/app', 'https://other.example/app/#/a', true],
	['https://app.example/application', '/app', 'https://app.example/application#/a', false],
	['https://app.example/app/', '/elsewhere', 'https://app.example/app/#/a', true],
	['file:///app/index.html', '/app', 'file:///app/index.html#/a', false]
])(
	'ordinary hash classification is unchanged: %s, base %s, target %s',
	async (href, base, target, external) => {
		const { is_external_url } = await setup(href);
		expect(is_external_url(new URL(target), base, true)).toBe(external);
	}
);

test.each([false, true])(
	'HTTP URL resolution retains its existing bases, hash=%s',
	async (hash) => {
		const href = 'https://app.example/app/index.html#/a';
		const base_uri = 'https://other.example/resources/';
		const utils = await setup(href, base_uri, hash);
		document.head.innerHTML = `<base href="${base_uri}">`;
		const client = client_helpers(utils, '/app', hash);
		for (const reference of ['#/b', '/app/#/b', 'data.json']) {
			expect(utils.resolve_url(reference).href).toBe(new URL(reference, base_uri).href);
			expect(utils.get_link_info(anchor(reference), '/app', hash).url?.href).toBe(
				new URL(reference, base_uri).href
			);
			expect(client.resolve_route_url(reference, new URL(href)).href).toBe(
				new URL(reference, href).href
			);
		}
	}
);

/** @param {string} url */
function seed(url) {
	const script = document.createElement('script');
	script.type = 'application/json';
	script.setAttribute('data-sveltekit-fetched', '');
	script.setAttribute('data-url', url);
	script.setAttribute('data-ttl', '100000');
	script.textContent = JSON.stringify({ body: 'cached', status: 200, headers: {} });
	document.body.append(script);
}

test.each(document_urls)(
	'relative POST invalidates the effective-base cache in %s',
	async (href) => {
		await setup(`${href}#/a`, 'https://app.example/resources/');
		const fetcher = await import('./fetcher.js');
		const target = 'https://app.example/resources/data.json';
		const unrelated = 'https://app.example/elsewhere/data.json';
		seed(target);
		seed(unrelated);
		await fetcher.initial_fetch(target);
		await fetcher.initial_fetch(unrelated);
		await window.fetch('data.json', { method: 'POST' });
		expect(native_fetch).toHaveBeenCalledWith('data.json', { method: 'POST' });
		expect(await (await fetcher.subsequent_fetch(target, target)).text()).toBe('network');
		expect(await (await fetcher.subsequent_fetch(unrelated, unrelated)).text()).toBe('cached');
	}
);

test.each(document_urls)('a baseless POST in %s rejects through native fetch', async (href) => {
	await setup(href);
	await import('./fetcher.js');
	const failure = new TypeError('native URL rejection');
	native_fetch.mockImplementationOnce(() => Promise.reject(failure));
	let result;
	expect(() => {
		result = window.fetch('/api', { method: 'POST' });
	}).not.toThrow();
	await expect(result).rejects.toBe(failure);
	expect(native_fetch).toHaveBeenCalledWith('/api', { method: 'POST' });
});
