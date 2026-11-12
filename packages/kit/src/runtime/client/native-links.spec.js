import fs from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ memory: true }));
vi.mock('./routing.js', () => ({
	opaque_hash_routing: false,
	get memory_routing() {
		return state.memory;
	},
	initial_url: new URL('https://app.example/app/current'),
	current_url: () => new URL('https://app.example/app/current')
}));

const { get_link_info, get_native_link_url, resolve_url } = await import('./utils.js');

beforeEach(() => {
	// JSDOM does not expose this constructor; HTML anchors must take the HTML branch.
	vi.stubGlobal('SVGAElement', class {});
	document.head.innerHTML = '<base href="https://app.example/resources/">';
});

afterEach(() => {
	vi.unstubAllGlobals();
	document.head.innerHTML = '';
});

for (const memory of [true, false]) {
	test.each([
		['relative', 'https://app.example/resources/relative'],
		['../sibling?x=1', 'https://app.example/sibling?x=1'],
		['#anchor', 'https://app.example/resources/#anchor'],
		['/app/next?x=1#anchor', 'https://app.example/app/next?x=1#anchor'],
		['https://other.example/next', 'https://other.example/next']
	])(
		`${memory ? 'inline' : 'ordinary'} navigation resolves %s using the document base`,
		(href, expected) => {
			state.memory = memory;
			const anchor = document.createElement('a');
			anchor.setAttribute('href', href);
			expect(get_native_link_url(anchor).href).toBe(expected);
			expect(get_link_info(anchor, '/app', false).url?.href).toBe(anchor.href);
			expect(resolve_url(href).href).toBe(anchor.href);
		}
	);
}

test('a link outside the application base is not rewritten onto the logical route', () => {
	state.memory = true;
	const anchor = document.createElement('a');
	anchor.href = 'relative';
	expect(get_link_info(anchor, '/app', false)).toMatchObject({ external: true });
	expect(get_link_info(anchor, '/app', false).url?.href).toBe(
		'https://app.example/resources/relative'
	);
});

test('resolving a URL object preserves its existing URL', () => {
	const url = new URL('https://other.example/path');
	expect(resolve_url(url)).toBe(url);
});

// Use the actual fallback and navigation hooks, without booting an application.
// The browser fixture separately verifies native HTTP requests and responses.
for (const memory of [false, true]) {
	test.each(['/app/data.json', '/app/manual.pdf', '/app/server-only', '/app/missing'])(
		`${memory ? 'inline' : 'ordinary'} unmatched HTTP link unloads and can be canceled: %s`,
		async (path) => {
			const url = new URL(path, 'https://app.example');
			const native_navigation = vi.fn();
			const load_root_error_page = vi.fn();
			const context = vm.createContext({
				memory_routing: memory,
				origin: 'https://app.example',
				current_url: () => new URL('https://app.example/app/current'),
				hydrated: true,
				DEV: false,
				native_navigation,
				load_root_error_page,
				current: { url: new URL('https://app.example/app/current'), params: {}, route: null },
				is_navigating: false,
				before_navigate_callbacks: new Set([
					(/** @type {import('../app/navigation/public.js').BeforeNavigate} */ navigation) => {
						expect(navigation.willUnload).toBe(true);
						expect(navigation.to?.url).toBe(url);
						navigation.cancel();
					}
				]),
				noop() {},
				scroll_state: () => ({ x: 0, y: 0 })
			});
			for (const name of ['server_fallback', 'create_navigation', '_before_navigate']) {
				vm.runInContext(client_function(name), context);
			}
			expect(context._before_navigate({ url, type: 'link', intent: undefined })).toBeNull();
			expect(context.is_navigating).toBe(false);
			await context.server_fallback(url, { id: null }, { status: 404 });
			expect(native_navigation).toHaveBeenCalledExactlyOnceWith(url, undefined);
			expect(load_root_error_page).not.toHaveBeenCalled();
		}
	);
}

test.each([
	'about:srcdoc',
	'about:blank',
	'data:text/html,inline',
	'https://app.example/app/source'
])('the original startup loop guard still handles the current unhydrated URL: %s', async (href) => {
	const url = new URL(href);
	const native_navigation = vi.fn();
	const load_root_error_page = vi.fn();
	const context = vm.createContext({
		origin: url.origin,
		current_url: () => url,
		hydrated: false,
		DEV: false,
		native_navigation,
		load_root_error_page
	});
	vm.runInContext(client_function('server_fallback'), context);
	await context.server_fallback(url, { id: null }, { status: 404 });
	expect(load_root_error_page).toHaveBeenCalledOnce();
	expect(native_navigation).not.toHaveBeenCalled();
});

/** @param {string} name */
function client_function(name) {
	const source = fs.readFileSync(join(import.meta.dirname, 'client.js'), 'utf8');
	const match = source.match(new RegExp(`(?:async )?function ${name}\\([^]*?^}$`, 'm'));
	if (!match) throw new Error(`Missing source function: ${name}`);
	return match[0];
}
