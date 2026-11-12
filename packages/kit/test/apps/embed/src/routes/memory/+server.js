import { resolve } from '$app/paths';

/** @type {import('./$types').RequestHandler} */
export function GET({ url }) {
	const config = {
		origin: url.origin,
		transport: url.searchParams.get('transport') ?? 'srcdoc',
		cache: url.searchParams.get('cache') ?? 'hit',
		csp: url.searchParams.get('csp'),
		base: url.searchParams.get('base') ?? 'source',
		sandbox: url.searchParams.has('sandbox'),
		two: url.searchParams.has('two'),
		csr: url.searchParams.has('csr'),
		simple: url.searchParams.has('simple'),
		forms: url.searchParams.get('forms'),
		redirect: url.searchParams.has('redirect'),
		path: new URL(resolve('/memory/route/[slug]', { slug: 'alpha' }), url).pathname,
		default_form_path: new URL(resolve('/memory/forms/default'), url).pathname,
		named_form_path: new URL(resolve('/memory/forms/named'), url).pathname,
		client_path: new URL(resolve('/memory/client/[slug]', { slug: 'alpha' }), url).pathname,
		simple_path: new URL(resolve('/memory/simple/[slug]', { slug: 'alpha' }), url).pathname
	};

	return new Response(
		`<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>Inline application iframe host</title>
	<style>
		body { font: 16px sans-serif; }
		iframe { width: 45%; min-width: 400px; height: 600px; border: 1px solid #777; }
		pre { white-space: pre-wrap; overflow-wrap: anywhere; }
	</style>
</head>
<body class="started">
	<h1>Inline application iframe host</h1>
	<p>This HTTP host embeds the app in an about: or data: document.</p>
	<nav>
		<a href="?transport=srcdoc">srcdoc</a>
		<a href="?transport=blank">about:blank</a>
		<a href="?transport=data&simple&base=opaque">Self-contained data document</a>
		<a href="?cache=miss">Fetch cache miss</a>
		<a href="?two">Two iframes</a>
		<a href="?csr">Client render</a>
		<a href="?forms=default">Enhanced forms</a>
		<a href="?forms=named">Named actions</a>
		<a href="?csp=base-none">Blocked base CSP</a>
		<a href="?base=inherited">Inherited base</a>
		<a href="?base=relative">Relative base</a>
		<a href="?simple&base=opaque">Self-contained counter without HTTP base</a>
		<a href="?sandbox">Opaque sandbox</a>
	</nav>
	<p data-testid="host-status">loading</p>
	<main></main>
	<script>
		const config = ${JSON.stringify(config).replaceAll('<', '\\u003c')};
		async function mount(index) {
			const path = config.forms === 'default' ? config.default_form_path
				: config.forms === 'named' ? config.named_form_path
				: config.simple ? config.simple_path
				: config.csr ? config.client_path : config.path;
			const source = new URL(path, config.origin);
			source.searchParams.set('token', crypto.randomUUID());
			source.searchParams.set('initial', '1');
			source.searchParams.set('label', 'hello world');
			if (config.redirect) source.searchParams.set('browser-redirect', '1');
			const response = await fetch(source);
			if (!response.ok) throw new Error('Could not render fixture: ' + response.status);
			const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
			if (config.base !== 'inherited') {
				const base = doc.createElement('base');
				base.setAttribute('href', config.base === 'relative' ? source.pathname + source.search
					: config.base === 'alternate' ? config.origin + '/app/memory/client/'
					: config.base === 'opaque' ? 'about:blank'
					: config.csp === 'base-none' ? 'https://blocked.example/resources/' : source.href);
				doc.head.prepend(base);
			}
			if (config.csp === 'base-none') {
				const policy = doc.createElement('meta');
				policy.httpEquiv = 'Content-Security-Policy';
				policy.content = "base-uri 'none'";
				// The policy must precede the base when the iframe parses its document.
				doc.head.prepend(policy);
			}
			const marker = doc.createElement('script');
			marker.textContent = 'window.memory_initial_history_length = history.length; document.documentElement.dataset.memoryInitialHistoryUrl = history.state?.["sveltekit:metadata"]?.url ?? "";';
			doc.head.append(marker);
			if (config.cache === 'miss') {
				doc.querySelectorAll('script[data-sveltekit-fetched]').forEach((node) => node.remove());
			}
			const snapshot = document.createElement('pre');
			snapshot.dataset.testid = 'ssr-' + index;
			snapshot.textContent = JSON.stringify(Object.fromEntries(
				['runtime', 'page-url', 'route-id', 'params', 'load-url', 'fetched', 'server-url']
					.map((name) => [name, doc.querySelector('[data-testid="' + name + '"]')?.textContent ?? null])
			));
			const frame = document.createElement('iframe');
			frame.name = 'memory-' + index;
			frame.dataset.testid = 'frame-' + index;
			frame.dataset.source = source.href;
			frame.title = 'Memory app ' + index;
			const html = '<!doctype html>' + doc.documentElement.outerHTML;
			if (config.transport === 'srcdoc') {
				if (config.sandbox) frame.setAttribute('sandbox', 'allow-scripts allow-forms');
				frame.srcdoc = html;
			}
			if (config.transport === 'data') {
				frame.src = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
			}
			if (config.transport === 'blank') {
				frame.src = 'about:blank';
				frame.onload = () => {
					frame.onload = null;
					// Write in the iframe realm. A parent-realm document.write can copy the host URL.
					const script = frame.contentDocument.createElement('script');
					script.textContent = 'document.open(); document.write(' + JSON.stringify(html) + '); document.close();';
					frame.contentDocument.body.append(script);
				};
			}
			document.querySelector('main').append(frame, snapshot);
		}
		Promise.all(Array.from({ length: config.two ? 2 : 1 }, (_, i) => mount(i + 1)))
			.then(() => document.querySelector('[data-testid="host-status"]').textContent = 'ready')
			.catch((error) => document.querySelector('[data-testid="host-status"]').textContent = error.message);
	</script>
</body>
</html>`,
		{ headers: { 'content-type': 'text/html' } }
	);
}
