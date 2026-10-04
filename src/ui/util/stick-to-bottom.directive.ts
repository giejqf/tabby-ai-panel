import { Directive, ElementRef, Input, NgZone, OnChanges, OnDestroy, OnInit } from '@angular/core'
import { StickyScroll } from './sticky-scroll'

/**
 * Keeps a small scrollable box (streaming reasoning, live command output)
 * scrolled to its newest line while the binding is true, unless the user
 * scrolled up inside it.
 */
@Directive({ selector: '[aiStickToBottom]' })
export class StickToBottomDirective implements OnInit, OnChanges, OnDestroy {
    @Input() aiStickToBottom = true
    private sticky?: StickyScroll

    constructor (private element: ElementRef<HTMLElement>, private zone: NgZone) {}

    ngOnInit (): void {
        // scroll/mutation callbacks only touch the DOM; keep them out of change detection
        this.zone.runOutsideAngular(() => {
            this.sticky = new StickyScroll(this.element.nativeElement)
        })
        this.sticky!.setEnabled(this.aiStickToBottom)
        if (this.aiStickToBottom) this.sticky!.scrollToBottom()
    }

    ngOnChanges (): void {
        this.sticky?.setEnabled(this.aiStickToBottom)
    }

    ngOnDestroy (): void {
        this.sticky?.destroy()
    }
}
