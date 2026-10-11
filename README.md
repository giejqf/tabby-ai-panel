<div align="center">

<img src="https://raw.githubusercontent.com/giejqf/tabby-ai-panel/main/docs/assets/logo.svg" width="112" height="112" alt="Tabby AI Panel logo">

# Tabby AI Panel

**An autonomous AI agent for the [Tabby](https://tabby.sh) terminal that works across all your tabs.**<br>
Local shells and SSH sessions on different machines, with persistent sessions and commands you approve.

<a href="https://www.npmjs.com/package/tabby-ai-panel"><img src="https://raw.githubusercontent.com/giejqf/tabby-ai-panel/main/docs/assets/badges/npm.svg" alt="npm version"></a>
<a href="https://tabby.sh"><img src="https://raw.githubusercontent.com/giejqf/tabby-ai-panel/main/docs/assets/badges/tabby.svg" alt="Tabby plugin"></a>
<a href="docs/getting-started.md#connect-a-model"><img src="https://raw.githubusercontent.com/giejqf/tabby-ai-panel/main/docs/assets/badges/api.svg" alt="Works with OpenAI-compatible APIs"></a>
<a href="docs/development.md#unit-tests"><img src="https://raw.githubusercontent.com/giejqf/tabby-ai-panel/main/docs/assets/badges/tests.svg" alt="Unit tests"></a>
<a href="LICENSE"><img src="https://raw.githubusercontent.com/giejqf/tabby-ai-panel/main/docs/assets/badges/license.svg" alt="MIT license"></a>

[Getting started](docs/getting-started.md) · [Documentation](docs/README.md) · [Changelog](CHANGELOG.md)

</div>

<br>

<p align="center">
  <img src="https://raw.githubusercontent.com/giejqf/tabby-ai-panel/main/docs/screenshot.png" alt="The AI panel next to a terminal: the agent compared two hosts and is waiting for approval to run sudo apt-get update on Linux-1">
</p>

Ask for something like *"set up a WireGuard tunnel between @Linux-1 and @Linux-2"*. The agent inspects both hosts, makes a plan, runs commands in the right tabs, reads the results, fixes problems, and verifies the tunnel from both sides. You approve each step, or decide which kinds of steps it may take on its own.

## Features

- **Works across terminals.** Every tab and split pane gets a stable key (`t1`, `t2`, …). Commands go to exactly the terminal they are meant for, in the background, without taking over your screen.
- **Understands what a terminal is doing.** It recognizes when the prompt is back, when a program waits for input (`[Y/n]`, passwords), when a full-screen app is open, and when a command is still running. It never types passwords.
- **Commands you can review.** Each action shows the target terminal, a risk badge, an explanation and live output. Approve every step, or auto-approve low- or medium-risk ones. Destructive commands such as `rm -rf /`, `mkfs` or `reboot` always ask.
- **Persistent sessions.** Conversations are saved as readable JSON. You can search, rename and resume them. On resume, terminals are re-attached to matching tabs, and closed SSH hosts reconnect with one click.
- **Works with any OpenAI-compatible model.** OpenRouter, OpenAI, LiteLLM, Ollama, LM Studio, llama.cpp, vLLM… with streaming, tool calling and visible reasoning. Requests go through Node.js, so local servers need no CORS setup.
- **Fits into Tabby.** A docked, resizable sidebar that follows your theme, a toolbar button, configurable hotkeys and a settings tab.

## Quick start

1. **Install**: in Tabby, open **Settings → Plugins**, search for `ai-panel`, click **Get**, and restart Tabby.
2. **Connect a model**: in **Settings → AI Panel**, enter your endpoint (for example `https://openrouter.ai/api` or `http://localhost:11434`) and API key, pick a model that supports tool calling, and click **Test**.
3. **Ask**: open the panel with the **AI Agent** toolbar button or `Ctrl+Alt+A` (`⌘⇧A` on macOS), mention a terminal with `@`, and press `Enter`.

Other ways to install (zip, from source) and endpoint examples are in [Getting started](docs/getting-started.md).

## Documentation

| Guide | What's inside |
| --- | --- |
| [Getting started](docs/getting-started.md) | Install, connect a model, run a first task, troubleshoot |
| [Using the panel](docs/usage.md) | Requests, approvals, terminal chips, sessions, keyboard shortcuts |
| [Configuration](docs/configuration.md) | Every setting and default, request parameters, context budget |
| [Sessions](docs/sessions.md) | Resume and re-attach, storage location, file format |
| [Safety](docs/safety.md) | Risk assessment, what is sent to the model, what is stored |
| [Agent tools](docs/agent-tools.md) | The tools the model can call and what their results mean |
| [Architecture](docs/architecture.md) | How the plugin works inside |
| [Development](docs/development.md) | Building, unit and end-to-end tests, releasing |

## Safety

You are giving a language model the ability to type into your terminals. Review its actions, keep **Ask for every action** on for machines that matter, and prefer a self-hosted model in sensitive environments. The risk checks are a safety net, not a guarantee. Read [Safety](docs/safety.md) for the details.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started, and [SECURITY.md](SECURITY.md) to report vulnerabilities privately.

## License

[MIT](LICENSE) © Qianfan Jiang
