<script>
	let { data } = $props();
</script>

<h2>Hash fetch result</h2>
<output data-fetch-status>{data.status}</output>
<pre data-fetch-result>{data.response}</pre>
