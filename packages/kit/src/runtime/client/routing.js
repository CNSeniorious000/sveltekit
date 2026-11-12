import { set_client_origin } from '../../utils/client-origin.js';
import { payload } from './payload.js';
import { HISTORY_METADATA_KEY } from './constants.js';
import { untrack } from 'svelte';
import { page } from '#app/state/client';

// These documents cannot rewrite their pathname with the History API, even
// when their base URL or security origin is inherited from a HTTP(S) host.
export const memory_routing =
	__SVELTEKIT_INLINE__ &&
	!__SVELTEKIT_HASH_ROUTING__ &&
	(location.protocol === 'about:' || location.protocol === 'data:');

// Hash routes can use the browser's existing fragment history in these documents.
export const opaque_hash_routing =
	__SVELTEKIT_HASH_ROUTING__ && (location.protocol === 'about:' || location.protocol === 'data:');

/**
 * Keep the source route without adopting a prerender placeholder origin. The
 * browser's effective base includes inherited/relative bases and respects CSP.
 * A self-contained document needs no network origin just to hydrate.
 * @param {string} document_url
 * @param {string} document_base
 * @param {string} pathname
 */
export function get_initial_url(document_url, document_base, pathname) {
	const base = new URL(document_base);
	if (base.protocol === 'http:' || base.protocol === 'https:') {
		// Concatenation prevents a pathname beginning with // from changing origin.
		const url = new URL(base.origin + pathname);
		url.hash = new URL(document_url).hash;
		return url;
	}
	return new URL(document_url);
}

export const initial_url = memory_routing
	? get_initial_url(location.href, document.baseURI, payload.pathname ?? '/')
	: new URL(location.href);

// Public redirect validation must agree with the router's logical origin.
if (memory_routing) set_client_origin(initial_url.origin);

/** Read the existing browser history entry, without a separate history stack. */
export function current_url() {
	// Without an HTTP base, fragment navigation uses the actual document URL.
	if (!memory_routing || initial_url.origin === 'null') return new URL(location.href);

	const retained = history.state?.[HISTORY_METADATA_KEY]?.url;
	if (retained) return new URL(retained);

	// Script-created fragment entries have no Kit metadata. Keep the rendered
	// route, rather than reverting to the source document's initial pathname.
	// Do not invent history indices for entries that the router did not create.
	const current = untrack(() => page.shallow?.url ?? page.url);
	const url = new URL(current.origin === initial_url.origin ? current.href : initial_url.href);
	const hash = location.href.indexOf('#');
	url.hash = hash === -1 ? '' : location.href.slice(hash);
	return url;
}
