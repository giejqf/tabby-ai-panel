# End-to-end harness

Drives a real, headless Tabby with the plugin loaded. Used to verify things unit
tests cannot: plugin bootstrap, DOM mounting, typing into real shells,
cross-tab execution, session resume, hotkeys.

```bash
npm run build
node scripts/e2e/fake-llm.mjs &            # scripted OpenAI-compatible server on :18080
scripts/e2e/run-tabby.sh &                  # downloads Tabby once, runs it under Xvfb
sleep 25
node scripts/e2e/e2e.mjs send "Please run a quick check in the terminal"
node scripts/e2e/e2e.mjs wait-approval approval.png
node scripts/e2e/e2e.mjs approve
node scripts/e2e/e2e.mjs wait-idle done.png   # prints transcript, cards, chips, terminal text
node scripts/e2e/keys.mjs y ctrl alt           # press a hotkey (Ctrl+Alt+Y = approve)
node scripts/e2e/cdp.mjs "tabbyAiPanel.registry.list().map(e => e.label)"   # evaluate JS in the renderer
node scripts/e2e/shot.mjs shot.png
```

`window.tabbyAiPanel` exposes `{ host, agent, registry }` in the renderer for poking around.
Say "second terminal" in the message to make the fake model target the last tab,
"sleep" for a long-running command, "wireguard" for an `ask_user` question.
