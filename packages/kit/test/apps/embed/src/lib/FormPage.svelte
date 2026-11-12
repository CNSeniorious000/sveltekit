<script>
	import { browser } from '$app/env';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';

	let { data, form } = $props();
</script>

<h1>Enhanced {data.mode} actions</h1>
<p data-testid="runtime">{browser ? 'browser' : 'server'}</p>
<p data-testid="page-url">{page.url.href}</p>
<p data-testid="route-id">{page.route.id}</p>
<p data-testid="server-url">{data.server_url}</p>
<p data-testid="form-prop">{JSON.stringify(form)}</p>
<p data-testid="form-state">{JSON.stringify(page.form)}</p>
<p data-testid="status">{page.status}</p>

{#if data.mode === 'default'}
	<form method="post" use:enhance>
		<input name="value" value="implicit" aria-label="Implicit action value" />
		<button data-testid="implicit-action">Submit with no action</button>
	</form>
	<form method="post" action="" use:enhance>
		<input name="value" value="empty" aria-label="Empty action value" />
		<button data-testid="empty-action">Submit with empty action</button>
	</form>
	<form method="post" action="named?/save" use:enhance>
		<input name="value" value="cross-page" aria-label="Cross-page value" />
		<button data-testid="cross-success">Submit to another page</button>
		<button data-testid="cross-failure" formaction="named?/reject">Fail on another page</button>
	</form>
{:else}
	<form method="post" action="?/save" use:enhance>
		<input name="value" value="named" aria-label="Named action value" />
		<button data-testid="named-action">Save</button>
		<button data-testid="submitter-action" formaction="?/other" name="submitter" value="button">
			Override action
		</button>
		<button data-testid="redirect-action" formaction="?/redirect">Redirect after action</button>
	</form>
{/if}
