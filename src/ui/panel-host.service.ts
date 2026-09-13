import { ApplicationRef, ComponentRef, EnvironmentInjector, Injectable, Injector, NgZone, Type, createComponent } from '@angular/core'
import { AppService, ConfigService, HotkeysService } from 'tabby-core'
// type-only: the component injects this service, a value import would be circular
import type { AiPanelComponent } from './panel/panel.component'
import { AgentService } from '../core/agent.service'
import { CONFIG_KEY, DEFAULT_CONFIG, HOTKEY_IDS, PanelSide } from '../types/config'

const MIN_WIDTH = 300
const STYLE_ID = 'ai-panel-layout-style'

/**
 * Mounts the panel as a docked sidebar.
 *
 * Preferred mount point is Tabby's inner `.content` (the area that holds the
 * tab bodies) so the tab bar keeps its full width and only terminals shrink.
 * If that element cannot be found, falls back to a fixed overlay on <body>.
 */
@Injectable({ providedIn: 'root' })
export class PanelHostService {
    visible = false
    private panelType: Type<AiPanelComponent> | null = null
    private ref: ComponentRef<AiPanelComponent> | null = null
    private wrapper: HTMLElement | null = null
    private mountedTo: 'content' | 'body' | null = null
    private width = DEFAULT_CONFIG.panelWidth
    private side: PanelSide = 'right'

    constructor (
        private appRef: ApplicationRef,
        private envInjector: EnvironmentInjector,
        private injector: Injector,
        private config: ConfigService,
        private app: AppService,
        private hotkeys: HotkeysService,
        private agent: AgentService,
        private zone: NgZone,
    ) {
        // config.store is not populated until the config has been loaded
        this.config.ready$.subscribe({ complete: () => {
            this.readConfig()
            this.config.changed$.subscribe(() => {
                const prevSide = this.side
                this.readConfig()
                if (this.visible && prevSide !== this.side) {
                    this.applyLayout()
                }
            })
            this.app.ready$.subscribe(() => {
                if (this.config.store[CONFIG_KEY]?.panelVisible) {
                    // give Tabby a moment to render its layout
                    setTimeout(() => this.show(), 300)
                }
            })
        } })
        this.hotkeys.hotkey$.subscribe(id => this.zone.run(() => this.runHotkey(id)))
    }

    /** Called once by the module so this service never has to import the component. */
    registerPanelComponent (type: Type<AiPanelComponent>): void {
        this.panelType = type
    }

    toggle (): void {
        if (this.visible) {
            this.hide()
        } else {
            this.show()
        }
    }

    show (): void {
        if (!this.visible) {
            this.mount()
            this.visible = true
            this.persist({ panelVisible: true })
        }
        setTimeout(() => this.ref?.instance.focusComposer(), 50)
    }

    hide (): void {
        if (!this.visible) return
        this.unmount()
        this.visible = false
        this.persist({ panelVisible: false })
    }

