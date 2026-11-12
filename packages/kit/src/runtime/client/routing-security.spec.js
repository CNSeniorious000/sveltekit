import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { get_initial_url, current_url } from './routing.js';

beforeEach(() => {
	document.head.innerHTML = '';
});

afterEach(() => {
	vi.restoreAllMocks();
	document.head.innerHTML = '';
});

test('inline startup uses the first base href that the browser actually resolves', () => {
	document.head.innerHTML = `
		<base target="_blank">
		<base href="https://app.example/resources/">
		<base href="https://ignored.example/">
	`;
	expect(document.baseURI).toBe('https://app.example/resources/');
	expect(get_initial_url('about:srcdoc', document.baseURI, '/app/users/alice?x=1').href).toBe(
		'https://app.example/app/users/alice?x=1'
	);
});

test('inline startup accepts the browser-normalized effective base', () => {
	document.head.innerHTML = '<base href="HTTPS://APP.EXAMPLE:443/a/../resources/?q=1#section">';
	expect(get_initial_url('about:srcdoc', document.baseURI, '/app/').href).toBe(
		'https://app.example/app/'
	);
});

test('inline startup accepts an inherited HTTP base without an explicit base element', () => {
	vi.spyOn(document, 'baseURI', 'get').mockReturnValue('https://host.example/embedding');
	expect(document.querySelector('base')).toBeNull();
	expect(get_initial_url('about:srcdoc', document.baseURI, '/app/users/alice').href).toBe(
		'https://host.example/app/users/alice'
	);
});

test.each(['', '/app/', '../app/'])(
	'inline startup accepts an empty or relative base resolved by the browser: %s',
	(base) => {
		document.head.innerHTML = `<base href="${base}"><base href="https://ignored.example/">`;
		const effective_base = new URL(base, document.URL);
		expect(document.baseURI).toBe(effective_base.href);
		expect(get_initial_url('about:blank', document.baseURI, '/app/route').href).toBe(
			`${effective_base.origin}/app/route`
		);
	}
);

test('a CSP-blocked explicit base cannot override the browser effective base', () => {
	document.head.innerHTML = '<base href="https://blocked.example/resources/">';
	// JSDOM does not enforce CSP. Model the effective base a browser reports after
	// rejecting the DOM element, rather than claiming to test CSP enforcement here.
	vi.spyOn(document, 'baseURI', 'get').mockReturnValue('https://host.example/embedding');
	expect(get_initial_url('about:srcdoc', document.baseURI, '/app/').href).toBe(
		'https://host.example/app/'
	);
});

test.each(['about:srcdoc', 'about:blank', 'data:text/html,test'])(
	'a blocked base without an HTTP fallback still permits startup: %s',
	(document_url) => {
		document.head.innerHTML = '<base href="https://blocked.example/">';
		vi.spyOn(document, 'baseURI', 'get').mockReturnValue(document_url);
		expect(get_initial_url(document_url, document.baseURI, '/app/').href).toBe(document_url);
	}
);

test('ordinary HTTP routing continues to use the actual document URL', () => {
	document.head.innerHTML = '<base href="https://other.example/">';
	vi.spyOn(document, 'baseURI', 'get').mockReturnValue('about:srcdoc');
	expect(current_url().href).toBe(location.href);
});
