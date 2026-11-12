# Embedded applications

The default variant retains the existing `embedded: true` test. The historically named `memory`
variant uses `output.bundleStrategy: 'inline'`, `paths.base: '/app'`, the normal pathname router,
and `embedded: false`. This isolates inline route/params hydration from the existing embedded
behavior. There is no public memory-router option or host persistence protocol.

From this directory:

```sh
KIT_E2E_VARIANT=memory pnpm test:dev
KIT_E2E_VARIANT=memory pnpm pw:build
# The normal production command runs both default and inline variants:
pnpm test:build
# Manual production preview:
MEMORY_ROUTING=true pnpm build
MEMORY_ROUTING=true pnpm preview --host 0.0.0.0 --port 5303
```

### Reproducing the browser CI matrix

The existing CI `test:build:rest` leg runs both variants with Chromium. Dedicated Firefox
(Linux) and WebKit (macOS) legs run this app and `hash-based-routing` with JavaScript enabled.
They use the existing browser setup, server lifecycle, retries and failure artifacts.

On a supported machine where browser execution is permitted, run from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm run sync-all
# Repeat with firefox and webkit. Chromium tests use the installed Chrome channel.
pnpm exec playwright install chrome
KIT_E2E_BROWSER=chromium KIT_E2E_PROJECT=js pnpm --dir packages/kit --workspace-concurrency=1 --filter=test-embed --filter=test-hash-based-routing test:build
```

For Firefox, install `firefox` and set `KIT_E2E_BROWSER=firefox`; for WebKit, install `webkit`
and set `KIT_E2E_BROWSER=webkit`. On supported Linux hosts, Playwright's `install --with-deps`
can install required system packages when authorized. Use a normal supported environment,
not flags that disable browser security or a workaround for blocked transports.

To discover only this inline project's tests without building, starting a server or launching
a browser, run from this app directory:

```sh
KIT_E2E_BROWSER=firefox KIT_E2E_VARIANT=memory KIT_E2E_PROJECT=js pnpm exec playwright test --list
```

Omit `KIT_E2E_VARIANT` for the default embedded control. Discovery verifies configuration and
collection only, not execution or a passing browser result. The two apps' production scripts
run default plus inline variants sequentially; do not set a global variant when invoking both.

Open `http://localhost:5303/app/memory`. The HTTP host fetches rendered HTML and inserts it into an
iframe, recording original SSR values below it. The default `<base>` is the source page URL.
Query options can be combined:

- `transport=srcdoc` (default) or `transport=blank` (iframe-realm `document.write`).
- `transport=data&simple&base=opaque`: production-only self-contained data URL hydration,
  route/params, counter and no-network invalidation. This does not test WebView-specific behavior.
- `base=inherited`, `base=relative`, or `base=alternate` (`/app/memory/client/`).
- `csp=base-none`: reject an explicit cross-origin base; use only the effective browser base.
- `simple&base=opaque`: self-contained dynamic SSR counter with `about:blank` as its base.
- `cache=miss`: remove SSR fetch scripts to force relative network fetches.
- `two`: independent iframe data tokens; `csr`: SSR-disabled dynamic route;
  `redirect`: browser-only initial-load redirect.
- `forms=default`: missing/empty/cross-page enhanced actions;
  `forms=named`: named actions, submitter overrides and redirects.
- `sandbox`: srcdoc with `allow-scripts allow-forms`, without `allow-same-origin`.

## URL and navigation contract

Inline about/data documents keep logical pathname navigation in existing Kit history metadata;
HTTP(S) retains ordinary routing. The initial logical URL combines the effective HTTP(S) base's
origin with the source pathname/query. An inherited or relative base is valid; the host must supply
an appropriate base if its origin differs from the source application.

Pathname `load.fetch` is route-relative. Native `window.fetch`, links, `goto`, and nonempty form
actions use the document base. Empty enhanced form actions use the logical current page. The unload
guard can cancel native opt-outs, sibling mounts, and unmatched HTTP destinations. Server-only
endpoints, static resources and unknown HTTP routes retain ordinary server fallback; they are not
forced into iframe-local 404s. Matched pages navigate internally.

Self-contained baseless documents can hydrate and rerun no-network universal loads. Relative
network requests need a usable base even with serialized fetch data, since dependencies require
absolute URLs. Absolute requests obey native CORS and may miss path-only SSR cache entries,
including POST responses. The framework does not infer an unknown origin. Serialized remote
prerender results remain usable without a network base.

## Native limits and coverage

- When the browser replays the srcdoc on reload, the source path/query replays its SSR snapshot;
  a different retained logical path/query discards stale markup and fetch/remote seeds before
  client rendering. This is not a guarantee that every browser can reload that document.
- Browsers may discard document-written blank content during history traversal or reload, even
  without Kit. Blank tests cover startup, links, goto, requests and native fragment push/replace,
  not persistence of discarded HTML. The host never automatically restores it.
- Simple fragment controls name the actual document URL. A bare fragment instead follows the
  document base, which may name a different document. Actual document anchors preserve the
  current logical pathname, including after a route change with an HTTP base. Srcdoc also tests
  Back/Forward for router-observed anchor clicks.
- Script-created fragment entries have no Kit navigation indices. Immediate native hash changes
  preserve the current logical pathname, without assigning synthetic indices or adding storage.
  Arbitrary script hash history and cancellation retain ordinary Kit's existing limitations;
  these tests do not promise a complete traversal model for entries Kit did not create.
- Opaque sandboxes may deny storage and discard history state on reload. Tests observe retained
  state or source replay without fabricating history. Sandbox tests require production inline
  output; development module requests are not made to work by relaxing CORS or CSRF.
- The pathname data transport covers only the self-contained no-network route. Its HTTP-base
  network path is not covered: the existing server endpoints do not grant cross-origin access
  to opaque data documents. No CORS, credentials or CSRF behavior is relaxed for this fixture.
  Collecting/building this test is not a data-browser pass; execute it only where the transport
  is permitted. Use the [hash fixture's inline variant](../hash-based-routing/README.md) for
  separate srcdoc/blank/data hash routing and HTTP controls. Hash output cannot use this
  fixture's server loads, actions and host endpoints.

### Cross-browser findings on this investigation branch

The native controls reproduce boundaries without loading Kit in the tested document:

- In the tested Firefox engine, calling `replaceState` or `pushState` in srcdoc prevents a later
  reload from replaying the source. The untouched srcdoc reload control passes. This affects both
  pathname and hash routing. The branch does not implement a host-side reload or persistence shim.
- In the tested WebKit engine, a document-written about:blank frame can update history state and
  fragments without appending a history entry. Back can consequently leave the whole host.
  Application tests compare with an isolated native host performing the same operation, and
  annotate document disposal or host departure explicitly. A passing comparison means native
  behavior is preserved, not that backward navigation keeps the app alive.
- Chromium can discard a document-written about:blank body on history traversal while retaining
  the entry's state. Tests likewise verify this against the native control rather than recreate
  the missing HTML.

The standalone native-history and Firefox reload probes still assert the desired full behavior
and remain red on affected engines. They are intentionally retained during investigation, not
silently skipped or treated as a complete cross-browser pass. Ordinary HTTP WebKit comparison
jobs separately test the unmodified upstream revision; flakes there are not proof that the patch
improves or breaks HTTP behavior. These observations are specific to the engines run by this
matrix, not a promise about all browser versions or WebViews.
