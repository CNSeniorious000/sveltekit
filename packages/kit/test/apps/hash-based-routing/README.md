# Hash routing fixture variants

The default variant and existing tests exercise ordinary HTTP hash routing.

The production-only `inline` variant also sets `paths.base` to `/app` and
`output.bundleStrategy` to `inline`. It builds an independently generated fallback
at `.svelte-kit/inline/shell.html`, leaving the default build output separate.

From this app directory:

```sh
HASH_INLINE=true pnpm build
HASH_INLINE=true pnpm preview --host 0.0.0.0 --port 5304
KIT_E2E_VARIANT=inline KIT_E2E_PROJECT=js pnpm pw:build
```

The existing Chromium CI leg and the Firefox/Linux and WebKit/macOS inline-document legs run
`test:build`, which runs both the default HTTP variant and this inline variant. See the
[browser matrix commands](../embed/README.md#reproducing-the-browser-ci-matrix) for installing
the matching browser and running both fixture apps. These are browser tests, not WebView tests.

For configuration/test discovery only, run from this app directory:

```sh
KIT_E2E_BROWSER=webkit KIT_E2E_VARIANT=inline KIT_E2E_PROJECT=js pnpm exec playwright test --list
```

Repeat with `chromium` or `firefox`; omit `KIT_E2E_VARIANT` to collect the ordinary HTTP control.
Listing tests neither launches a browser nor verifies that a transport works in that browser.

Open `http://localhost:5304/hash-inline/host.html` for the fixture host, or
`http://localhost:5304/app/#/inline/a` for its normal HTTP control.

The host accepts `mode=srcdoc`, `mode=blank` or `mode=data`, `base=explicit` or
`base=inherited`, and `route=/inline/a` or `route=/inline/b`. `mode=data&base=none`
checks local routing without a usable HTTP base. The explicit base points to
`/network/embedded/`, deliberately outside the Kit base and hash route.

The production shell executes normally in the frame. The host initializes the
fragment before Kit starts and uses `document.write` only to embed the blank
frame. Playwright uses visible frame controls, not frame evaluation or injected
scripts. The blank frame is written by a script in its own realm so that its URL
remains `about:blank`. The host does not restore content after history traversal
or reload. Browsers can discard document-written blank content during history
traversal, including navigation among fragment entries created after startup.
Such a frame also has no native source to reload. The blank tests therefore cover
startup, links, `goto`, fetches, and native exits, with no back/forward or reload
guarantee. Full history and reload tests apply only to srcdoc and data frames.

The fixture covers startup, raw fragment links, `goto`, history back/forward,
reload, relative load fetches, native form and fetch POST, native link opt-outs, inherited base,
and a normal HTTP control. Browser-specific restrictions on data navigation may
prevent that transport from running; building or listing its tests is not a
browser pass.
