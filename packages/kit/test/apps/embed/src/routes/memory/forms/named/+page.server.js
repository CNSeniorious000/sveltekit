import { fail, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';

/** @type {import('./$types').PageServerLoad} */
export function load({ url }) {
	return { mode: 'named', server_url: url.href };
}

/** @type {import('./$types').Actions} */
export const actions = {
	save: async ({ request, url }) => {
		const data = await request.formData();
		return { action: 'save', pathname: url.pathname, value: data.get('value') };
	},
	other: async ({ request, url }) => {
		const data = await request.formData();
		return {
			action: 'other',
			pathname: url.pathname,
			value: data.get('value'),
			submitter: data.get('submitter')
		};
	},
	reject: async ({ request, url }) => {
		const data = await request.formData();
		return fail(422, { action: 'reject', pathname: url.pathname, value: data.get('value') });
	},
	redirect: () => {
		redirect(303, resolve('/memory/route/[slug]', { slug: 'from-action' }));
	}
};
