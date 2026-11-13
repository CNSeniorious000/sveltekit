<script>
	import { browser } from '$app/env';
	import { page } from '$app/state';
	import { invalidate, pushState, replaceState, goto } from '$app/navigation';

	let { data } = $props();
	let count = $state(0);
	const document_url = $derived(page.url.href.split('#')[0]);
</script>

<h1>Self-contained inline counter</h1>
<p data-testid="runtime">{browser ? 'browser' : 'server'}</p>
<p data-testid="page-url">{page.url.href}</p>
<p data-testid="route-id">{page.route.id}</p>
<p data-testid="params">{JSON.stringify(page.params)}</p>
<p data-testid="load-count">{data.load_count}</p>
<p data-testid="load-route">{data.load_route}</p>
<p data-testid="load-params">{JSON.stringify(data.load_params)}</p>
<p data-testid="load-url">{data.load_url}</p>
<button data-testid="refresh" onclick={() => invalidate('app:refresh')}>Refresh load</button>
<button data-testid="counter" onclick={() => count++}>Count: {count}</button>

<button data-testid="push-one" onclick={() => pushState('', { modal: 'one' })}>Push one</button>
<button data-testid="push-two" onclick={() => pushState('', { modal: 'two' })}>Push two</button>
<button
	data-testid="replace-current"
	onclick={() => replaceState(new URL(location.href), { modal: 'replace' })}>Replace current</button
>
<button
	data-testid="goto-current"
	onclick={() => goto(new URL(location.href), { shallow: true, state: { modal: 'goto' } })}
	>Goto current</button
>
<p data-testid="state">{JSON.stringify(page.state)}</p>

<nav aria-label="Native fragment navigation">
	<a data-testid="document-base-anchor" href="#base-anchor">Document-base anchor</a>
	<a data-testid="native-anchor" href={`${document_url}#anchor`}>Native anchor</a>
	<a
		data-testid="native-anchor-replace"
		href={`${document_url}#replacement`}
		data-sveltekit-replacestate>Replace anchor</a
	>
	<button data-testid="history-back" onclick={() => history.back()}>Back</button>
	<button data-testid="history-forward" onclick={() => history.forward()}>Forward</button>
</nav>

<div class="spacer"></div>
<h2 id="anchor" tabindex="-1">Native anchor target</h2>
<div class="spacer"></div>
<h2 id="replacement" tabindex="-1">Replacement anchor target</h2>
<div class="spacer"></div>

<style>
	nav {
		position: sticky;
		top: 0;
		background: white;
		padding: 0.5rem;
	}
	.spacer {
		height: 1000px;
	}
</style>
