# Using the panel

- [Panel layout](#panel-layout)
- [Writing requests](#writing-requests)
- [Reviewing and approving actions](#reviewing-and-approving-actions)
- [Terminals](#terminals)
- [Answers and the transcript](#answers-and-the-transcript)
- [Sessions](#sessions)
- [Keyboard shortcuts](#keyboard-shortcuts)

## Panel layout

Open and close the panel with the **AI Agent** toolbar button or `Ctrl+Alt+A` (`⌘⇧A` on macOS). The panel docks to the right of the terminal area by default. You can move it to the left under **Settings → AI Panel → Dock side**. Drag its inner edge to resize it, between 300 px and 80 % of the window width. The width is remembered, and so is whether the panel was open, so it comes back after a restart.

From top to bottom:

| Area | What it holds |
| --- | --- |
| **Header** | ☰ opens the [session drawer](#sessions). Next comes the session title (double-click to rename it) and a status line: *Thinking…*, *Working…*, *Waiting for your approval* or *Waiting for your answer*. Then **+** (new session), ⚙ (settings) and × (close). |
| **Terminal strip** | One chip per open terminal, plus any closed terminal this session used. See [Terminals](#terminals). |
| **Transcript** | Your messages, the agent's answers, collapsible reasoning, and a card for every action. |
| **Composer** | The message box. Below it are the session's approval mode, the token count, and the model switcher. |

## Writing requests

- Press `Enter` to send and `Shift+Enter` for a new line.
- Type `@` to mention a terminal. A list of open terminals appears: use `↑`/`↓` to move, `Enter` or `Tab` to insert `@Label`, and `Esc` to close it. Mentions are for the model to read. You can also refer to terminals in plain words ("the second machine").
- Every message carries a snapshot of the open terminals: their keys, labels, connections (such as `ssh ubuntu@10.0.0.11`), statuses, and which one is active. The model therefore knows what exists without having to ask. The snapshot isn't shown in the transcript.
- While the agent is working you can draft your next message, but you can only send it after the turn ends. Press the ■ button or `Ctrl+Alt+S` to stop the agent.
- The model name at the bottom right is a quick switcher. It lists what the server reports and accepts any typed id. It changes the same global **Model** setting as the settings page. A change made while a task runs applies from your next message.

A turn ends when the model answers without requesting more tools. If one turn goes past 80 tool rounds, the agent pauses and you can send a message to let it continue.

## Reviewing and approving actions

Each tool call is shown as a card with a title (such as *Run in Linux-2*), a status, and for commands:

- a **risk badge** (`low`, `medium` or `high`)
- the exact **command**
- the model's one-sentence **explanation**
- the **output**, live while the command runs, collapsible afterwards. If the output was cut before being sent to the model, the card says *shortened for the model*; the card itself always shows the full output.

The ↗ icon on a card switches to the terminal it ran in.

### Approve or deny

Actions that change something (`run_command`, `send_keys`, `open_terminal`) can wait for your approval. Read-only tools never do. When a card shows **Needs approval**:

- **Approve** (`Ctrl+Alt+Y`) runs it.
- **Deny** (`Ctrl+Alt+X`) refuses it. The model is told not to retry the action as-is.
- The caret next to **Approve** offers **Approve, and auto-approve low-risk actions for this session**, which also switches the session from *Ask for every action* to *Auto-approve low-risk*.

### Approval modes

The shield selector under the composer sets the mode **for the current session**. The default for new sessions is set in **Settings → AI Panel → Default approval mode**.

| Mode | What runs without asking |
| --- | --- |
| Ask for every action *(default)* | Nothing. Every command, keystroke and new tab needs approval. |
| Auto-approve low-risk | Read-only actions (risk `low`). |
| Auto-approve low + medium | Everything except `high` risk. |
| Auto-approve everything | Everything except commands that match a destructive pattern. |

Commands that match a destructive pattern, such as `rm -rf /`, `mkfs`, `reboot` or a firewall flush, **always** ask, in every mode, and the card shows a warning. How risk is assessed is described in [Safety](safety.md#how-risk-is-assessed).

### Interrupting

When a command may still be running (it timed out, went quiet, is waiting for input, or you stopped the agent), its card offers **Send Ctrl+C** for that terminal. Stopping the agent (`Ctrl+Alt+S`) ends the turn but does not interrupt the command in the terminal; that is what **Send Ctrl+C** is for.

## Terminals

Every terminal tab, including each pane of a split tab, gets a short key the first time the session sees it: `t1`, `t2`, and so on. The key belongs to the session and is stable. The model uses keys or labels to say exactly which terminal a command goes to, so a command never lands "wherever you happen to be looking".

Labels come from the tab: a name you gave it, otherwise the profile name for non-local tabs (SSH, serial, telnet), otherwise the tab title. Duplicates get a suffix (`Linux-1 #2`).

### The chip bar

| Element | Meaning |
| --- | --- |
| Status dot | `idle`, `active` (output in the last 1.5 s), `running` (the agent is driving it), `awaiting_input` (looks like a `[Y/n]` or password prompt), `alt_screen` (a full-screen program such as `vim` or `htop`), `not_started` (restored at startup and not yet shown). Hover a chip for its key, connection and status. |
| Click a chip | Switches to that tab. |
| Click a closed chip (🔌) | Reopens the tab from its Tabby profile, keeping the custom name you gave the original tab, and re-attaches it to the same key. |
| **×** on a chip | Removes the terminal from this session. The agent can no longer see or reach it. It disappears from the snapshot, `list_terminals` and @-mentions, and every tool rejects it. The tab itself stays open. Disabled while the agent is running something there. |
| **N hidden** | Lists the removed terminals; click one to restore it. |

### Working in the background

By default the agent works in background tabs and leaves your view and keyboard focus alone. If you want to watch, turn on **Settings → AI Panel → Switch to the terminal the agent is working in**. Keyboard focus stays in the panel either way.

Tabs restored at startup have no running shell until they are shown once. When the agent needs such a tab, it shows it briefly to start the shell and then switches back to the tab you were on.

The agent never types passwords. When a program asks for one, the agent switches you to that terminal (`focus_terminal`), asks you to type it, and waits.

## Answers and the transcript

- Answers are rendered as Markdown. Code blocks have **Copy** and **Insert** buttons. **Insert** types the code into the *active* terminal **without** pressing Enter, so you can review it first.
- Models that stream their thinking show a collapsible **Reasoning** section. You can hide it with **Settings → AI Panel → Show model reasoning**.
- When the agent asks a question (`ask_user`), answer with one of the offered buttons or type your own answer.
- The transcript follows new output. Scroll up and it stays put. A jump-to-bottom button appears, labelled *Approval needed*, *Question for you* or *New output* when something is waiting below.
- Errors from the model endpoint show in a bar above the composer.

## Sessions

Every conversation is saved automatically as a session. Press ☰ to open the drawer, where you can:

- **search** by title, latest answer, or terminal name,
- **open** a session to resume it,
- **rename** (✎ or double-click) and **delete** (🗑, with confirmation),
- start a **New** session,
- **Open sessions folder** on disk.

Start a new session with **+** in the header or `Ctrl+Alt+N`. Switching or starting a session stops a running turn first.

When you resume a session, its terminals are re-attached to matching open tabs, and a note lists what was re-attached and what is not open right now. The note is also sent to the model. Click a closed chip to reopen it.

How matching works, where the files live, and their format: see [Sessions](sessions.md).

## Keyboard shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| Toggle the panel | `Ctrl+Alt+A` | `⌘⇧A` |
| Approve the pending action | `Ctrl+Alt+Y` | `⌘⇧Y` |
| Deny the pending action | `Ctrl+Alt+X` | `⌘⇧X` |
| Stop the agent | `Ctrl+Alt+S` | `⌘⇧S` |
| Focus the message box (opens the panel) | `Ctrl+Alt+I` | `⌘⇧I` |
| New session | `Ctrl+Alt+N` | `⌘⇧N` |

Change them under **Settings → Hotkeys** (search for *AI panel*). They work everywhere in Tabby, including while you type in the panel.

While keyboard focus is inside the panel, Tabby's own hotkeys are suspended. Without that, `Ctrl+C` or a paste in the message box would also reach the terminal behind it. The panel's shortcuts above keep working.
