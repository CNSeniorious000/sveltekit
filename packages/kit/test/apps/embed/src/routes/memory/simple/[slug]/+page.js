import { browser } from '$app/env';

let browser_load_count = 0;

/** @type {import('./$types').PageLoad} */
export function load({ depends, route, params, url }) {
	depends('app:refresh');

	return {
		load_count: browser ? ++browser_load_count : 0,
		load_route: route.id,
		load_params: params,
		load_url: url.href
	};
}
