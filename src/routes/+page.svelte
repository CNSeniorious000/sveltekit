<script>
  import { onMount } from 'svelte';

  let ready = $state(false);
  onMount(() => {
    ready = true;
  });
</script>

<h1>Page A</h1>
<p>{ready ? 'Hover the link before clicking it.' : 'Starting...'}</p>
<a href="/b" data-sveltekit-preload-data="hover">Page B</a>
