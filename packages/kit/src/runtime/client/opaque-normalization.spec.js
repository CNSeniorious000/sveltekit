import fs from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { normalize_path } from '../../utils/url.js';

const source = fs.readFileSync(join(import.meta.dirname, 'client.js'), 'utf8');
const helper = source.match(
	/async function get_navigation_result_from_branch\([^]*?\}\) \{[^]*?\n\}/
)?.[0];
if (!helper) throw new Error('Missing navigation result helper');

const navigation_result = vm.runInNewContext(`${helper}\nget_navigation_result_from_branch`, {
	URL,
	base: '/app',
	normalize_path,
	page: {},
	props: {},
	current: { branch: [] }
});

for (const slash of ['never', 'always', 'ignore']) {
	test.each(['about:srcdoc', 'about:blank', 'data:text/html,app'])(
		`does not write the opaque document pathname or query with trailingSlash=${slash}: %s`,
		async (document_url) => {
			const url = new URL(`${document_url}?outer=1#/inline/a`);
			const href = url.href;
			for (const key of ['pathname', 'search']) {
				const get = Object.getOwnPropertyDescriptor(URL.prototype, key)?.get;
				Object.defineProperty(url, key, {
					get: () => get?.call(url),
					set: () => {
						throw new Error(`Unexpected opaque ${key} mutation`);
					}
				});
			}
			const result = await navigation_result({
				url,
				branch: [{ slash, data: {} }],
				params: {},
				error: null
			});
			expect(url.href).toBe(href);
			expect(result.props.page.url.href).toBe(href);
		}
	);
}

test.each([
	['never', '/app/route/', '/app/route'],
	['always', '/app/route', '/app/route/'],
	['ignore', '/app/route/', '/app/route/']
])('keeps HTTP trailingSlash=%s normalization', async (slash, pathname, expected) => {
	const url = new URL(`https://app.example${pathname}?#section`);
	const result = await navigation_result({
		url,
		branch: [{ slash, data: {} }],
		params: {},
		error: null
	});
	expect(result.props.page.url.href).toBe(`https://app.example${expected}#section`);
});
