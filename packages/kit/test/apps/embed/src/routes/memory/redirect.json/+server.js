import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

/** @type {import('./$types').RequestHandler} */
export function GET({ url }) {
	redirect(307, `${resolve('/memory/data.json')}${url.search}`);
}
