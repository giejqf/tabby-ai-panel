import { RiskLevel } from '../../types/session'

/**
 * Commands that are always flagged as high risk, regardless of what the
 * model claims. This is a safety net, not a security boundary.
 */
const CATASTROPHIC_PATTERNS: RegExp[] = [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+(\/|\*|~|\$HOME|\.)(\s|$)/,
    /\brm\s+-[a-zA-Z]*r[a-zA-Z]*\s+\/(\s|$)/,
    /\bmkfs(\.[a-z0-9]+)?\b/,
    /\bdd\s+.*\bof=\/dev\/(sd|nvme|hd|mmcblk|disk)/,
    />\s*\/dev\/(sd|nvme|hd|mmcblk)/,
    /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    /\bchmod\s+(-R\s+)?[0-7]*777\s+\//,
    /\bchown\s+-R\s+\S+\s+\/(\s|$)/,
    /\bshred\b/,
    /\bwipefs\b/,
    /\b(shutdown|reboot|halt|poweroff)\b/,
    /\bsystemctl\s+(stop|disable|mask)\s+(ssh|sshd|networking|NetworkManager|systemd-networkd)\b/,
    /\b(iptables|ip6tables|nft)\b.*(?:\s)(-F|--flush|flush)(\s|$)/,
    /\bufw\s+(reset|disable)\b/,
    /\b(ip\s+link\s+set\s+\S+\s+down|ifdown)\b/,
    /\buserdel\b|\bdeluser\b/,
    /\bkill\s+-9\s+-1\b/,
    /\bcrontab\s+-r\b/,
    /\bgit\s+push\s+.*--force\b/,
    /\bdrop\s+(database|table)\b/i,
]

const MEDIUM_PATTERNS: RegExp[] = [
    /\bsudo\b/,
    /\brm\s+-[a-zA-Z]*r/,
    /\b(apt|apt-get|yum|dnf|pacman|zypper|apk|brew)\s+(install|remove|purge|upgrade|dist-upgrade|autoremove)\b/,
    /\bsystemctl\s+(restart|stop|start|enable|disable)\b/,
    /\b(ip|ifconfig|route|iptables|nft|ufw|firewall-cmd|wg|wg-quick)\b/,
    /\b(kill|pkill|killall)\b/,
    /\bchmod\b|\bchown\b/,
    /\bmv\b/,
    /\b(curl|wget)\b.*\|\s*(sudo\s+)?(ba)?sh\b/,
    />\s*\/etc\//,
    /\btee\s+(-a\s+)?\/etc\//,
    /\bgit\s+(push|reset\s+--hard|checkout\s+--|clean\s+-f)\b/,
    /\bdocker\s+(rm|rmi|system\s+prune|volume\s+rm)\b/,
]

export interface RiskAssessment {
    level: RiskLevel
    /** Matched a catastrophic pattern; must always be confirmed by the user. */
    hardBlock: boolean
    reason?: string
}

const ORDER: RiskLevel[] = ['low', 'medium', 'high']

export function maxRisk (a: RiskLevel, b: RiskLevel): RiskLevel {
    return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b
}

export function normalizeRisk (value: unknown): RiskLevel {
    const v = String(value ?? '').toLowerCase().trim()
    if (v === 'high' || v === 'critical' || v === 'destructive') return 'high'
    if (v === 'medium' || v === 'moderate' || v === 'med') return 'medium'
    return 'low'
}

/** Combine the model's self-assessment with local pattern matching. */
export function assessCommand (command: string, claimed: unknown): RiskAssessment {
    const cmd = command ?? ''
    for (const p of CATASTROPHIC_PATTERNS) {
        if (p.test(cmd)) {
            return { level: 'high', hardBlock: true, reason: `matches destructive pattern ${p.source}` }
        }
    }
    let level = normalizeRisk(claimed)
    if (MEDIUM_PATTERNS.some(p => p.test(cmd))) {
        level = maxRisk(level, 'medium')
    }
    return { level, hardBlock: false }
}

export function isAutoApproved (level: RiskLevel, mode: string, hardBlock: boolean): boolean {
    if (hardBlock) return false
    switch (mode) {
        case 'auto_all': return true
        case 'auto_medium': return level !== 'high'
        case 'auto_low': return level === 'low'
        default: return false
    }
}
