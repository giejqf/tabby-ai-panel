# Contributing

Thanks for your interest in Tabby AI Panel! Bug reports, ideas and pull requests are welcome.

## Reporting bugs and requesting features

Open an [issue](https://github.com/giejqf/tabby-ai-panel/issues). For bugs, please include:

- the plugin version (**Settings → Plugins**) and the Tabby version,
- your OS, the kind of terminal involved (local shell, SSH, split pane), and the model server and model,
- what you did, what you expected and what happened, plus any `[ai-panel]` lines from the developer tools console (**Settings → Application → Debugging → Open DevTools**).

Remove hostnames, IPs, keys and command output you don't want to share. Report security issues privately, as described in [SECURITY.md](SECURITY.md).

## Pull requests

1. Set up the project as described in [docs/development.md](docs/development.md).
2. Keep changes focused. Match the surrounding code style. Add or update unit tests for logic in `src/core`.
3. Update the docs in `docs/` (and the README if needed) in the same pull request, and add a line under *Unreleased* in [CHANGELOG.md](CHANGELOG.md).
4. Make sure these pass:

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

5. For UI or terminal behaviour, try the change in a real Tabby, either linked with `npm run link:tabby` or through the [end-to-end harness](docs/development.md#end-to-end-tests). Describe what you checked in the pull request.

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
