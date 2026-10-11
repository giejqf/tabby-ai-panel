# Configuration

Change all settings in **Settings → AI Panel**. They are stored in Tabby's own config file (`config.yaml`) under the `aiPanel` key, next to the rest of your Tabby configuration, and take effect immediately.

- [Settings reference](#settings-reference)
- [Example `config.yaml`](#example-configyaml)
- [Extra request parameters](#extra-request-parameters)
- [Additional instructions](#additional-instructions)
- [How the context budget works](#how-the-context-budget-works)
- [Hotkeys](#hotkeys)
- [Resetting](#resetting)

## Settings reference

### Model endpoint

| Setting | Key | Default | Description |
| --- | --- | --- | --- |
| Endpoint | `endpoint` | `''` | Base URL of an OpenAI-compatible server. A trailing `/v1` or `/v1/chat/completions` is accepted and stripped. See [Connect a model](getting-started.md#connect-a-model). |
| API key | `apiKey` | `''` | Sent as `Authorization: Bearer <key>`. Empty means no header. |
| Model | `model` | `''` | Model id sent with each request. When empty, the request uses the id `default`, which some single-model servers accept. Also switchable from the composer. |
| Extra request parameters (JSON) | `extraParamsText` | `''` | A JSON object merged into every chat request. See [below](#extra-request-parameters). |
| Additional instructions | `additionalSystemPrompt` | `''` | Text appended to the built-in system prompt. See [below](#additional-instructions). |

### Safety

| Setting | Key | Default | Description |
| --- | --- | --- | --- |
| Default approval mode | `approvalMode` | `ask` | Mode for new sessions: `ask`, `auto_low`, `auto_medium` or `auto_all`. Each session can override it from the composer. See [Approval modes](usage.md#approval-modes). |
| Command time budget | `defaultCommandTimeout` | `60` | Seconds `run_command` waits before reporting back when the model does not set `timeout_seconds`. The agent can keep waiting afterwards. |

### Panel

| Setting | Key | Default | Description |
| --- | --- | --- | --- |
| Dock side | `panelSide` | `right` | `right` or `left`. |
| Text size | `fontSize` | `13` | Base font size of the panel in px (9–24). Cards, chips and buttons scale with it. |
| Switch to the terminal the agent is working in | `focusTerminalOnRun` | `false` | Bring the target tab into view when the agent acts there. Keyboard focus stays in the panel. |
| Show model reasoning | `showReasoning` | `true` | Show a collapsible *Reasoning* section for models that stream their thinking. |
| Name sessions automatically | `autoTitle` | `true` | Use the first message as the session title. |
| *(drag the panel edge)* | `panelWidth` | `420` | Panel width in px. Minimum 300. |
| *(open/close the panel)* | `panelVisible` | `false` | Whether the panel was open. Restored on startup. |

### Context

| Setting | Key | Default | Description |
| --- | --- | --- | --- |
| Max characters of command output sent to the model | `maxToolResultChars` | `12000` | A longer tool result is cut in the middle (head and tail are kept). The panel still shows the full output. |
| Context budget (characters) | `maxContextChars` | `160000` | Approximate size limit of the whole prompt, at about 4 characters per token. See [below](#how-the-context-budget-works). |

The settings page also shows where sessions are stored, with an **Open folder** button. The location is described in [Sessions](sessions.md#storage).

## Example `config.yaml`

```yaml
aiPanel:
  endpoint: https://openrouter.ai/api
  apiKey: sk-or-...
  model: anthropic/claude-sonnet-4.5
  extraParamsText: '{"temperature": 0.2}'
  additionalSystemPrompt: |
    Hosts named prod-* are production: ask before changing anything there.
    Prefer podman over docker.
  approvalMode: auto_low
  defaultCommandTimeout: 120
  panelSide: right
  fontSize: 13
```

Keys you leave out use their defaults.

> [!IMPORTANT]
> The API key is stored in Tabby's config file like any other setting. Protect that file accordingly.

## Extra request parameters

The JSON object is spread into the body of every `/v1/chat/completions` request, after the plugin's own fields. Typical uses:

```json
{ "temperature": 0.2, "max_tokens": 4096 }
```

```json
{ "reasoning_effort": "high" }
```

```json
{ "reasoning": { "effort": "medium" }, "provider": { "sort": "throughput" } }
```

The last example uses OpenRouter-specific fields. Two consequences of how the merge works:

- The plugin sets `model`, `messages`, `stream: true`, `tools` and `tool_choice: "auto"`. Keys you set here take precedence over `model` and `stream`. `tool_choice` is only set to `"auto"` if you did not set it.
- If the text is not valid JSON, the settings page shows an error and requests are sent without extra parameters. A notification tells you this when a turn starts.

## Additional instructions

The agent's built-in instructions are in [`src/prompts/system.md`](../src/prompts/system.md). They cover how to address terminals, gathering facts before changing things on several hosts, preferring non-interactive flags, never typing passwords, and honest risk levels. Your additional instructions are appended after a blank line. Good things to put there:

- conventions ("use `doas` instead of `sudo`", "configs live in `/srv/app`"),
- hosts to be careful with ("never restart services on `db-1` without asking"),
- preferred tools and output style.

## How the context budget works

Before each model call, the stored session is turned into chat messages:

1. Each tool result is cut to **Max characters of command output** (`maxToolResultChars`), keeping its head and tail.
2. If the whole prompt is still larger than the **Context budget** (`maxContextChars`), old tool output is replaced by `[earlier output elided to save context – N chars]`, oldest first.
3. If that is not enough, the oldest exchanges are dropped and the model is told that earlier conversation was truncated.

The system prompt and your latest message are never dropped. The session file keeps everything, whatever was sent.

Set the budget to match your model: roughly 4 × the context window in tokens, minus room for the answer. The default of 160 000 characters suits models with a context window of about 64k tokens or more.

## Hotkeys

The panel registers these hotkeys with Tabby. Their default bindings are listed in [Keyboard shortcuts](usage.md#keyboard-shortcuts). Rebind them under **Settings → Hotkeys** (search for *AI panel*). They are stored in `config.yaml` under `hotkeys` with these ids:

| Id | Action |
| --- | --- |
| `ai-panel-toggle` | Toggle the panel |
| `ai-panel-approve` | Approve the pending action |
| `ai-panel-deny` | Deny the pending action |
| `ai-panel-stop` | Stop the agent |
| `ai-panel-focus-input` | Focus the message box (opens the panel) |
| `ai-panel-new-session` | New session |

## Resetting

**Reset settings** at the bottom of the settings page restores every `aiPanel` setting to its default, **including the endpoint, API key and model**. Sessions and hotkeys are not affected.
