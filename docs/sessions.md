# Sessions

A session is one conversation with the agent. It holds the transcript, the terminals the agent saw or used, the session's approval mode, and token statistics. Sessions are saved as you work, so closing Tabby mid-task loses nothing, and any session can be resumed later.

For the session drawer itself (search, rename, delete), see [Using the panel](usage.md#sessions).

- [Lifecycle](#lifecycle)
- [Resuming and re-attaching terminals](#resuming-and-re-attaching-terminals)
- [Storage](#storage)
- [File format](#file-format)

## Lifecycle

- **Saving.** Changes are written after every step, coalesced over about 400 ms, and flushed when the window closes. Files are written atomically: to a temporary file first, then renamed.
- **Title.** With **Name sessions automatically** on, the first line of your first message becomes the title (up to 60 characters). Rename a session by double-clicking its title in the header or in the drawer. A name you set is never overwritten.
- **New session.** **+** in the header, **New** in the drawer, or `Ctrl+Alt+N`. Starting or opening another session first stops a running turn.
- **Deleting** a session removes its file. It cannot be undone.

## Resuming and re-attaching terminals

Terminal keys (`t1`, `t2`, …) belong to the session, and the transcript refers to them. The live tabs they pointed to may no longer exist when you resume. Each stored terminal therefore keeps a *descriptor*: profile id and name, SSH host, user and port, the tab title, and any custom name you gave the tab.

When you open a session, each stored terminal is matched against the open tabs. A match must be the same kind of terminal (SSH, local, serial, telnet), and the score adds up:

| Same … | Points |
| --- | --- |
| profile id | 6 |
| host | 3, plus 1 for the same user and 1 for the same port |
| profile name | 2 |
| custom tab name | 2 |
| tab title | 1 |

The best open tab with **3 or more** points is re-attached. Each tab is used once. Terminals the agent actually used are matched first, and terminals you [removed](usage.md#the-chip-bar) are matched last, so they never take a tab away from a usable key. Removed terminals stay hidden after resuming.

Afterwards a note appears in the transcript, and is also sent to the model:

```text
Session resumed. Re-attached: t1 → "Linux-1". Not open right now: t2 "Linux-2" (ssh ubuntu@10.0.0.12) – reconnect them from the terminal bar or open_terminal before using them.
```

Click a closed chip to reopen its profile and attach it to the same key. The agent can also open it with `open_terminal`, after your approval.

## Storage

Sessions live next to Tabby's config file:

```text
<Tabby config dir>/ai-panel/
├── index.json              # summaries for the drawer (title, preview, terminals, dates)
└── sessions/
    ├── s_mfl2x9k01a3.json
    └── …
```

| OS | Default location |
| --- | --- |
| Linux | `~/.config/tabby/ai-panel/` |
| macOS | `~/Library/Application Support/tabby/ai-panel/` |
| Windows | `%APPDATA%\tabby\ai-panel\` |

If Tabby does not report a config path, `~/.tabby-ai-panel/` is used instead. **Settings → AI Panel** shows the folder in use and has an **Open folder** button. So does the bottom of the session drawer.

`index.json` is a cache. If it is missing or unreadable, it is rebuilt from the session files on startup. If you add or delete session files by hand, also delete `index.json` and restart Tabby, so the drawer matches the files.

> [!CAUTION]
> Session files contain complete command output from your terminals. Treat them like shell history.

## File format

Session files are pretty-printed JSON, readable with any tool. The schema (version 1) is defined in [`src/types/session.ts`](../src/types/session.ts). Abridged:

```jsonc
{
  "version": 1,
  "id": "s_mfl2x9k01a3",
  "title": "Set up a WireGuard tunnel between Linux-1 and Linux-2",
  "titleIsCustom": false,
  "createdAt": "2026-10-04T09:12:31.020Z",
  "updatedAt": "2026-10-04T09:20:02.511Z",
  "approvalMode": "auto_low",            // per-session override, if set
  "terminals": [
    {
      "key": "t1",
      "label": "Linux-1",
      "descriptor": { "kind": "ssh", "profileId": "…", "profileName": "Linux-1", "host": "10.0.0.11", "port": 22, "user": "ubuntu" },
      "used": true,                       // the agent ran or read something here
      "removed": false,                   // the user took it away from the agent
      "firstSeenAt": "…",
      "lastUsedAt": "…"
    }
  ],
  "messages": [
    { "role": "user", "id": "…", "content": "Set up a WireGuard tunnel…", "context": "<terminals>…</terminals>", "createdAt": "…" },
    {
      "role": "assistant", "id": "…", "content": "I'll inspect both hosts first.", "reasoning": "…",
      "model": "…", "usage": { "prompt": 2400, "completion": 90 },
      "toolCalls": [
        {
          "id": "call_…", "name": "run_command",
          "args": { "terminal": "t1", "command": "ip -br addr", "risk_level": "low", "explanation": "…" },
          "status": "done",                 // pending_approval | awaiting_user | running | done | declined | error | cancelled
          "exitState": "prompt",            // see docs/agent-tools.md#result-states
          "riskLevel": "medium", "terminalKey": "t1", "terminalLabel": "Linux-1",
          "result": "[t1 \"Linux-1\" · finished – prompt returned after 0.4 s · 3 lines]\n…",
          "startedAt": "…", "finishedAt": "…"
        }
      ],
      "createdAt": "…"
    },
    { "role": "note", "id": "…", "content": "Session resumed. …", "forModel": true, "createdAt": "…" }
  ],
  "stats": { "turns": 3, "toolCalls": 7, "promptTokens": 18250, "completionTokens": 1210 }
}
```

`context` is the terminal snapshot that was sent to the model with the message. It is hidden in the panel. `note` messages are system notes such as the resume summary. Only those with `forModel: true` are sent to the model.
