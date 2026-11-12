/** @type {import('@sveltejs/kit').Handle} */
export async function handle({ event, resolve }) {
 const response=await resolve(event);
 // Deliberately opt only this fixture's tagged resources into cross-origin access.
 if(event.url.searchParams.get('token')?.startsWith('cors-')) response.headers.set('access-control-allow-origin','*');
 return response;
}
