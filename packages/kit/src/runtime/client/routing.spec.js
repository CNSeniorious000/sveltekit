import { expect, test } from 'vitest';
import { get_initial_url, current_url } from './routing.js';

test('inline startup preserves the source pathname and query', () => {
	expect(
		get_initial_url('about:srcdoc', 'https://app.example/base/', '/app/users/alice?x=1').href
	).toBe('https://app.example/app/users/alice?x=1');
});

test.each(['about:blank', 'about:srcdoc', 'data:text/html,<p>hello</p>'])(
	'inline startup needs no explicit base for %s',
	(document_url) => {
		expect(get_initial_url(document_url, document_url, '/app/users/alice').href).toBe(document_url);
	}
);

test.each(['about:blank', 'about:srcdoc', 'data:text/html,test', 'file:///app/'])(
	'a non-HTTP effective base does not prevent inline startup: %s',
	(base) => {
		expect(get_initial_url('data:text/html,test', base, '/app/').href).toBe('data:text/html,test');
	}
);

test('a pathname cannot change the effective base origin', () => {
	expect(get_initial_url('about:srcdoc', 'https://app.example/', '//other.example/x').href).toBe(
		'https://app.example//other.example/x'
	);
});

test('the effective base path is not applied a second time', () => {
	expect(
		get_initial_url('about:blank', 'https://app.example/app/', '/app/users/alice').pathname
	).toBe('/app/users/alice');
});

test('ordinary HTTP routing ignores inline history metadata', () => {
	history.replaceState({ 'sveltekit:metadata': { url: 'https://wrong.example/' } }, '');
	expect(current_url().href).toBe(location.href);
});

test('inline startup preserves the actual document fragment rather than a base fragment', () => {
	expect(
		get_initial_url(
			'about:srcdoc#anchor',
			'https://app.example/resources/#unrelated',
			'/app/route?x=1'
		).href
	).toBe('https://app.example/app/route?x=1#anchor');
});

test('a fragment on the document base does not become the initial route fragment', () => {
	expect(
		get_initial_url('about:srcdoc', 'https://app.example/resources/#unrelated', '/app/route').href
	).toBe('https://app.example/app/route');
});
