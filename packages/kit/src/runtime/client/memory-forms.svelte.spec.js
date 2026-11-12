import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import * as devalue from 'devalue';

const state = vi.hoisted(() => ({
	memory: true,
	href: '',
	apply_action: vi.fn(),
	navigate_action: vi.fn(),
	refresh: vi.fn()
}));

vi.mock('./routing.js', () => ({
	opaque_hash_routing: false,
	get memory_routing() {
		return state.memory;
	},
	initial_url: new URL('/app/users/alice?x=1', location.href),
	current_url: () => new URL(state.memory ? state.href : location.href)
}));

vi.mock(new URL('./client.js', import.meta.url).pathname, () => ({
	app: { decoders: {} },
	query_map: new Map(),
	query_responses: {},
	live_query_map: new Map(),
	_goto: vi.fn(),
	set_nearest_error_page: vi.fn(),
	handle_error: vi.fn(),
	refreshAll: state.refresh,
	applyAction: state.apply_action,
	apply_action_navigation: state.navigate_action,
	is_current_location: (/** @type {string} */ href) => href === state.href
}));

vi.mock(new URL('../app/navigation/index.js', import.meta.url).pathname, () => ({
	refreshAll: state.refresh
}));

vi.mock('#app/state/client', () => ({
	page: { url: new URL('/app/users/alice?x=1', location.href) },
	navigating: null,
	notify_version: vi.fn()
}));

const { enhance } = await import('../app/forms/client.js');
const { form: remote_form } = await import('./remote-functions/form.svelte.js');
const { get_form_action } = await import('./utils.js');
const { init_transport } = await import('../app/internal/transport.js');

beforeEach(() => {
	init_transport({});
	state.memory = true;
	state.href = new URL('/app/users/alice?x=1', location.href).href;
	document.head.innerHTML = `<base href="${new URL('/resources/', location.href).href}">`;
	document.body.innerHTML = '';
	vi.clearAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test.each([null, '', '?/save', 'edit', '/app/next'])(
	'enhanced inline form resolves explicit action %s against the document base',
	async (action) => {
		const form = document.createElement('form');
		form.method = 'post';
		if (action !== null) form.setAttribute('action', action);
		const listeners = vi.spyOn(HTMLFormElement.prototype, 'addEventListener');
		const submit = vi.fn(({ cancel }) => cancel());
		const enhanced = enhance(form, submit);
		const handler = /** @type {(event: any) => Promise<void>} */ (
			listeners.mock.calls.find(([type]) => type === 'submit')?.[1]
		);
		try {
			await handler({ submitter: null, preventDefault() {} });
			expect(submit.mock.calls[0][0].action.href).toBe(
				action ? new URL(action, document.baseURI).href : state.href
			);
		} finally {
			enhanced.destroy();
		}
	}
);

test('inline forms use the document base for explicit submitter overrides and the route for empty ones', () => {
	const form = document.createElement('form');
	form.action = '/app/other';
	const submitter = document.createElement('button');
	submitter.setAttribute('formaction', '?/save');
	expect(get_form_action(form, submitter).href).toBe(new URL('?/save', document.baseURI).href);
	submitter.setAttribute('formaction', '');
	expect(get_form_action(form, submitter).href).toBe(state.href);
});

test.each([null, ''])(
	'only enhanced forms map absent or empty action %s to the logical route',
	(action) => {
		const form = document.createElement('form');
		if (action !== null) form.setAttribute('action', action);
		expect(form.action).toBe(document.URL);
		expect(get_form_action(form).href).toBe(state.href);
		// Reading or enhancing the form must not rewrite the native DOM action.
		expect(form.action).toBe(document.URL);
	}
);

test('pathname forms retain browser resolution against the document base', () => {
	state.memory = false;
	const form = document.createElement('form');
	form.setAttribute('action', 'edit');
	expect(get_form_action(form).href).toBe(new URL('edit', document.baseURI).href);
	form.removeAttribute('action');
	expect(get_form_action(form).href).toBe(document.URL);
});

test('enhanced memory cross-page action failures navigate to the action route', async () => {
	vi.stubGlobal('location', new URL('about:srcdoc'));
	const form = document.createElement('form');
	form.method = 'post';
	form.action = '/app/next';
	vi.stubGlobal('fetch', () =>
		Promise.resolve(
			Response.json(
				{
					type: 'failure',
					status: 422,
					location: '/app/next',
					data: devalue.stringify({ invalid: true })
				},
				{ status: 422 }
			)
		)
	);
	const listeners = vi.spyOn(HTMLFormElement.prototype, 'addEventListener');
	const enhanced = enhance(form);
	const handler = /** @type {(event: any) => Promise<void>} */ (
		listeners.mock.calls.find(([type]) => type === 'submit')?.[1]
	);
	try {
		await handler({ submitter: null, preventDefault() {} });
		expect(state.navigate_action).toHaveBeenCalledWith(
			new URL('/app/next', state.href).href,
			expect.objectContaining({ type: 'failure', status: 422 }),
			false
		);
		expect(state.apply_action).not.toHaveBeenCalled();
	} finally {
		enhanced.destroy();
	}
});

for (const memory of [true, false]) {
	test.each(['submit', 'validate'])(
		`remote form %s sends ${memory ? 'logical memory' : 'ordinary browser'} route headers`,
		async (operation) => {
			state.memory = memory;
			if (memory) vi.stubGlobal('location', new URL('about:srcdoc'));
			const fetch = vi.fn(
				(/** @type {RequestInfo | URL} */ _url, /** @type {RequestInit} */ _init) =>
					Promise.resolve(
						Response.json({
							type: 'result',
							data: devalue.stringify(
								operation === 'validate' ? { _: [] } : { _: { issues: [] }, r: true }
							)
						})
					)
			);
			vi.stubGlobal('fetch', fetch);
			const remote = remote_form('hash/memoryForm');
			const element = document.createElement('form');
			const attachment = Reflect.ownKeys(remote).find((key) => typeof key === 'symbol');
			const detach = /** @type {any} */ (remote)[/** @type {symbol} */ (attachment)](element);
			try {
				if (operation === 'submit') await remote.submit();
				else await remote.validate();
				const url = new URL(memory ? state.href : location.href);
				const init = fetch.mock.calls[0][1];
				expect(init).not.toHaveProperty('credentials');
				expect(init).not.toHaveProperty('mode');
				expect(new Headers(init.headers).has('origin')).toBe(false);
				expect(fetch).toHaveBeenCalledWith(
					memory
						? new URL('/_app/remote/hash/memoryForm', state.href).href
						: '/_app/remote/hash/memoryForm',
					expect.objectContaining({
						headers: expect.objectContaining({
							'x-sveltekit-pathname': url.pathname,
							'x-sveltekit-search': url.search
						})
					})
				);
			} finally {
				detach();
			}
		}
	);
}
