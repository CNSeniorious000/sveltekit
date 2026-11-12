/** @type {import('./$types').PageServerLoad} */
export function load({ params, route, url }) {
	return { server_url: url.href, server_route: route.id, server_slug: params.slug };
}
