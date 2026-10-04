/**
 * "Stick to bottom" scrolling for live content (transcript, streaming output).
 *
 * The scroller follows new content as long as the user is at the bottom.
 * Scrolling up releases it, scrolling back down to the bottom re-attaches.
 *
 * Whether to follow is tracked as an explicit flag driven by the direction of
 * scroll moves, not re-derived from "is the position near the bottom" on each
 * scroll event: a scroll event can arrive after content already grew past any
 * threshold, which used to make the transcript stop following on its own.
 */

/** Distance from the bottom (px) that still counts as "at the bottom". */
export const AT_BOTTOM_PX = 8

export interface ScrollMetrics {
    scrollTop: number
    scrollHeight: number
    clientHeight: number
}

export function distanceFromBottom (m: ScrollMetrics): number {
    return Math.max(0, m.scrollHeight - m.scrollTop - m.clientHeight)
}

/**
 * Whether to keep following after the scroll position was observed again.
 * Reaching the bottom attaches, only an upward move detaches; content growth,
 * clamping after content shrank and our own scrolling never detach.
 */
export function nextStuck (stuck: boolean, lastTop: number, m: ScrollMetrics): boolean {
    if (distanceFromBottom(m) <= AT_BOTTOM_PX) return true
    if (m.scrollTop < lastTop - 1) return false
    return stuck
}

export interface StickyScrollState {
    /** Following new content. */
    stuck: boolean
    /** Content was added below while not following. */
    unseen: boolean
}

export interface StickyScrollOptions {
    /**
     * Element wrapping the scrolled content; its size changes trigger
     * following. Without it, DOM mutations inside the scroller are watched
     * (for a plain `<pre>` whose text changes).
     */
    content?: HTMLElement
    /** Called when `stuck` or `unseen` changes. */
    onChange?: (state: StickyScrollState) => void
}

export class StickyScroll {
    private stuck = true
    private unseen = false
    private enabled = true
    private lastTop: number
    private lastScrollHeight: number
    private lastClientWidth: number
    private holdUntil = 0
    private resizeObserver: ResizeObserver
    private mutationObserver?: MutationObserver

    constructor (private el: HTMLElement, private options: StickyScrollOptions = {}) {
        this.lastTop = el.scrollTop
        this.lastScrollHeight = el.scrollHeight
        this.lastClientWidth = el.clientWidth
        el.addEventListener('scroll', this.onScroll, { passive: true })
        this.resizeObserver = new ResizeObserver(this.onLayout)
        this.resizeObserver.observe(el)
        if (options.content) {
            this.resizeObserver.observe(options.content)
        } else {
            this.mutationObserver = new MutationObserver(this.onLayout)
            this.mutationObserver.observe(el, { childList: true, subtree: true, characterData: true })
        }
    }

    get state (): StickyScrollState {
        return { stuck: this.stuck, unseen: this.unseen }
    }

    /** While disabled, content changes are not followed. */
    setEnabled (enabled: boolean): void {
        this.enabled = enabled
    }

    /** Jump to the bottom and follow again. */
    scrollToBottom (smooth = false): void {
        const el = this.el
        if (smooth && !prefersReducedMotion()) {
            // the scroll events of the animation move down, so we stay stuck
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
        } else {
            el.scrollTop = el.scrollHeight
            this.lastTop = el.scrollTop
        }
        this.update(true, false)
    }

    /**
     * Keep the current position through the next layout change instead of
     * following: the user expanded or collapsed something and expects it to
     * stay under the pointer.
     */
    holdPosition (ms = 500): void {
        this.holdUntil = performance.now() + ms
    }

    destroy (): void {
        this.el.removeEventListener('scroll', this.onScroll)
        this.resizeObserver.disconnect()
        this.mutationObserver?.disconnect()
    }

    private onScroll = (): void => {
        const stuck = nextStuck(this.stuck, this.lastTop, this.el)
        this.lastTop = this.el.scrollTop
        this.update(stuck, stuck ? false : this.unseen)
    }

    private onLayout = (): void => {
        const el = this.el
        const grew = el.scrollHeight > this.lastScrollHeight && el.clientWidth === this.lastClientWidth
        this.lastScrollHeight = el.scrollHeight
        this.lastClientWidth = el.clientWidth
        if (!this.enabled) return

        // the user may have scrolled up in this frame before its scroll event fired
        let stuck = nextStuck(this.stuck, this.lastTop, el)
        let unseen = this.unseen
        if (this.holdUntil) {
            const held = performance.now() < this.holdUntil
            this.holdUntil = 0
            if (held) {
                this.lastTop = el.scrollTop
                stuck = distanceFromBottom(el) <= AT_BOTTOM_PX
                this.update(stuck, stuck ? false : unseen)
                return
            }
        }
        if (stuck) {
            el.scrollTop = el.scrollHeight
            unseen = false
        } else if (grew) {
            unseen = true
        }
        this.lastTop = el.scrollTop
        this.update(stuck, unseen)
    }

    private update (stuck: boolean, unseen: boolean): void {
        if (stuck === this.stuck && unseen === this.unseen) return
        this.stuck = stuck
        this.unseen = unseen
        this.options.onChange?.(this.state)
    }
}

function prefersReducedMotion (): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
