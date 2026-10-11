# Development

- [Setup](#setup)
- [npm scripts](#npm-scripts)
- [Unit tests](#unit-tests)
- [End-to-end tests](#end-to-end-tests)
- [Debugging](#debugging)
- [Tabby plugin pitfalls](#tabby-plugin-pitfalls)
- [Code style](#code-style)
- [Releasing](#releasing)

For how the code is organized, see [Architecture](architecture.md).

## Setup

Prerequisites: **Node.js 22+** (the test script relies on `node --test` glob support) and **Tabby desktop**.

```bash
git clone https://github.com/giejqf/tabby-ai-panel.git
cd tabby-ai-panel
npm install
npm run build
npm run link:tabby
```

`link:tabby` symlinks the checkout to `<Tabby config dir>/plugins/node_modules/tabby-ai-panel`. Set `TABBY_PLUGINS` to link into a different plugins directory. Then:

1. Run `npm run watch` to rebuild on every change.
2. Restart Tabby to load the new bundle.

Tabby provides Angular, RxJS, ng-bootstrap and its own `tabby-*` packages at runtime, so webpack treats those as externals. `marked` and `dompurify` are bundled into `dist/index.js`. That is why all of them are `devDependencies`, and the Tabby/Angular ones are additionally declared as optional `peerDependencies`: Tabby's plugin manager would otherwise install copies of them.

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run build` | Production bundle → `dist/index.js` (webpack). |
| `npm run watch` | Rebuild on change, in development mode (`TABBY_DEV=1`: unminified, with a persistent build cache). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm test` | Unit tests with `node:test` + `tsx`. |
| `npm run badges` | Regenerate the README badges in `docs/assets/badges/` from `package.json` and a test run. |
| `npm run link:tabby` | Symlink the checkout into Tabby's plugins folder. |
| `npm run pack` | Zip the built plugin → `release/tabby-ai-panel-<version>.zip`. Requires `zip` and a prior build. |

## Unit tests

Tests live in `tests/*.test.ts` and run directly from TypeScript through `tsx`. No Tabby is needed. They cover the logic that does not depend on Angular:

| File | Covers |
| --- | --- |
| `terminal-runner.test.ts` | The runner against a fake terminal buffer: prompt detection, input requests, full-screen apps, idle/timeout, scrollback trimming, resets |
| `prompt-detect.test.ts` | Prompt and input-request heuristics |
| `prompt-builder.test.ts` | Session → messages, interrupted tool calls, context budgeting |
| `sse.test.ts` | SSE parsing and the streaming client against a local HTTP server |
| `models.test.ts` | `/v1/models` parsing (OpenAI, OpenRouter, Ollama), filtering, context-size labels |
| `risk.test.ts` | Risk assessment and approval modes |
| `keystroke.test.ts` | Matching the panel's hotkeys while it has focus |
| `sticky-scroll.test.ts` | Follow-the-bottom scrolling state |
| `text.test.ts` | Truncation, output tidying, titles, relative times |
| `docs.test.ts` | Docs stay in sync with the code: tools, settings and defaults, hotkeys, badge version |

Run one file with `node --import tsx --test tests/risk.test.ts`.

`docs.test.ts` fails when you add a tool, setting or hotkey without documenting it, or change a default without updating the docs. Fix it by updating [agent-tools.md](agent-tools.md), [configuration.md](configuration.md) or [usage.md](usage.md#keyboard-shortcuts).

## End-to-end tests

`scripts/e2e/` runs a **real Tabby** headlessly under Xvfb with the plugin loaded, and drives it over the Chrome DevTools Protocol against a scripted fake model. It catches what unit tests cannot: plugin bootstrap, DOM mounting, typing into real shells, cross-tab execution, session resume, and hotkeys.

Requirements: Linux (x64 or arm64) with `xvfb-run`, `curl`, `tar` and the usual Electron runtime libraries.

```bash
npm run build
node scripts/e2e/fake-llm.mjs &      # scripted OpenAI-compatible server on :18080
scripts/e2e/run-tabby.sh &           # downloads Tabby once into .e2e/, then runs it with CDP on :9222
# wait until http://localhost:9222/json responds (about 20–30 s)

node scripts/e2e/e2e.mjs send "Please run a quick check in the terminal"
node scripts/e2e/e2e.mjs wait-approval approval.png
node scripts/e2e/e2e.mjs approve
node scripts/e2e/e2e.mjs wait-idle done.png    # prints transcript, cards, chips and terminal text
```

| Script | Purpose |
| --- | --- |
| `run-tabby.sh` | Downloads `TABBY_VERSION` (default `1.0.235`) into `E2E_DIR` (default `.e2e/`), links the plugin, seeds a `config.yaml` that points at `http://127.0.0.1:18080` (only on first run), and starts Tabby with remote debugging on port 9222. The log goes to `.e2e/tabby.log`. |
| `fake-llm.mjs` | Picks the next step from the transcript: `list_terminals` → `run_command` → a summary. Include "second" in your message to target the last tab, "sleep" for a 40 s command, or "wireguard" for an `ask_user` question. Set `LOG_FILE=path` to dump every request. |
| `e2e.mjs <step>` | `send <text>`, `wait-approval [png]`, `approve`, `answer <choice>`, `wait-idle [png]`, `eval <js>`, `shot <png>`. |
| `cdp.mjs '<js>'` | Evaluate an expression in the renderer (promises are awaited). |
| `keys.mjs <key> [ctrl] [alt] [shift] [meta] [paste]` | Dispatch a key chord, for example `node scripts/e2e/keys.mjs y ctrl alt` to approve. |
| `shot.mjs [png]` | Take a screenshot. |

Tips:

- If port 18080 is taken, run the fake model on another port and repoint the running plugin:
  `node scripts/e2e/cdp.mjs "(() => { const c = tabbyAiPanel.agent['config']; c.store.aiPanel.endpoint = 'http://127.0.0.1:18081'; c.save() })()"`
- `.e2e/home/.config/tabby/config.yaml` persists between runs. Delete it to start from the seeded config.
- The headless window starts at 800×600. Resize it with
  `node scripts/e2e/cdp.mjs "require('@electron/remote').getCurrentWindow().setBounds({ x: 0, y: 0, width: 1400, height: 900 })"`.
- When killing Tabby from a script, match `"linux-*/tabb[y]"`-style patterns, so that the pattern does not also match your own shell's command line.

## Debugging

The module exposes its services in the renderer as `window.tabbyAiPanel`:

```js
tabbyAiPanel.registry.list().map(e => [e.label, tabbyAiPanel.registry.status(e)])
tabbyAiPanel.agent['state'].value.session           // current session
tabbyAiPanel.agent.buildMessages()                   // exactly what the next request would send
tabbyAiPanel.host.toggle()
```

Open the developer tools from **Settings → Application → Debugging → Open DevTools**. Plugin log lines are prefixed with `[ai-panel]`.

## Tabby plugin pitfalls

Things that cost time before. All of them are handled in the code, but keep them in mind when changing it:

- **`package.json` needs an `author` field.** Tabby's loader reads `author.name || author`. Without the field the plugin is skipped with only *Cannot load package info* in the log.
- **`config.store` is not ready in constructors.** Wait for `config.ready$` before reading settings or calling `ProfilesService.getProfiles()`.
- **No circular imports between a service and a component it creates.** `PanelHostService` creates `AiPanelComponent`, which injects the service. A value import in both directions causes a temporal-dead-zone error at load. The host uses `import type`, and the module registers the component class.
- **Tabby's hotkeys follow the focused *terminal*, not DOM focus.** Without suspending them while the panel has focus, pasting or pressing Ctrl+C in the message box also reaches the shell.
- **Restored tabs are dormant** until shown once (see [Architecture](architecture.md#terminal-registry)).

## Code style

There is no linter configured. Match the surrounding code: 4-space indentation, no semicolons, single quotes, a space before parameter lists in declarations (`method (arg) {`), and a short doc comment on anything non-obvious. Keep `src/core` free of UI concerns. Tools receive everything through `ToolContext`.

When you change behaviour, update the docs in the same change. `docs.test.ts` catches the mechanical parts.

## Releasing

1. Update [CHANGELOG.md](../CHANGELOG.md): move the *Unreleased* entries under the new version.
2. Bump the version with `npm version <patch|minor> --no-git-tag-version`. The `version` hook regenerates the badges (`npm run badges`). If you edit `package.json` by hand instead, run `npm run badges` yourself.
3. Run `npm run typecheck && npm test && npm run build`.
4. Check the build in Tabby: link it, or run the e2e harness.
5. Commit, tag `v<version>`, and push.
6. `npm publish`. `prepublishOnly` builds and tests again. Tabby's plugin manager lists the new version a few minutes later.
7. Optional: run `npm run pack` and attach `release/tabby-ai-panel-<version>.zip` to a GitHub release for manual installs.
