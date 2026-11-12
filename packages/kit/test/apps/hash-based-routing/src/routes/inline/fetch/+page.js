/** @type {import('./$types').PageLoad} */
export async function load({ fetch }) {
	const response = await fetch('probe.json');
	return { response: await response.text(), status: response.status };
}
