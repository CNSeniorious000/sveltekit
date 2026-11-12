<script>
	import { browser } from '$app/env';
	import { afterNavigate, beforeNavigate, goto, invalidate, preloadData } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';

	let { data } = $props();
	let count = $state(0);
	let operation = $state('idle');
	let post_result = $state('');
	let unsaved = $state(false);
	let cancel_all = $state(false);
	let document_url = $state('');
	/** @type {Array<{ willUnload: boolean; toUrl: string | null; type: import('$app/navigation').BeforeNavigate['type'] }>} */
	let navigation_log = $state([]);
	const native_url = $derived(new URL(target('native'), data.load_url));
	afterNavigate(() => {
		document_url = location.href.split('#')[0];
	});

	beforeNavigate(({ willUnload, to, type, cancel }) => {
		navigation_log.push({ willUnload, toUrl: to?.url.href ?? null, type });
		if (cancel_all || (unsaved && willUnload)) cancel();
	});

	/** @param {string} slug */
	function target(slug) {
		return `${resolve('/memory/route/[slug]', { slug })}?token=${encodeURIComponent(data.token)}`;
	}

	async function preload() {
		const result = await preloadData(target('preloaded'));
		operation = `preloaded:${result.type}`;
	}

	async function post() {
		// Native fetch uses the live document base, while load fetch uses the route.
		const response = await fetch(
			`${resolve('/memory')}/data.json?token=${encodeURIComponent(data.token)}`,
			{
				method: 'POST',
				body: 'from-window'
			}
		);
		post_result = JSON.stringify(await response.json());
		await invalidate('memory:data');
		operation = 'posted';
	}

	async function refresh() {
		await invalidate('memory:data');
		operation = 'refreshed';
	}
</script>

<h1>Memory route: {data.load_slug}</h1>
<dl>
	<dt>Runtime</dt>
	<dd data-testid="runtime">{browser ? 'browser' : 'server'}</dd>
	<dt>Page URL</dt>
	<dd data-testid="page-url">{page.url.href}</dd>
	<dt>Route</dt>
	<dd data-testid="route-id">{page.route.id}</dd>
	<dt>Params</dt>
	<dd data-testid="params">{JSON.stringify(page.params)}</dd>
	<dt>Load URL</dt>
	<dd data-testid="load-url">{data.load_url}</dd>
	<dt>Load route</dt>
	<dd data-testid="load-route">{data.load_route}</dd>
	<dt>Load slug</dt>
	<dd data-testid="load-slug">{data.load_slug}</dd>
	<dt>Server URL</dt>
	<dd data-testid="server-url">{data.server_url ?? ''}</dd>
	<dt>Server route</dt>
	<dd data-testid="server-route">{data.server_route ?? ''}</dd>
	<dt>Server slug</dt>
	<dd data-testid="server-slug">{data.server_slug ?? ''}</dd>
	<dt>GET</dt>
	<dd data-testid="fetched">{JSON.stringify(data.fetched)}</dd>
	<dt>Load POST</dt>
	<dd data-testid="load-posted">{JSON.stringify(data.posted)}</dd>
	<dt>Redirected fetch</dt>
	<dd data-testid="redirected-fetch">{JSON.stringify(data.redirected)}</dd>
	<dt>Native POST</dt>
	<dd data-testid="native-posted">{post_result}</dd>
	<dt>State</dt>
	<dd data-testid="state">{JSON.stringify(page.state)}</dd>
	<dt>Shallow URL</dt>
	<dd data-testid="shallow-url">{page.shallow?.url.href ?? ''}</dd>
	<dt>Shallow slug</dt>
	<dd data-testid="shallow-slug">{page.shallow?.params?.slug ?? ''}</dd>
	<dt>Operation</dt>
	<dd data-testid="operation">{operation}</dd>
	<dt>Navigation log</dt>
	<dd data-testid="navigation-log">{JSON.stringify(navigation_log)}</dd>
</dl>

<nav>
	<a data-testid="link" href={target('linked')}>Link to linked</a>
	<!-- Relative links follow the effective document base, including its pathname. -->
	<a data-testid="relative-link" href={`relative?token=${encodeURIComponent(data.token)}`}>
		Relative link
	</a>
	<a data-testid="anchor-link" href={`${page.url.pathname}${page.url.search}#anchor`}>Anchor</a>
	<a data-testid="missing-route" href={`${resolve('/memory')}/not-found`}>Missing route</a>
	<a data-testid="endpoint-link" href={`${resolve('/memory')}/data.json`}>Server endpoint</a>
	<a data-testid="static-link" href={`${resolve('/memory')}/resource.txt`}>Static resource</a>
	<a data-testid="document-anchor" href={`${document_url}#anchor`}>Actual document anchor</a>
	<a data-testid="document-anchor-multihash" href={`${document_url}#anchor#sub`}
		>Actual anchor with two hashes</a
	>
	<a
		data-testid="document-anchor-replace"
		href={`${document_url}#replacement`}
		data-sveltekit-replacestate>Replace actual document anchor</a
	>
	<a data-testid="document-anchor-self" href={`${document_url}#anchor`} target="_self"
		>Self-targeted actual document anchor</a
	>
	<a data-testid="document-anchor-reload" href={`${document_url}#anchor`} data-sveltekit-reload
		>Reload actual document anchor</a
	>
	<a data-testid="document-anchor-external" href={`${document_url}#anchor`} rel="external">
		External actual document anchor
	</a>
