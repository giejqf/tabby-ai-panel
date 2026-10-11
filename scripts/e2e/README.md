# End-to-end harness

Runs a real, headless Tabby (Xvfb) with the plugin loaded and drives it over the Chrome DevTools Protocol against a scripted fake model.

```bash
npm run build
node scripts/e2e/fake-llm.mjs &
scripts/e2e/run-tabby.sh &
node scripts/e2e/e2e.mjs send "Please run a quick check in the terminal"
```

Requirements, every script and step, and tips are documented in [docs/development.md](../../docs/development.md#end-to-end-tests).
