import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

/** @type {import('./$types').PageServerLoad} */
export function load({ url }) {
	redirect(303, `${resolve('/memory/route/[slug]', { slug: 'redirected' })}${url.search}`);
}
