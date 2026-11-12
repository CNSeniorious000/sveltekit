import { beforeEach, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ memory: true }));
vi.mock('./routing.js', () => ({
	opaque_hash_routing: false,
	get memory_routing() {
		return state.memory;
	},
	initial_url: new URL('https://app.example/app/current'),
	current_url: () => new URL('https://app.example/app/current')
}));
const { is_external_url } = await import('./utils.js');

beforeEach(() => {
	state.memory = true;
});

test.each([
	['/app', '/app', false],
	['/app', '/app/', false],
	['/app', '/app/missing', false],
	['/app', '/app?query=1#anchor', false],
	['/app', '/application', true],
	['/app', '/app2?query=1#anchor', true],
	['/app', '/app2/', true],
	['/app', '/app%2foutside', true],
	['/app', '/app%2Foutside', true],
	['/app', '/app%3Foutside', true],
	['/app', '/app/../outside', true],
	['/app', '/app/%2e%2e/outside', true],
	['/app', '/app/nested%2Froute', false],
	['/nested/app', '/nested/application', true],
	['/nested/app', '/nested/app/route', false],
	['/nested/app', '/nested/app', false],
	['/encoded%20base', '/encoded%20base/route', false],
	['/encoded%20base', '/encoded%20base2/route', true],
	['', '/', false],
	['', '/app2?query=1', false]
])('memory base %s classifies %s by segment boundary', (base, href, external) => {
	expect(is_external_url(new URL(href, 'https://app.example'), base, false)).toBe(external);
});

test('the memory router still treats a different origin as external', () => {
	expect(is_external_url(new URL('https://other.example/app/route'), '/app', false)).toBe(true);
});

test.each([false, true])('ordinary router retains existing prefix behavior, hash=%s', (hash) => {
	state.memory = false;
	// The existing pathname/hash routers retain their prior classification.
	const url = new URL('/application', 'https://app.example');
	expect(is_external_url(url, '/app', hash)).toBe(hash && url.pathname !== location.pathname);
});
