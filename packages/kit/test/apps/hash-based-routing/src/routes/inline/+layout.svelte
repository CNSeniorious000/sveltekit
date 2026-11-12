<script>
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';

	let { children } = $props();
	let document_url = $state('');
	let document_base = $state('');
	let instance = $state('');
	let native_fetch = $state('');

	afterNavigate(() => {
		document_url = location.href;
		document_base = document.baseURI;
	});

	onMount(() => {
		instance = Math.random().toString(36).slice(2);
	});
</script>

<h1>Inline hash fixture</h1>
<nav aria-label="Inline hash controls">
	<a href="#/inline/a">Raw hash A</a>
	<a href="#/inline/b">Raw hash B</a>
	<a href="#/inline/fetch">Relative load fetch</a>
	<button onclick={() => goto('#/inline/b')}>Hash goto B</button>
	<button onclick={() => history.back()}>Frame back</button>
	<button onclick={() => history.forward()}>Frame forward</button>
	<button onclick={() => location.reload()}>Frame reload</button>
</nav>
<dl>
	<dt>Route URL</dt>
	<dd><output data-route-url>{page.url.href}</output></dd>
	<dt>Document URL</dt>
	<dd><output data-document-url>{document_url}</output></dd>
	<dt>Effective base</dt>
	<dd><output data-document-base>{document_base}</output></dd>
	<dt>Instance</dt>
	<dd><output data-instance>{instance}</output></dd>
</dl>
<nav aria-label="Native controls">
	<a href="native" data-sveltekit-reload>Native reload link</a>
	<a href="#/inline/b" rel="external">Native external hash</a>
	<a href="/outside#/inline/b">Outside base link</a>
</nav>
<form method="POST" action="submit">
	<input name="message" value="hash-native-post" aria-label="Message" />
	<button>Native POST</button>
</form>
<button
	onclick={async () => {
		try {
			const response = await window.fetch('probe.json', {
				method: 'POST',
				body: 'hash-native-fetch-post'
			});
			native_fetch = await response.text();
		} catch (error) {
			native_fetch = String(error);
		}
	}}>Native fetch POST</button
>
<pre data-native-fetch-result>{native_fetch}</pre>

{@render children()}
