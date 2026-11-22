<script>
  let { data } = $props();
</script>

<h1>Page B</h1>
{#await data.failed}
  <p>Loading...</p>
{:catch error}
  <p role="alert">{error.message}</p>
{/await}
