/** A real response without ACAO, used by the opaque-origin native CORS control. */
export function GET() {
	return new Response('{}', {
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});
}