    /** Live width while dragging (not persisted). */
    setWidth (px: number): void {
        const max = Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.8))
        this.width = Math.max(MIN_WIDTH, Math.min(max, Math.round(px)))
        this.applyLayout()
    }

    commitWidth (): void {
        this.persist({ panelWidth: this.width })
    }

    get currentWidth (): number {
        return this.width
    }

    get currentSide (): PanelSide {
        return this.side
    }

    /** Dispatch one of the panel's hotkeys by id (from Tabby, or from the panel's own key handler). */
    runHotkey (id: string): void {
        switch (id) {
            case HOTKEY_IDS.toggle:
                this.toggle()
                break
            case HOTKEY_IDS.approve:
                this.agent.approveFirstPending()
                break
            case HOTKEY_IDS.deny:
                this.agent.denyFirstPending()
                break
            case HOTKEY_IDS.stop:
                this.agent.stop()
                break
            case HOTKEY_IDS.focusInput:
                this.show()
                break
            case HOTKEY_IDS.newSession:
                this.show()
                void this.agent.newSession()
                break
        }
    }

    private readConfig (): void {
        const c = this.config.store?.[CONFIG_KEY] ?? {}
        this.width = Math.max(MIN_WIDTH, c.panelWidth ?? DEFAULT_CONFIG.panelWidth)
        this.side = c.panelSide === 'left' ? 'left' : 'right'
    }

    private persist (patch: Record<string, any>): void {
        if (!this.config.store) return
        this.config.store[CONFIG_KEY] ??= {}
        Object.assign(this.config.store[CONFIG_KEY], patch)
        this.config.save()
    }

    private mount (): void {
        if (this.wrapper || !this.panelType) return
        const contentArea = findTabContentArea()
        const wrapper = document.createElement('div')
        wrapper.className = 'ai-panel-wrapper'
        this.wrapper = wrapper

        this.ref = createComponent(this.panelType, {
            environmentInjector: this.envInjector,
            elementInjector: this.injector,
        })
        this.appRef.attachView(this.ref.hostView)
        const el = this.ref.location.nativeElement as HTMLElement
        wrapper.appendChild(el)

        if (contentArea) {
            this.mountedTo = 'content'
            contentArea.appendChild(wrapper)
        } else {
            this.mountedTo = 'body'
            document.body.appendChild(wrapper)
        }
        this.applyLayout()
        this.ref.changeDetectorRef.detectChanges()
    }

    private unmount (): void {
        if (this.ref) {
            this.appRef.detachView(this.ref.hostView)
            this.ref.destroy()
            this.ref = null
        }
        this.wrapper?.remove()
        this.wrapper = null
        this.mountedTo = null
        document.body.classList.remove('ai-panel-open', 'ai-panel-left', 'ai-panel-right')
        document.getElementById(STYLE_ID)?.remove()
        this.nudgeResize()
    }

    private applyLayout (): void {
        if (!this.wrapper) return
        const body = document.body
        body.style.setProperty('--ai-panel-width', `${this.width}px`)
        body.classList.add('ai-panel-open')
        body.classList.toggle('ai-panel-left', this.side === 'left')
        body.classList.toggle('ai-panel-right', this.side === 'right')
        let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
        if (!style) {
            style = document.createElement('style')
            style.id = STYLE_ID
            document.head.appendChild(style)
        }
        const fixed = this.mountedTo === 'body'
        style.textContent = `
            .ai-panel-wrapper {
                position: ${fixed ? 'fixed' : 'absolute'};
                top: 0; bottom: 0;
                width: var(--ai-panel-width);
                z-index: ${fixed ? 1000 : 20};
                display: flex;
                background: var(--theme-bg, var(--bs-body-bg, #1e1e1e));
                color: var(--theme-fg, var(--bs-body-color, #ddd));
            }
            body.ai-panel-right .ai-panel-wrapper { right: 0; border-left: 1px solid var(--theme-bg-more-2, rgba(255,255,255,0.08)); }
            body.ai-panel-left .ai-panel-wrapper { left: 0; border-right: 1px solid var(--theme-bg-more-2, rgba(255,255,255,0.08)); }
            ${fixed ? '' : `
            body.ai-panel-open app-root .content-tab {
                width: calc(100% - var(--ai-panel-width)) !important;
            }
            body.ai-panel-open.ai-panel-left app-root .content-tab.content-tab-active {
                left: var(--ai-panel-width) !important;
            }`}
        `
        this.nudgeResize()
    }

    private nudgeResize (): void {
        setTimeout(() => window.dispatchEvent(new Event('resize')), 30)
    }
}

/**
 * The element that holds Tabby's tab bodies (`.content-tab`). Located by
 * structure rather than a fixed path so minor template changes keep working.
 */
function findTabContentArea (): HTMLElement | null {
    const tabBody = document.querySelector('app-root .content-tab') as HTMLElement | null
    if (tabBody?.parentElement) {
        return tabBody.parentElement
    }
    for (const selector of ['app-root .content.main > .content', 'app-root > .content > .content', 'app-root .content > .content']) {
        const el = document.querySelector(selector) as HTMLElement | null
        if (el) return el
    }
    return null
}
