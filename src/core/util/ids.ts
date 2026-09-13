let counter = 0

/** Short unique id: `<prefix>_<time36><counter36>` (no crypto dependency needed). */
export function newId (prefix: string): string {
    counter = (counter + 1) % 1296
    const rand = Math.floor(Math.random() * 1296).toString(36).padStart(2, '0')
    return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${rand}`
}

export function nowIso (): string {
    return new Date().toISOString()
}
