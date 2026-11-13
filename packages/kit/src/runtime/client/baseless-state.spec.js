import fs from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import { expect, test } from 'vitest';

const source = fs.readFileSync(join(import.meta.dirname, 'client.js'), 'utf8');
const resolve_intent = source.match(/async function resolve_intent\([^]*?^}/m)?.[0];
if (!resolve_intent) throw new Error('Missing resolve_intent');

for (const href of ['about:srcdoc', 'about:blank', 'data:text/html,inline']) {
	test(`shallow state reuses only the hydrated baseless document: ${href}`, async () => {
		const current = { url: new URL(href), route: { id: '/source' }, params: { id: 'original' } };
		const context = {
			URL,
			memory_routing: true,
			initial_url: new URL(href),
			current,
			current_url: () => new URL(href),
			origin: 'null',
			resolve_url: (/** @type {string | URL} */ value) => new URL(value, 'about:blank'),
			get_page_key: (/** @type {URL} */ url) => url.href,
			get_navigation_intent: async () => undefined,
			e: {
				navigation_external_url() {
					throw new Error('external');
				},
				navigation_route_missing() {
					throw new Error('missing');
				}
			}
		};
		const resolve = vm.runInNewContext(`(${resolve_intent})`, context);
		for (const value of ['', new URL(href)]) {
			const intent = await resolve(value, 'pushState', true);
			expect(intent.route).toBe(current.route);
			expect(intent.params).toBe(current.params);
			expect(intent.url.href).toBe(href);
		}
		for (const overrides of [
			{ memory_routing: false },
			{ initial_url: new URL('https://app.example/source') },
			{ current: { ...current, route: null } }
		]) {
			const unsupported = vm.runInNewContext(`(${resolve_intent})`, { ...context, ...overrides });
			await expect(unsupported(new URL(href), 'pushState', true)).rejects.toThrow();
		}
		await expect(resolve(new URL(href), 'goto', false)).rejects.toThrow();
		for (const value of [
			'about:other',
			'data:text/html,other',
			'https://other.example/',
			href + '#other'
		]) {
			await expect(resolve(new URL(value), 'pushState', true)).rejects.toThrow();
		}
	});
}
