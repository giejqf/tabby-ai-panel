import { Component, ElementRef, EventEmitter, HostBinding, HostListener, Input, OnDestroy, OnInit, Output, ViewChild } from '@angular/core'
import { Subscription } from 'rxjs'
import { CatalogState, ModelCatalogService } from '../../core/model-catalog.service'
import { ModelInfo, filterModels, formatContextLength } from '../../core/llm/models'

/**
 * Searchable model dropdown fed by the server's `/v1/models`. Any id can
 * still be typed, for servers whose list is missing or incomplete.
 *
 * `field` looks like a form control and opens below itself. `inline` is a
 * text-sized trigger; its popover is positioned against the nearest
 * positioned ancestor (the composer), like the @-mention list.
 */
@Component({
    selector: 'ai-model-picker',
    templateUrl: './model-picker.component.html',
    styleUrls: ['./model-picker.component.scss'],
})
export class ModelPickerComponent implements OnInit, OnDestroy {
    @Input() value = ''
    @Output() valueChange = new EventEmitter<string>()
    @Input() variant: 'field' | 'inline' = 'field'
    @Input() placeholder = 'Select a model'
    /** One line shown above the list. */
    @Input() hint = ''
    @ViewChild('trigger') trigger?: ElementRef<HTMLButtonElement>
    @ViewChild('search') search?: ElementRef<HTMLInputElement>
    @ViewChild('list') list?: ElementRef<HTMLElement>

    open = false
    /** Field variant near the bottom of the window: open above the field. */
    dropUp = false
    query = ''
    activeIndex = 0
    catalog: CatalogState = { status: 'unconfigured', models: [] }
    /** Models matching the query; the current value comes first when the server does not list it. */
    items: (ModelInfo & { unlisted?: boolean })[] = []
    /** The typed text, offered as-is when it is not an exact id from the list. */
    customOption: string | null = null
    private matchCount = 0
    /** The user moved the highlight; a list arriving late must not move it back. */
    private navigated = false
    private sub = new Subscription()

    constructor (private catalogService: ModelCatalogService, private element: ElementRef<HTMLElement>) {}

    @HostBinding('class.variant-inline') get inline (): boolean {
        return this.variant === 'inline'
    }

    ngOnInit (): void {
        this.sub.add(this.catalogService.state$.subscribe(state => {
            this.catalog = state
            if (this.open) {
                this.updateItems(!this.navigated && !this.query.trim())
                setTimeout(() => this.scrollActiveIntoView())
            }
        }))
    }

    ngOnDestroy (): void {
        this.sub.unsubscribe()
    }

    get loading (): boolean {
        return this.catalog.status === 'loading'
    }

    /** Number of rows the keyboard moves through. */
    get optionCount (): number {
        return this.items.length + (this.customOption ? 1 : 0)
    }

    get countLabel (): string {
        const total = this.catalog.models.length
        if (!total) return ''
        return this.matchCount === total ? `${total} model${total === 1 ? '' : 's'}` : `${this.matchCount} of ${total}`
    }

    formatContext (n: number): string {
        return formatContextLength(n)
    }

    toggle (): void {
        if (this.open) {
            this.close(true)
        } else {
            this.show()
        }
    }

    show (): void {
        const rect = this.trigger?.nativeElement.getBoundingClientRect()
        const below = rect ? window.innerHeight - rect.bottom : Infinity
        this.dropUp = this.variant === 'field' && !!rect && below < 360 && rect.top > below
        this.open = true
        this.query = ''
        this.navigated = false
        this.updateItems(true)
        void this.catalogService.ensure()
        setTimeout(() => {
            this.search?.nativeElement.focus()
            this.scrollActiveIntoView()
        })
    }

    close (refocus: boolean): void {
        if (!this.open) return
        this.open = false
        if (refocus) this.trigger?.nativeElement.focus()
    }

    refresh (): void {
        void this.catalogService.refresh()
        this.search?.nativeElement.focus()
    }

    pick (id: string): void {
        const value = id.trim()
        this.close(true)
        if (value && value !== this.value) {
            this.value = value
            this.valueChange.emit(value)
        }
    }

    onQuery (): void {
        this.updateItems(false)
        this.activeIndex = 0
    }

    hover (index: number): void {
        this.activeIndex = index
        this.navigated = true
    }

    onTriggerKeydown (event: KeyboardEvent): void {
        if (!this.open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            this.show()
        }
    }

    onSearchKeydown (event: KeyboardEvent): void {
        const count = this.optionCount
        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp':
                event.preventDefault()
                if (count) {
                    this.navigated = true
                    this.activeIndex = (this.activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count
                    setTimeout(() => this.scrollActiveIntoView())
                }
                break
            case 'Enter':
                event.preventDefault()
                if (this.activeIndex < this.items.length) {
                    this.pick(this.items[this.activeIndex].id)
                } else if (this.customOption) {
                    this.pick(this.customOption)
                }
                break
            case 'Escape':
                event.preventDefault()
                event.stopPropagation()
                this.close(true)
                break
            case 'Tab':
                this.close(false)
                break
        }
    }

    @HostListener('document:mousedown', ['$event'])
    onDocumentMousedown (event: MouseEvent): void {
        if (this.open && !this.element.nativeElement.contains(event.target as Node)) {
            this.close(false)
        }
    }

    private updateItems (selectCurrent: boolean): void {
        const query = this.query.trim()
        const models = this.catalog.models
        let items: (ModelInfo & { unlisted?: boolean })[] = filterModels(models, query)
        this.matchCount = items.length
        if (this.value && !models.some(m => m.id === this.value) && filterModels([{ id: this.value }], query).length) {
            // flagged only once the list is known; while loading it may still turn up
            items = [{ id: this.value, unlisted: this.catalog.status === 'ready' }, ...items]
        }
        this.items = items
        this.customOption = query && !items.some(m => m.id === query) ? query : null
        if (selectCurrent) {
            this.activeIndex = Math.max(0, items.findIndex(m => m.id === this.value))
        } else {
            this.activeIndex = Math.min(this.activeIndex, Math.max(0, this.optionCount - 1))
        }
    }

    private scrollActiveIntoView (): void {
        this.list?.nativeElement.querySelector('.mp-item.active')?.scrollIntoView({ block: 'nearest' })
    }
}
