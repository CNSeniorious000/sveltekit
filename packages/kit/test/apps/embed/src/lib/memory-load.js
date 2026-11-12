import { browser } from '$app/env';
import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';

/** @type {import('@sveltejs/kit').Load} */
export async function load({ data, fetch, params, route, url, depends }) {
	depends('memory:data');
	if (browser && url.searchParams.has('browser-redirect')) {
		redirect(
			307,
			`${resolve('/memory/route/[slug]', { slug: 'hydration-redirected' })}?token=${url.searchParams.get('token')}`
		);
	}
	const token = url.searchParams.get('token') ?? 'manual';
	const resource = `../data.json?token=${encodeURIComponent(token)}`;
	const posted = url.searchParams.has('post')
		? await fetch(resource, { method: 'POST', body: 'from-load' }).then((r) => r.json())
		: null;
	const fetched = await fetch(resource).then((r) => r.json());
	const redirected = url.searchParams.has('fetch-redirect')
		? await fetch(`../redirect.json?token=${encodeURIComponent(token)}`).then((r) => r.json())
		: null;

	return {
		...data,
		fetched,
		posted,
		redirected,
		load_url: url.href,
		load_route: route.id,
		load_slug: params.slug,
		token
	};
}
