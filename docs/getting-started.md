# Getting started

This guide takes you from nothing to a first agent task: install the plugin, connect a model, and run a request.

- [Requirements](#requirements)
- [Install](#install)
- [Connect a model](#connect-a-model)
- [Run your first task](#run-your-first-task)
- [Troubleshooting](#troubleshooting)

## Requirements

- **Tabby desktop**, 1.0.x. The plugin is developed and end-to-end tested against Tabby 1.0.235. It reads and writes files and makes HTTP requests through Node.js, so it does not work in Tabby Web.
- **An OpenAI-compatible chat completions endpoint** that supports **streaming** and **tool calling** (also called function calling). It can be a hosted service or a server on your own machine. See [Connect a model](#connect-a-model).

## Install

### From Tabby's plugin manager (recommended)

1. Open **Settings → Plugins**.
2. Search for `ai-panel` and click **Get** on *ai-panel*.
3. Restart Tabby.

### From a zip archive

A release zip contains the built plugin as a folder named `tabby-ai-panel/`. If you don't have one, build it from source with `npm run pack`, which writes `release/tabby-ai-panel-<version>.zip`. Unzip it into Tabby's plugin folder, so that you end up with `plugins/node_modules/tabby-ai-panel/package.json`:

| OS      | Plugin folder                                               |
| ------- | ----------------------------------------------------------- |
| Linux   | `~/.config/tabby/plugins/node_modules/`                     |
| macOS   | `~/Library/Application Support/tabby/plugins/node_modules/` |
| Windows | `%APPDATA%\tabby\plugins\node_modules\`                     |

```bash
# Linux example
mkdir -p ~/.config/tabby/plugins/node_modules
unzip tabby-ai-panel-<version>.zip -d ~/.config/tabby/plugins/node_modules
```

Then restart Tabby.

### From source

For working on the plugin itself. You need Node.js 22 or newer.

```bash
git clone https://github.com/giejqf/tabby-ai-panel.git
cd tabby-ai-panel
npm install
npm run build
npm run link:tabby   # symlinks this checkout into Tabby's plugin folder
```

Restart Tabby afterwards. For the full development workflow, see [Development](development.md).

## Connect a model

Open **Settings → AI Panel**. You can also click the gear icon in the panel header.

1. **Endpoint**: the base URL of the server. You can also paste a URL ending in `/v1` or `/v1/chat/completions`, since everything after the base is stripped. The plugin then calls `<base>/v1/chat/completions` for chat and `<base>/v1/models` for the model list.
2. **API key**: sent as `Authorization: Bearer <key>`. Leave it empty for local servers that don't check keys.
3. **Model**: pick one from the list the server reports. If the server doesn't list models, or the one you want is missing, type its id. The model **must support tool calling**. When the server reports it (OpenRouter does), models without tool support are tagged *no tools*.
4. Click **Test**. It reports `Connected.` and how many models the server lists. If the server has no model list, Test sends a one-token completion instead.

Some typical endpoints:

| Server                  | Endpoint                      | API key       | Notes                                                                              |
| ----------------------- | ----------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| OpenRouter              | `https://openrouter.ai/api`   | your key      | Lists context sizes and tool support per model.                                   |
| OpenAI                  | `https://api.openai.com`      | your key      |                                                                                    |
| Ollama                  | `http://localhost:11434`      | none          | Use a model with tool support.                                                     |
| LM Studio               | `http://localhost:1234`       | none          | Start the local server in LM Studio first.                                         |
| llama.cpp (`llama-server`) | `http://localhost:8080`    | none          | Start it with `--jinja` so tool calls work.                                       |
| vLLM                    | `http://localhost:8000`       | if configured | Enable tool calling: `--enable-auto-tool-choice --tool-call-parser <parser>`.      |
| LiteLLM proxy           | `http://localhost:4000`       | proxy key     |                                                                                    |

> [!NOTE]
> The plugin always appends `/v1/chat/completions` to the base URL. A provider whose OpenAI-compatible API lives under a different path, not `…/v1`, cannot be used directly. Put a proxy such as LiteLLM in front of it.

Requests go through Node's HTTP stack instead of the browser's `fetch`, so self-hosted servers need no CORS configuration.

All settings, including request parameters such as `temperature` and extra instructions for the agent, are described in [Configuration](configuration.md).

## Run your first task

1. Open the panel with the **AI Agent** (robot) button in the top-right toolbar, or press `Ctrl+Alt+A` (`⌘⇧A` on macOS).
2. Make sure the terminals you want to work with are open as tabs. Local shells, SSH sessions and split panes all count.
3. Type a request and press `Enter`. Type `@` to mention a terminal by name, for example:

   ```text
   What is running on port 8080 in @Linux-1?
   ```

4. The agent explains what it will do and proposes commands as cards. In the default mode, **Ask for every action**, nothing is typed into a terminal until you click **Approve** (or press `Ctrl+Alt+Y`).
5. Read the result and continue the conversation. Everything is saved automatically as a session you can resume later.

Next, read [Using the panel](usage.md) to learn about approval modes, the terminal chips and sessions. Read [Safety](safety.md) before you let the agent near machines that matter.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| No **AI Agent** button and no **AI Panel** settings tab | The plugin did not load. Check that the folder is `plugins/node_modules/tabby-ai-panel/` and contains `package.json` and `dist/index.js`, then restart Tabby. Load errors appear in the developer tools console (**Settings → Application → Debugging → Open DevTools**). |
| *Set the LLM endpoint in Settings → AI Panel first.* | No endpoint is configured. |
| `HTTP 401` / `HTTP 403` from the endpoint | Wrong or missing API key. |
| `HTTP 404` on chat | The endpoint does not serve `/v1/chat/completions` under the base URL you entered. See the note above. |
| The model answers but never runs anything | The model or server does not support tool calling, or the server needs a flag to enable it (vLLM, llama.cpp). |
| *Could not load models* in the model picker | The server's `/v1/models` failed. You can still type a model id. |
| A command card ends with *still running* or *no new output* | That is normal for long commands. The agent can keep waiting. Use **Send Ctrl+C** on the card to interrupt. |
