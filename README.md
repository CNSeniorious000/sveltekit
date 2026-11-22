# Unhandled streamed rejection during preload

Two-page reproduction using SvelteKit 3.4.0, Svelte 5.59.1, Vite 8.3.8 and
`@sveltejs/vite-plugin-svelte` 7.3.1.

## Reproduce

Use Node 22.17 or newer:

```sh
npm install
npm run dev
```

Open <http://127.0.0.1:5173> and the browser console. Once Page A says
"Hover the link before clicking it.", hover **Page B** without clicking.
The browser reports an unhandled rejection with `message: "Streamed failure"`
while the URL and page remain unchanged. Click the link: Page B's `{:catch}`
still displays **Streamed failure**.

Expected: preloading should not produce an unhandled rejection, and the rejected
data should remain available to the destination's error handler.

The server attaches a noop catch to its rejected promise. `hooks.server.js`
preserves the synthetic error message in dev and preview. There are no mocked
responses or artificial delays.

## Verify in Chromium

With the dev server running, use another terminal:

```sh
npx playwright install chromium
npm run verify
```

The script checks that the rejection occurs before leaving A, then that clicking
the link renders the same error and reuses the single preloaded data request.
It also verifies that the page later handles the original rejected promise.

For preview, stop the dev server, build and start preview:

```sh
npm run build
npm run preview
```

Then run `BASE_URL=http://127.0.0.1:4173 npm run verify` in another terminal.
After applying the client fix externally, use `EXPECT_UNHANDLED=0 npm run verify`
(or set both environment variables for preview). Rebuild before testing a patch
in preview.
