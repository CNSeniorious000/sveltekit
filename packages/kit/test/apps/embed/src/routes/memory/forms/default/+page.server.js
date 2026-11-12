/** @type {import('./$types').PageServerLoad} */
export function load({ url }) {
	return { mode: 'default', server_url: url.href };
}

/** @type {import('./$types').Actions} */
export const actions = {
	default: async ({ request, url }) => {
		const data = await request.formData();
		return { action: 'default', pathname: url.pathname, value: data.get('value') };
	}
};