</nav>
<label>
	<input data-testid="unsaved-guard" type="checkbox" bind:checked={unsaved} />
	Cancel only navigations that will unload this document
</label>
<label>
	<input data-testid="cancel-all" type="checkbox" bind:checked={cancel_all} />
	Cancel all navigations with hooks
</label>
<nav aria-label="Native navigation">
	{#each ['root', 'absolute'] as spelling}
		{@const href =
			spelling === 'absolute' ? native_url.href : native_url.pathname + native_url.search}
		<a data-testid={`native-reload-${spelling}`} {href} data-sveltekit-reload>
			Reload link ({spelling})
		</a>
		<a data-testid={`native-external-${spelling}`} {href} rel="external">
			External link ({spelling})
		</a>
		<a data-testid={`native-self-${spelling}`} {href} target="_self">
			Self-targeted link ({spelling})
		</a>
	{/each}
	<a
		data-testid="native-reload-relative"
		href={`native?token=${encodeURIComponent(data.token)}`}
		data-sveltekit-reload>Relative reload link</a
	>
	<a data-testid="native-reload-hash" href="#anchor" data-sveltekit-reload>Hash reload link</a>
</nav>
<nav aria-label="Sibling applications">
	<a data-testid="sibling-application" href="/application">Sibling application</a>
	<a data-testid="sibling-app2-query" href="/app2?query=1#anchor">Sibling with query and hash</a>
	<a data-testid="sibling-app2-slash" href="/app2/">Sibling with trailing slash</a>
	<a data-testid="sibling-app-encoded" href="/app%2foutside">Encoded slash outside app</a>
</nav>
<button data-testid="counter" onclick={() => count++}>Count: {count}</button>
<button data-testid="native-hash" onclick={() => (location.hash = 'anchor')}>Set native hash</button
>
<button
	data-testid="native-replace-hash"
	onclick={() => location.replace(`${document_url}#replacement`)}
>
	Replace native hash
</button>
<button data-testid="goto" onclick={() => goto(target('next'))}>Go to next</button>
<button
	data-testid="relative-goto"
	onclick={() => goto(`relative?token=${encodeURIComponent(data.token)}`)}>Relative goto</button
>
<button data-testid="preload" onclick={preload}>Preload</button>
<button data-testid="goto-preloaded" onclick={() => goto(target('preloaded'))}
	>Go to preloaded</button
>
<button data-testid="refresh" onclick={refresh}>Refresh load</button>
<button data-testid="post" onclick={post}>Native POST and refresh</button>
<button data-testid="load-post" onclick={() => goto(`${target('posted')}&post=1`)}
	>POST in load</button
>
<button
	data-testid="fetch-redirect"
	onclick={() => goto(`${target('fetch-redirect')}&fetch-redirect=1`)}>Fetch a redirect</button
>
<button
	data-testid="redirect"
	onclick={() => goto(`${resolve('/memory/redirect')}?token=${encodeURIComponent(data.token)}`)}
	>Server redirect</button
>
<button
	data-testid="shallow-push"
	onclick={() => goto(target('modal'), { shallow: true, state: { modal: 'open' } })}
	>Open shallow state</button
>
<button
	data-testid="shallow-replace"
	onclick={() =>
		goto(target('replaced'), { shallow: true, replace: true, state: { modal: 'replaced' } })}
	>Replace shallow state</button
>
<button data-testid="back" onclick={() => history.back()}>Back</button>
<button data-testid="forward" onclick={() => history.forward()}>Forward</button>
<button data-testid="reload" onclick={() => location.reload()}>Reload iframe</button>

<form>
	<input type="hidden" name="token" value={data.token} />
	<input aria-label="Search" name="query" value="form" />
	<button data-testid="get-form">Submit GET to this route</button>
</form>
<form action="relative">
	<input type="hidden" name="token" value={data.token} />
	<button data-testid="relative-get-form">Submit relative GET</button>
</form>

<div class="spacer"></div>
<h2 id="anchor" tabindex="-1">Anchor target</h2>
<div class="spacer"></div>

<style>
	:global(body) {
		font-family: sans-serif;
	}
	dl {
		display: grid;
		grid-template-columns: max-content minmax(0, 1fr);
		gap: 0.25rem 1rem;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	nav,
	button {
		margin: 0.25rem;
	}
	nav a {
		display: inline-block;
		margin: 0.15rem 0.3rem;
	}
	.spacer {
		height: 1500px;
	}
</style>
