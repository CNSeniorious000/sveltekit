import { readFileSync } from 'node:fs';

/** @param {string} value */
function escape_html(value) {
	return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

/**
 * A real embedding page, not an automation-time script injection. Keep its base
 * outside `paths.base` to detect accidentally using the hash route for requests.
 * @param {string} shell
 * @param {URL} url
 */
export function render_host(shell, url) {
	const mode = url.searchParams.get('mode') || 'srcdoc';
	const base = url.searchParams.get('base') || 'explicit';
	const route = url.searchParams.get('route') || '/inline/a';
	const base_url = new URL('/network/embedded/', url).href;
	const startup = `<script>if (!location.hash) history.replaceState(null, '', location.href + ${JSON.stringify('#' + route).replaceAll('<', '\\u003c')});</script>`;
	const document = shell.replace(
		'<head>',
		`<head>${base === 'explicit' ? `<base href="${escape_html(base_url)}">` : ''}${startup}`
	);

	const frame =
		mode === 'data'
			? `<iframe title="Hash app" src="data:text/html;base64,${Buffer.from(document).toString('base64')}#${escape_html(route)}"></iframe>`
			: mode === 'blank'
				? `<main id="frame-container"></main>
<script>
	const frame = document.createElement('iframe');
	frame.title = 'Hash app';
	frame.src = 'about:blank';
	const shell = ${JSON.stringify(document).replaceAll('<', '\\u003c')};
	frame.onload = () => {
		frame.onload = null;
		// A parent-realm document.write can copy the host's HTTP URL into the frame.
		const script = frame.contentDocument.createElement('script');
		script.textContent = 'setTimeout(() => { document.open(); document.write(' + JSON.stringify(shell) + '); document.close(); }, 0);';
		frame.contentDocument.body.append(script);
	};
	document.querySelector('#frame-container').append(frame);
</script>`
				: `<iframe title="Hash app" srcdoc="${escape_html(document)}"></iframe>`;

	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Inline hash host</title></head>
<body class="started">
<h1>Production hash embedding host</h1>
<p>Mode: ${escape_html(mode)}; base: ${escape_html(base)}; initial route: ${escape_html(route)}</p>
<nav>
<a href="?mode=srcdoc&base=explicit">Srcdoc with explicit base</a>
<a href="?mode=blank&base=explicit">About blank with explicit base</a>
<a href="?mode=data&base=explicit">Data with explicit base</a>
<a href="?mode=srcdoc&base=inherited">Srcdoc inherited base</a>
<a href="?mode=data&base=none">Data without network base</a>
</nav>
${frame}
<style>body { font-family: sans-serif; } iframe { display: block; width: 95vw; height: 75vh; margin-top: 1rem; } nav a { margin-right: 1rem; }</style>
</body></html>`;
}

/**
 * @param {string} shell_file
 * @returns {import('connect').NextHandleFunction}
 */
export function create_inline_handler(shell_file) {
	return (req, res, next) => {
		const url = new URL(req.url || '/', `http://${req.headers.host}`);
		if (url.pathname === '/hash-inline/host.html') {
			res.setHeader('content-type', 'text/html');
			res.end(render_host(readFileSync(shell_file, 'utf8'), url));
		} else if (url.pathname.endsWith('/probe.json')) {
			// Synthetic, credential-free fixture data can also be fetched from a data: frame.
			res.setHeader('access-control-allow-origin', '*');
			res.setHeader('content-type', 'application/json');
			res.end(JSON.stringify({ method: req.method, pathname: url.pathname }));
		} else if (
			url.pathname.endsWith('/submit') ||
			url.pathname.endsWith('/native') ||
			url.pathname === '/network/embedded/' ||
			url.pathname === '/outside'
		) {
			let body = '';
			req.on('data', (chunk) => (body += chunk));
			req.on('end', () => {
				res.setHeader('content-type', 'text/html');
				res.end(
					`<!doctype html><body class="started"><h1>Native request</h1><pre>${escape_html(JSON.stringify({ method: req.method, pathname: url.pathname, body }))}</pre>`
				);
			});
		} else {
			next();
		}
	};
}

/** @returns {import('vite').Plugin} */
export function inline_host() {
	return {
		name: 'inline-hash-host',
		configurePreviewServer(server) {
			server.middlewares.use(create_inline_handler('.svelte-kit/inline/shell.html'));
		}
	};
}
