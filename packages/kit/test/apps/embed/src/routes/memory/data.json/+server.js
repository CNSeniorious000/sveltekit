import { json } from '@sveltejs/kit';

/** @type {Map<string, number>} */
const versions = new Map();

/** @type {import('./$types').RequestHandler} */
export function GET({ isSubRequest, request, url }) {
	const token = url.searchParams.get('token') ?? 'manual';
	return json(
		{
			method: request.method,
			path: url.pathname,
			source: isSubRequest ? 'server' : 'network',
			token,
			version: versions.get(token) ?? 0
		},
		{ headers: { 'cache-control': 'max-age=60' } }
	);
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ isSubRequest, request, url }) {
	const token = url.searchParams.get('token') ?? 'manual';
	const version = (versions.get(token) ?? 0) + 1;
	versions.set(token, version);
	return json({
		method: request.method,
		path: url.pathname,
		source: isSubRequest ? 'server' : 'network',
		token,
		version,
		body: await request.text()
	});
}
