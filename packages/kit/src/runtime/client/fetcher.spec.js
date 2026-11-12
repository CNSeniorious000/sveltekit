import { beforeEach, expect, test, vi } from 'vitest';

const routing = vi.hoisted(() => ({
	memory: true,
	url: 'https://app.example/app/users/alice'
}));
vi.mock('./routing.js', () => ({
	opaque_hash_routing: false,
	get memory_routing() {
		return routing.memory;
	},
	current_url: () => new URL(routing.url)
}));
vi.mock('esm-env', () => ({ DEV: false }));

/** @type {typeof import('./fetcher.js')} */
let fetcher;
const native_fetch = vi.fn(() => Promise.resolve(new Response('network')));

beforeEach(async () => {
	vi.resetModules();
	native_fetch.mockClear();
	window.fetch = native_fetch;
	document.head.innerHTML = '<base href="https://app.example/app/">';
	document.body.innerHTML = '';
	routing.memory = true;
	routing.url = 'https://app.example/app/users/alice';
	fetcher = await import('./fetcher.js');
});

/** @param {string} url */
function seed(url) {
	const script = document.createElement('script');
	script.type = 'application/json';
	script.setAttribute('data-sveltekit-fetched', '');
	script.setAttribute('data-url', url);
	script.setAttribute('data-ttl', '100000');
	script.textContent = JSON.stringify({ body: 'serialized', status: 200, headers: {} });
	document.body.append(script);
}

test('hydration fetch retains the SSR cache key', async () => {
	seed('/app/data.json');
	const response = await fetcher.initial_fetch(
		'/app/data.json',
		undefined,
		'https://app.example/app/data.json'
	);
	expect(await response.text()).toBe('serialized');
	expect(native_fetch).not.toHaveBeenCalled();
});

test('hydration cache miss fetches the resolved URL', async () => {
	const opts = { headers: { accept: 'application/json' } };
	await fetcher.initial_fetch(
		'/app/users/data.json',
		opts,
		'https://app.example/app/users/data.json'
	);
	expect(native_fetch).toHaveBeenCalledWith('https://app.example/app/users/data.json', opts);
});

test('subsequent load reuses an unexpired hydration response', async () => {
	seed('/app/data.json');
	await fetcher.initial_fetch('/app/data.json');
	const response = await fetcher.subsequent_fetch(
		'/app/data.json',
		'https://app.example/app/data.json'
	);
	expect(await response.text()).toBe('serialized');
	expect(native_fetch).not.toHaveBeenCalled();
});

test('a native relative POST invalidates the document-base resource', async () => {
	seed('/app/data.json');
	await fetcher.initial_fetch('/app/data.json');
	await window.fetch('data.json', { method: 'POST' });
	const response = await fetcher.subsequent_fetch(
		'/app/data.json',
		'https://app.example/app/data.json'
	);
	expect(await response.text()).toBe('network');
	expect(native_fetch).toHaveBeenLastCalledWith('https://app.example/app/data.json', undefined);
});

test('an absolute Request POST invalidates the logical load resource', async () => {
	seed('/app/users/data.json');
	await fetcher.initial_fetch('/app/users/data.json');
	await window.fetch(new Request('https://app.example/app/users/data.json', { method: 'POST' }));
	const response = await fetcher.subsequent_fetch(
		'/app/users/data.json',
		'https://app.example/app/users/data.json'
	);
	expect(await response.text()).toBe('network');
});

test('a native POST does not invalidate another logical directory', async () => {
	seed('/app/users/data.json');
	await fetcher.initial_fetch('/app/users/data.json');
	await window.fetch('data.json', { method: 'POST' });
	const response = await fetcher.subsequent_fetch(
		'/app/users/data.json',
		'https://app.example/app/users/data.json'
	);
	expect(await response.text()).toBe('serialized');
	expect(native_fetch).toHaveBeenCalledTimes(1);
});

test('ordinary pathname routing still resolves mutation cache keys against location', async () => {
	routing.memory = false;
	routing.url = location.href;
	seed('/data.json');
	await fetcher.initial_fetch('/data.json');
	await window.fetch('/data.json', { method: 'POST' });
	const response = await fetcher.subsequent_fetch(
		'/data.json',
		new URL('/data.json', location.href).href
	);
	expect(await response.text()).toBe('network');
});

test('native relative POST without a base reaches native fetch instead of throwing synchronously', async () => {
	routing.url = 'data:text/html,inline';
	vi.spyOn(document, 'baseURI', 'get').mockReturnValue(routing.url);
	const failure = new TypeError('native URL rejection');
	native_fetch.mockImplementationOnce(() => Promise.reject(failure));
	let result;
	expect(() => {
		result = window.fetch('/api', { method: 'POST' });
	}).not.toThrow();
	await expect(result).rejects.toBe(failure);
	expect(native_fetch).toHaveBeenCalledWith('/api', { method: 'POST' });
	vi.restoreAllMocks();
});

test('absolute data fetch uses its complete serialized key in a baseless document', async () => {
	routing.url = 'data:text/html,inline';
	seed('data:text/plain,cached');
	const response = await fetcher.initial_fetch('data:text/plain,cached');
	expect(await response.text()).toBe('serialized');
	expect(native_fetch).not.toHaveBeenCalled();
});
