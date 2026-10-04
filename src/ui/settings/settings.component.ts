import { Component, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { ConfigService, PlatformService } from 'tabby-core'
import { OpenAICompatibleProvider } from '../../core/llm/openai-compatible'
import { SessionStoreService } from '../../core/session-store.service'
import { ModelCatalogService } from '../../core/model-catalog.service'
import { AiPanelConfig, CONFIG_KEY, DEFAULT_CONFIG } from '../../types/config'

@Component({
    selector: 'ai-panel-settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
})
export class AiPanelSettingsComponent implements OnInit, OnDestroy {
    testing = false
    testResult: { ok: boolean, message: string } | null = null
    extraParamsError: string | null = null
    private sub = new Subscription()
    private reloadTimer: any = null

    constructor (
        public config: ConfigService,
        private platform: PlatformService,
        public store: SessionStoreService,
        private catalog: ModelCatalogService,
    ) {}

    ngOnInit (): void {
        this.config.store[CONFIG_KEY] ??= {}
        for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
            this.config.store[CONFIG_KEY][k] ??= v
        }
        this.validateExtraParams()
        this.sub.add(this.catalog.state$.subscribe(state => {
            // a server with a single model (llama.cpp, LM Studio) needs no choice
            if (state.status === 'ready' && state.models.length === 1 && !this.c.model) {
                this.c.model = state.models[0].id
                this.save()
            }
        }))
        void this.catalog.ensure()
    }

    ngOnDestroy (): void {
        this.sub.unsubscribe()
        clearTimeout(this.reloadTimer)
    }

    /** Endpoint or API key edited: reload the model list once typing pauses. */
    connectionChanged (): void {
        clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(() => void this.catalog.refresh(), 800)
    }

    get c (): AiPanelConfig {
        return this.config.store[CONFIG_KEY]
    }

    save (): void {
        this.config.save()
    }

    validateExtraParams (): void {
        const text = (this.c.extraParamsText ?? '').trim()
        if (!text) {
            this.extraParamsError = null
            return
        }
        try {
            const parsed = JSON.parse(text)
            this.extraParamsError = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? null : 'Must be a JSON object'
        } catch (e) {
            this.extraParamsError = (e as Error).message
        }
    }

    async test (): Promise<void> {
        this.testing = true
        this.testResult = null
        try {
            const provider = new OpenAICompatibleProvider({ endpoint: this.c.endpoint, apiKey: this.c.apiKey, model: this.c.model })
            const result = await provider.ping()
            const count = result.models?.length ?? 0
            const modelNote = count ? ` ${count} model${count === 1 ? '' : 's'} available.` : ''
            this.testResult = { ok: true, message: `Connected.${modelNote}` }
            void this.catalog.refresh()
        } catch (e) {
            this.testResult = { ok: false, message: (e as Error).message }
        } finally {
            this.testing = false
        }
    }

    openDataFolder (): void {
        this.platform.openPath(this.store.rootDir)
    }

    resetDefaults (): void {
        if (!confirm('Reset all AI panel settings to defaults? Your sessions are kept.')) return
        Object.assign(this.config.store[CONFIG_KEY], DEFAULT_CONFIG)
        this.save()
    }
}
