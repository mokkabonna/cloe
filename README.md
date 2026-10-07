# CLOE — Teams external links

A focused Linux fork of [iltumio/cloe](https://github.com/iltumio/cloe).
Opens external HTTP(S) links clicked in a Chromium Teams PWA through your
system default handler (`/usr/bin/xdg-open`).

## Behavior and security boundary

- Injects only into `https://teams.microsoft.com/*` and
  `https://teams.cloud.microsoft/*`, in the top frame's isolated world.
- Handles trusted, unmodified left clicks on links in standalone PWA windows
  (including window-controls-overlay mode). Keyboard-activated trusted link
  clicks are also handled. Downloads and modified clicks retain normal behavior.
- Keeps links to the two Teams origins and `login.microsoftonline.com`,
  `login.microsoft.com`, and `login.live.com` in Chromium.
- External destinations must be HTTP(S), have no embedded credentials, and be
  at most 8192 characters (the helper additionally limits UTF-8 bytes).
- No page-message bridge, MAIN-world injection, storage, URL logging, settings
  broadcast, regex rules, or automatic navigation interception.
- The service worker validates Chromium-provided sender metadata and the URL
  again. It permits one native request at a time and a minimum 500 ms between
  requests while that worker lives. This throttle is not a durable quota.
- The native helper accepts at most 64 KiB per message, checks URL scheme,
  credentials and length, and invokes a fixed executable with a separate URL
  argument and no shell. It waits for the command's exit status.
- Failed requests do not navigate elsewhere. The console shows a generic warning;
  copy the link into your browser to retry.

The trusted-click and PWA checks live in the isolated content script. Native
messaging itself does not prove a user gesture. Teams still controls the content
and destination of a link the user clicks. This is not a phishing filter or a
sandbox for the default browser. A link opens using that browser's own sessions.

Programmatic `window.open` calls, buttons without an anchor, middle clicks, and
navigation assignments are intentionally not intercepted. Teams compatibility
must be tested with real links before relying on this fork. Microsoft Safe Links
are passed through unchanged; redirect destinations are not inspected. Additional
Teams/authentication origins require a reviewed policy change in
`extension/policy.js` (and manifest matches for new source pages).

## Build from reviewed source

Requirements: Linux, Node.js with `node:test`, Rust/Cargo, and `/usr/bin/xdg-open`.
The native dependency versions and checksums are committed in `Cargo.lock`.

```sh
git clone git@github.com:mokkabonna/cloe.git
cd cloe
git rev-parse HEAD  # record and review this revision before building
./scripts/build.sh
```

The script runs regression tests and builds the native helper with `--locked`.
Cargo may download the locked dependencies on the first run. It does not fetch
or execute GitHub release binaries, install files, or change browser settings.
Rust dependencies and the installed toolchain remain part of the build trust
boundary. There are no automatic updates or release-download installers.

## Install after review

1. In the Chromium profile that owns your Teams PWA (Entur's `Profile 2`), open
   `chrome://extensions`, enable Developer mode, and load this checkout's
   `extension/` directory unpacked. Do not load it in unrelated profiles.
2. Copy the extension ID, which must be exactly 32 letters in the range `a`–`p`.
3. Install the locally built `native-host/target/release/cloe-host` to a stable
   user-owned location. Register a Chromium native host named
   `com.iltumio.cloe` with this JSON, replacing both placeholders:

   ```json
   {
     "name": "com.iltumio.cloe",
     "description": "Open clicked Teams links in the default browser",
     "path": "/absolute/path/to/cloe-host",
     "type": "stdio",
     "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID/"]
   }
   ```

   Standard Chromium reads
   `~/.config/chromium/NativeMessagingHosts/com.iltumio.cloe.json`.
   Use your configuration manager for durable installation. On this user's
   machines, installation belongs in `~/code/system-customizations` and its
   Makefile; building this repository alone does not install it.
4. Restart the Teams PWA. Native host registration is shared by Chromium profiles,
   but only the listed extension ID is allowed to call it. The extension must be
   enabled in a profile for its content script to run there.

An unpacked extension uses the checkout's live files. Keep the loaded checkout at
an explicitly reviewed revision, and reload the extension after intentional
changes. Removing the extension and native host registration disables integration.

## Validation

```sh
node --test tests/*.test.cjs
cargo test --locked --manifest-path native-host/Cargo.toml
cargo fmt --check --manifest-path native-host/Cargo.toml
```

Tests use mocked extension APIs and side-effect-free native requests. They do not
open the real default browser. The built helper also has a process-level framing
smoke test in the Node test suite when its release binary exists.

Manual acceptance after installation:

- A normal external link in Teams opens once through the system browser handler.
- Teams chat and Microsoft sign-in links stay in Chromium.
- The same external link in a regular Teams browser tab behaves normally.
- Synthetic clicks and page `postMessage` calls do not open external browsers.
- With the native host unavailable, clicking does not navigate the PWA away.

## License

MIT; original copyright retained in [LICENSE](LICENSE).
