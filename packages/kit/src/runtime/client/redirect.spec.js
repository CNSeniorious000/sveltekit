import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { redirect, isRedirect } from '@sveltejs/kit';
import { set_client_origin } from '../../utils/client-origin.js';

beforeEach(() => {
	vi.stubGlobal('window', { location: { origin: 'null' } });
	set_client_origin('https://app.example');
});

afterEach(() => {
	set_client_origin(undefined);
	vi.unstubAllGlobals();
});

test.each(['/app/next', '../next', '?next=1', 'https://app.example/app/next'])(
	'public redirect accepts a logical internal location: %s',
	(location) => {
		expect.assertions(2);
		try {
			redirect(307, location);
		} catch (error) {
			expect(isRedirect(error)).toBe(true);
			expect(error).toMatchObject({ status: 307, location });
		}
	}
);

test.each([
	'https://other.example/',
	'//other.example/',
	'javascript:alert(1)',
	'data:text/html,test'
])('public redirect still rejects external locations without permission: %s', (location) => {
	expect(() => redirect(307, location)).toThrowKitError('redirect_external_not_allowed');
});

test.each(['javascript:alert(1)', 'data:text/html,test'])(
	'allowing external redirects still rejects executable URLs: %s',
	(location) => {
		expect(() => redirect(307, location, { external: true })).toThrowKitError(
			'redirect_external_javascript'
		);
	}
);

test('the pathname router continues to use the real origin', () => {
	expect.assertions(2);
	set_client_origin(undefined);
	vi.stubGlobal('window', { location: { origin: 'https://real.example' } });
	expect(() => redirect(307, 'https://app.example/')).toThrowKitError(
		'redirect_external_not_allowed'
	);
	try {
		redirect(307, 'https://real.example/path');
	} catch (error) {
		expect(isRedirect(error)).toBe(true);
	}
});

test.each([
	'https://app.example.attacker.example/',
	'https://app.example@attacker.example/',
	'//attacker.example/',
	'\\\\attacker.example/',
	'http://app.example/',
	'https://app.example:444/',
	'blob:https://app.example/id'
])('logical-origin redirects do not authorize a different scheme or authority: %s', (target) => {
	expect(() => redirect(307, target)).toThrowKitError('redirect_external_not_allowed');
});

test('an explicit external allowlist permits its origin but not a deceptive hostname', () => {
	expect.assertions(3);
	try {
		redirect(307, 'https://trusted.example/path', { external: ['https://trusted.example'] });
	} catch (error) {
		expect(isRedirect(error)).toBe(true);
	}
	expect(() =>
		redirect(307, 'https://trusted.example.attacker.example/', {
			external: ['https://trusted.example']
		})
	).toThrowKitError('redirect_external_not_in_allowlist');
	// Selecting a logical redirect origin never changes the real browser location.
	expect(window.location.origin).toBe('null');
});

test('redirect validation is origin-based, not a paths.base authorization boundary', () => {
	try {
		redirect(307, 'https://app.example/outside-the-app');
	} catch (error) {
		expect(isRedirect(error)).toBe(true);
		return;
	}
	throw new Error('Expected redirect to throw');
});
