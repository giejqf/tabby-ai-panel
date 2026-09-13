/**
 * Heuristics for figuring out what a terminal is doing from its screen text.
 *
 * Two signals are combined:
 *  - a "learned" prompt: the line under the cursor right before a command is
 *    sent is the shell prompt; its trailing symbol is what we look for again
 *  - generic prompt patterns as a fallback for the first command / odd shells
 */

export const GENERIC_PROMPT_PATTERNS: RegExp[] = [
    /[$#%>]\s*$/,              // bash/zsh/sh/fish/cmd/python REPL
    /❯\s*$/,                   // starship / pure
    /➜\s*$/,                   // oh-my-zsh robbyrussell
    /»\s*$/,
    /PS [^>]*>\s*$/i,          // PowerShell
    /^\(.*\)\s*[$#%>❯]\s*$/,   // venv/conda prefixed prompts
]

/** Lines that mean "a program is waiting for the user to type something". */
export const INPUT_PROMPT_PATTERNS: RegExp[] = [
    /password[^:\n]*:\s*$/i,
    /passphrase[^:\n]*:\s*$/i,
    /\[sudo\]/i,
    /\(y(es)?\/n(o)?\)\s*[:?]?\s*$/i,
    /\[y(es)?\/n(o)?\]\s*[:?]?\s*$/i,
    /\[y\/n\/[a-z]+\]/i,
    /(yes|no)\)\s*[?:]?\s*$/i,
    /do you want to continue\??/i,
    /press (enter|return|any key)/i,
    /are you sure[^\n]*\?\s*$/i,
    /continue connecting \(yes\/no(\/\[fingerprint\])?\)\?\s*$/i,
    /:\s*$/,                   // generic "Something:" waiting for a value
    /\?\s*$/,                  // generic question
    /^--More--/i,
    /\(END\)\s*$/,
]

/** The final non-space character of the prompt line, if it looks like a prompt terminator. */
export function learnPromptTerminator (promptLine: string): string | null {
    const trimmed = (promptLine ?? '').trimEnd()
    if (!trimmed) {
        return null
    }
    const last = trimmed[trimmed.length - 1]
    // letters/digits are never a prompt terminator (a plain "user@host" would be a mis-learn)
    if (/[\p{L}\p{N}]/u.test(last)) {
        return null
    }
    return last
}

export function isGenericPrompt (line: string): boolean {
    const t = line.trimEnd()
    return t.length > 0 && GENERIC_PROMPT_PATTERNS.some(p => p.test(t))
}

/**
 * Does the last line look like the shell prompt is back?
 * `terminator` is the learned trailing symbol (may be null).
 */
export function looksLikePrompt (lastLine: string, terminator: string | null): boolean {
    const t = lastLine.trimEnd()
    if (!t) {
        return false
    }
    if (terminator && t.endsWith(terminator)) {
        return true
    }
    return isGenericPrompt(t)
}

export function looksLikeInputPrompt (lastLine: string): boolean {
    const t = lastLine.trim()
    if (!t) {
        return false
    }
    return INPUT_PROMPT_PATTERNS.some(p => p.test(t))
}

/**
 * Strip the command echo (prompt + command, possibly wrapped) from the top of
 * a capture and the fresh prompt from the bottom.
 */
export function stripEchoAndPrompt (lines: string[], command: string, terminator: string | null): string[] {
    let out = [...lines]
    const cmdHead = command.trim().split('\n')[0].slice(0, 24)
    // drop leading echo line(s)
    let dropped = 0
    while (out.length && dropped < 3) {
        const l = out[0]
        if (cmdHead && l.includes(cmdHead)) {
            out.shift()
            dropped++
            break
        }
        if (l.trim() === '' || (dropped === 0 && looksLikePrompt(l, terminator) && !l.includes(cmdHead))) {
            out.shift()
            dropped++
            continue
        }
        break
    }
    // drop trailing prompt
    while (out.length && out[out.length - 1].trim() === '') {
        out.pop()
    }
    if (out.length && looksLikePrompt(out[out.length - 1], terminator) && !looksLikeInputPrompt(out[out.length - 1])) {
        out = out.slice(0, -1)
    }
    return out
}
