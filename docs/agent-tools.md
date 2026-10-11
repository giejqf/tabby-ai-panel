# Agent tools

The model works through the tools below, sent as OpenAI-style function definitions with every request. This page describes them as the model sees them. Read it to understand what the agent can do and what each card in the panel means. The definitions are in [`src/core/tools/index.ts`](../src/core/tools/index.ts).

| Tool | Purpose | Needs approval |
| --- | --- | --- |
| [`list_terminals`](#list_terminals) | List open terminals with key, label, connection, status and last line | never |
| [`read_terminal`](#read_terminal) | Read the last lines of a terminal without typing | never |
| [`run_command`](#run_command) | Type a command, press Enter, wait for the outcome | by risk |
| [`send_keys`](#send_keys) | Send keystrokes: answer prompts, drive full-screen apps, `ctrl-c` | by risk |
| [`wait_for_output`](#wait_for_output) | Keep waiting on a running command, optionally until a regex matches | never |
| [`ask_user`](#ask_user) | Ask you a question in the panel | never |
| [`open_terminal`](#open_terminal) | Open a new tab from a saved Tabby profile | as `medium` risk |
| [`focus_terminal`](#focus_terminal) | Switch your view to a terminal, for example so you can type a password | never |

"By risk" means the [approval mode](usage.md#approval-modes) decides, based on the risk level described in [Safety](safety.md#how-risk-is-assessed).

## Addressing terminals

Every tool that acts on a terminal takes a `terminal` argument. It can be:

- a session key such as `t2`,
- the word `active`, meaning the terminal you currently have in front,
- otherwise, case-insensitive and tried in this order: the exact label (`Linux-2`), the start of a label (`Linux`), or an SSH host name (`10.0.0.12`).

A leading `@` is ignored, so `@Linux-2` works too. Terminals you [removed from the session](usage.md#the-chip-bar) are never resolved. A key whose tab is closed produces an error that tells the model to ask you to reconnect it.

## Tools

### `list_terminals`

No parameters. Returns one line per terminal, for example:

```text
t1  "Linux-1"  ssh ubuntu@10.0.0.11  status: idle  [active tab]  last line: "ubuntu@linux-1:~$"
t2  "Linux-2"  ssh ubuntu@10.0.0.12  status: awaiting_input  last line: "Do you want to continue? [Y/n]"
```

The statuses are the same as on the [chip bar](usage.md#the-chip-bar). A `not_started` terminal is started automatically by the tools that need it.

### `read_terminal`

| Parameter | Type | Description |
| --- | --- | --- |
| `terminal` | string, required | Target terminal. |
| `lines` | integer | Lines from the bottom. Default 60, maximum 400. |

Reads the screen and scrollback. Lines that wrap on screen are joined back together. It notes when a full-screen program is active.

### `run_command`

| Parameter | Type | Description |
| --- | --- | --- |
| `terminal` | string, required | Target terminal. |
| `command` | string, required | Exact command line. Newlines are sent as Enter. |
| `risk_level` | `low` \| `medium` \| `high`, required | The model's own assessment. Local pattern checks can raise it, but never lower it. |
| `explanation` | string, required | One sentence for you: what it does and why. Shown on the card. |
| `timeout_seconds` | integer | How long to wait before reporting back. Defaults to the *Command time budget* setting (60 s), clamped to 2–3600. |

The command is rejected if the terminal is busy with another agent command, or if a full-screen program is open there.

Before typing, the runner records the prompt line so it can recognize the prompt when it returns. It then watches the terminal until one of the [result states](#result-states) applies. The result contains only the new output, without the echoed command and the trailing prompt.

### `send_keys`

| Parameter | Type | Description |
| --- | --- | --- |
| `terminal` | string, required | Target terminal. |
| `keys` | string[], required | Sequence of keys. Plain text is typed literally. |
| `explanation` | string, required | Why these keys are being sent. |
| `risk_level` | `low` \| `medium` \| `high` | Risk of what the keys cause. Confirming a destructive prompt is `high`. |
| `timeout_seconds` | integer | How long to wait for the terminal to settle. Default 15, maximum 600. |

No Enter is added unless the list contains `enter`. Special key names, case-insensitive:

| Names | Sends |
| --- | --- |
| `enter` / `return`, `tab`, `esc` / `escape`, `space`, `backspace`, `delete` | that key |
| `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown` | navigation keys |
| `f1` … `f4` | function keys |
| `ctrl-<key>` (also `ctrl+x`, `^x`), for example `ctrl-c`, `ctrl-d`, `ctrl-z`, `ctrl-l` | control characters |
| `alt-<key>` (also `meta-x`) | Escape followed by the key |

Approval: when every key is benign (`ctrl-c`, `ctrl-l`, `esc`, `enter`, `q`, `space`, the arrow keys, `pageup`/`pagedown`, `home`/`end`), the model's risk level is used, defaulting to `low`. Any other key, including typed text, is at least `medium`.

### `wait_for_output`

| Parameter | Type | Description |
| --- | --- | --- |
| `terminal` | string, required | Target terminal. |
| `timeout_seconds` | integer | Maximum wait. Default 60, maximum 3600. |
| `until_regex` | string | Return as soon as the new output matches this regular expression (multiline mode). |

Returns the output produced since the last read of that terminal. The agent uses it after a `timeout` or `idle` result, and after asking you to type something such as a password.

### `ask_user`

| Parameter | Type | Description |
| --- | --- | --- |
| `question` | string, required | Phrased so it can be answered briefly. |
| `choices` | string[] | Optional answers, shown as buttons. You can always type your own. |

The turn pauses until you answer. The answer goes back to the model as `User answered: …`.

### `open_terminal`

| Parameter | Type | Description |
| --- | --- | --- |
| `profile` | string, required | A Tabby profile name (an exact case-insensitive match is preferred), the SSH host of a profile, or part of a profile name. |

Opens a new tab and returns its key. It counts as `medium` risk, so it needs approval in the *Ask for every action* and *Auto-approve low-risk* modes. SSH logins that need a password are left for you to complete.

### `focus_terminal`

| Parameter | Type | Description |
| --- | --- | --- |
| `terminal` | string, required | Target terminal. |

Selects the tab and gives it keyboard focus. Used when you need to interact with the terminal yourself.

## Result states

`run_command`, `send_keys` and `wait_for_output` begin their result with a header line, for example `[t2 "Linux-2" · finished – prompt returned after 1.2 s · 3 lines]`. For states that need follow-up, a hint for the model comes next. The header names one of these states:

| State | Meaning | Typical next step |
| --- | --- | --- |
| `prompt` | The shell prompt came back after the output went quiet. The command finished. | Read the output |
| `matched` | `until_regex` matched. | Continue |
| `awaiting_input` | The last line looks like a question or password prompt (`[Y/n]`, `Password:`, …). | `send_keys`, or `ask_user` / `focus_terminal` for secrets |
| `alt_screen` | A full-screen program is open. The result shows the screen. | `send_keys` (`q`, `:q`, `ctrl-c`) |
| `idle` | No new output for a while and no prompt: 15 s for `run_command` (or the timeout, if shorter), 2.5 s after `send_keys`, 20 s for `wait_for_output`. | `wait_for_output`, `read_terminal`, or `ctrl-c` |
| `timeout` | Still running when the time budget ran out. | `wait_for_output` with a longer timeout |
| `reset` | The terminal was cleared or reconnected while waiting. | `read_terminal`, then retry if needed |
| `cancelled` | You stopped the agent. | — |

## Errors the model sees

Tool errors go back to the model as results starting with `Error:`, so it can correct itself. Examples are an unknown terminal, a busy terminal, an invalid regex, or unparsable arguments. When you deny an action, the model is told to explain what it needs instead of retrying it as-is.
