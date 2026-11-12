<script>
	import FormPage from '#lib/FormPage.svelte';

	let { data, form } = $props();
</script>

<FormPage {data} {form} />
