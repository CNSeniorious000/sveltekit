import fs from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import { expect, test, vi } from 'vitest';

// Run the routing module source with different build-time flags. This tests
// initialization without a browser launch; it is not a browser hydration test.
const source = fs
	.readFileSync(join(import.meta.dirname, 'routing.js'), 'utf8')
	.replace(/^import .+;\n/gm, '')
	.replace(/^export /gm, '');

/**
 * @param {string} href
 * @param {boolean} inline
 * @param {boolean} hash
 * @param {string} [base]
 */
function initialize(href, inline, hash, base = href) {
	const set_client_origin = vi.fn();
	const context = {
		URL,
		__SVELTEKIT_INLINE__: inline,
		__SVELTEKIT_HASH_ROUTING__: hash,
		location: new URL(href),
		document: { baseURI: base },
		history: { state: null },
		payload: { pathname: '/app/source?x=1' },
		HISTORY_METADATA_KEY: 'sveltekit:metadata',
		set_client_origin
	};
	const result = vm.runInNewContext(
		`${source}\n({ memory_routing, opaque_hash_routing, initial_url, current_url });`,
		context
	);
	return { ...result, set_client_origin };
}

for (const inline of [true, false]) {
	for (const hash of [true, false]) {
		test.each([
			'about:srcdoc',
			'about:blank',
			'data:text/html,<button>Count: 0</button>',
			'https://app.example/app/',
			'http://app.example/app/',
			'file:///app/index.html'
		])(`startup for %s with inline=${inline}, hash=${hash}`, (href) => {
			const result = initialize(href, inline, hash);
			const opaque = ['about:', 'data:'].includes(new URL(href).protocol);
			const memory = inline && !hash && opaque;
			expect(result.memory_routing).toBe(memory);
			expect(result.opaque_hash_routing).toBe(hash && opaque);
			expect(result.initial_url.href).toBe(href);
			expect(result.current_url().href).toBe(href);
			expect(result.set_client_origin).toHaveBeenCalledTimes(memory ? 1 : 0);
		});
	}
}

test.each(['https://app.example/actual?x=2', 'http://app.example/actual?x=2', 'file:///actual'])(
	'an inline bundle preserves ordinary routing for %s',
	(href) => {
		const result = initialize(href, true, false, 'https://other.example/resources/');
		expect(result.memory_routing).toBe(false);
		expect(result.opaque_hash_routing).toBe(false);
		expect(result.initial_url.href).toBe(href);
		expect(result.set_client_origin).not.toHaveBeenCalled();
	}
);

test('an inline about document initializes from an inherited effective HTTP base', () => {
	const result = initialize('about:srcdoc', true, false, 'https://host.example/embedding');
	expect(result.memory_routing).toBe(true);
	expect(result.initial_url.href).toBe('https://host.example/app/source?x=1');
	expect(result.set_client_origin).toHaveBeenCalledExactlyOnceWith('https://host.example');
});
