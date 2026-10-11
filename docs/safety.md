# Safety

> [!WARNING]
> You are giving a language model the ability to type into your terminals, including SSH sessions on other machines. Review what it does. Keep **Ask for every action** on for machines that matter. Prefer a self-hosted model when terminal output is sensitive. The risk checks below are a safety net, not a security boundary.

- [Approval and risk](#approval-and-risk)
- [How risk is assessed](#how-risk-is-assessed)
- [Passwords and secrets](#passwords-and-secrets)
- [What is sent to the model](#what-is-sent-to-the-model)
- [What is stored on disk](#what-is-stored-on-disk)
- [Rendering model output](#rendering-model-output)
- [Reporting a vulnerability](#reporting-a-vulnerability)

## Approval and risk

Every action that can change something gets a risk level, and the session's [approval mode](usage.md#approval-modes) decides whether it runs on its own or waits for you:

| Tool | Risk |
| --- | --- |
| `run_command` | The model's `risk_level`, raised by local pattern checks (below) |
| `send_keys` | The model's `risk_level`, at least `medium` unless every key is benign (`ctrl-c`, `esc`, `enter`, `q`, arrows, …) |
| `open_terminal` | always `medium` |
| `list_terminals`, `read_terminal`, `wait_for_output`, `ask_user`, `focus_terminal` | none: read-only, never ask |

You can stop the agent at any time with ■ or `Ctrl+Alt+S`, and interrupt a running command from its card with **Send Ctrl+C**.

## How risk is assessed

The model declares a risk level for every command (`low` for inspection, `medium` for changes that are easy to undo, `high` for anything destructive or that affects access). The plugin then checks the command against two lists of patterns in [`src/core/util/risk.ts`](../src/core/util/risk.ts). The checks can only raise the level, never lower it.

**Destructive patterns** set the level to `high` and **always require your confirmation, in every approval mode**, including *Auto-approve everything*. The card shows a warning with the pattern that matched.

- `rm -rf` on `/`, `*`, `~`, `$HOME` or `.`, and `rm -r /`
- `mkfs`, `wipefs`, `shred`
- `dd … of=/dev/<disk>`, or redirecting output to a disk device
- a fork bomb
- `chmod 777` on an absolute path, `chown -R` on `/`
- `shutdown`, `reboot`, `halt`, `poweroff`
- stopping, disabling or masking `ssh`/`sshd`/networking services
- flushing `iptables`/`ip6tables`/`nft` rules, `ufw reset`/`ufw disable`
- `ip link set … down`, `ifdown`
- `userdel`, `deluser`, `kill -9 -1`, `crontab -r`
- `git push --force`
- SQL `DROP DATABASE` / `DROP TABLE`

**Change patterns** raise the level to at least `medium`:

- `sudo`, `rm -r`, `mv`, `chmod`, `chown`
- package installs, removals and upgrades (`apt`, `apt-get`, `yum`, `dnf`, `pacman`, `zypper`, `apk`, `brew`)
- `systemctl start|stop|restart|enable|disable`
- network tools (`ip`, `ifconfig`, `route`, `iptables`, `nft`, `ufw`, `firewall-cmd`, `wg`, `wg-quick`)
- `kill`, `pkill`, `killall`
- piping `curl`/`wget` into a shell
- writing into `/etc` (redirect or `tee`)
- `git push`, `git reset --hard`, `git checkout --`, `git clean -f`
- `docker rm|rmi|system prune|volume rm`

The lists are deliberately coarse. For example, any `ip` command counts as `medium`, including `ip addr`. They cannot catch everything: a script, an alias or an obfuscated command can do damage without matching anything. That is why the approval mode matters more than the patterns.

## Passwords and secrets

- The agent is instructed never to type passwords, passphrases or other secrets. When a program asks for one, it should switch you to the terminal (`focus_terminal`), ask you to type the secret, and wait (`wait_for_output`).
- This is an instruction to the model, not something the plugin can enforce. The approval cards are your check.
- Anything a terminal prints can end up in the model's context once the agent reads that terminal.

## What is sent to the model

Requests go only to the endpoint you configure. The plugin makes no other network requests and has no telemetry. Each request contains:

- the built-in system prompt and your [additional instructions](configuration.md#additional-instructions),
- your messages, each with a snapshot of the open terminals: key, label, connection (for example `ssh ubuntu@10.0.0.11`), status, and which one is active,
- the agent's earlier answers and tool calls,
- tool results, which means **terminal output the agent read**, cut to the [context settings](configuration.md#how-the-context-budget-works).

A terminal you remove from the session with **×** on its chip is left out of everything above from then on.

## What is stored on disk

- **Sessions** are plain JSON files, one per session, under `<Tabby config dir>/ai-panel/`. See [Sessions](sessions.md#storage). They contain the full transcript, **including complete command output**, so treat that folder like shell history. Delete sessions from the drawer, or delete the files.
- **Settings**, including the **API key**, are stored in Tabby's `config.yaml`.

## Rendering model output

Tabby's renderer runs with Node.js integration, so model output must never become live markup. Answers are rendered with `marked` and sanitized with DOMPurify. Scripts, styles, iframes, forms, images, SVG and media are removed, and only `http(s):` and `mailto:` links are kept. Command output is always shown as plain text.

## Reporting a vulnerability

Please report security issues privately, as described in [SECURITY.md](../SECURITY.md), and not in a public issue.
