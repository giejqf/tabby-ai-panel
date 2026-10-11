# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Documentation

- New README with logo, badges and an up-to-date screenshot. Detailed guides moved to [`docs/`](docs/README.md): getting started, usage, configuration, sessions, safety, agent tools, architecture and development.
- `npm run badges` renders the README badges locally with badge-maker. It also runs automatically on `npm version`.
- `tests/docs.test.ts` fails when the docs fall out of sync with the code (tools, settings and defaults, hotkeys, badge version, links).
- Added a changelog, contributing guide and security policy.

## [0.1.5] - 2026-10-04

### Added

- Searchable model picker fed by the server's `/v1/models`, in the settings page and as a quick switcher under the composer. It shows context sizes and tags models without tool support (OpenRouter), and accepts any typed id. Model lists are cached per endpoint and key for 5 minutes.

### Changed

- **Test** in settings reuses the model list and falls back to a one-token completion when the server has none. A non-JSON `200` response no longer counts as connected.

## [0.1.4] - 2026-10-04

### Changed

- The transcript reliably follows new output, and stops following as soon as you scroll up. Streaming reasoning and live command output stick to their newest line.

### Added

- A jump-to-bottom button, labelled *Approval needed*, *Question for you* or *New output* when something is waiting below.

## [0.1.3] - 2026-09-19

### Added

- **×** on a terminal chip removes that terminal from the session. The agent can no longer see or reach it. Removed terminals stay hidden across resume and can be restored from the *N hidden* chip.

### Removed

- The right-click attach/reconnect menu on chips. Clicking a closed chip reconnects it.

## [0.1.2] - 2026-09-13

### Added

- *Text size* setting. The whole panel scales with it.
- *Open folder* button for session storage in settings.

### Changed

- Clicking a closed terminal chip reopens its profile right away and keeps the tab's custom name.
- Filled toolbar icon (Tabby's toolbar CSS fills SVG icons).
- The package declares Tabby and Angular as optional peers and bundled libraries as dev dependencies, for Tabby's plugin manager.

## [0.1.1] - 2026-09-13

### Fixed

- Pasting or pressing Ctrl+C in the panel no longer also reaches the focused terminal. Tabby's hotkeys are suspended while the panel has focus, and the panel matches its own hotkeys.

## [0.1.0] - 2026-09-13

### Added

- First release: an agent that can address every terminal tab and split pane by key or label, run commands in background tabs, and detect prompts, input requests, full-screen programs, idle and timeouts.
- Persistent, resumable sessions with a searchable drawer, and terminals re-attached by descriptor on resume.
- Reviewable execution: risk badges, per-session approval modes, always-confirmed destructive patterns, live output, Send Ctrl+C, and hotkeys.
- Streaming client for OpenAI-compatible endpoints over Node HTTP, with tool calling, reasoning tokens and context budgeting.

[Unreleased]: https://github.com/giejqf/tabby-ai-panel/compare/3e93d65...HEAD
[0.1.5]: https://github.com/giejqf/tabby-ai-panel/commit/3e93d65
[0.1.4]: https://github.com/giejqf/tabby-ai-panel/commit/2a14e30
[0.1.3]: https://github.com/giejqf/tabby-ai-panel/commit/87d53fa
[0.1.2]: https://github.com/giejqf/tabby-ai-panel/commit/60886ef
[0.1.1]: https://github.com/giejqf/tabby-ai-panel/commit/e2760c0
[0.1.0]: https://github.com/giejqf/tabby-ai-panel/commit/eafd65f
