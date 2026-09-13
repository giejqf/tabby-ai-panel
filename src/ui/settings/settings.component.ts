import { Component, OnInit } from '@angular/core'
import { ConfigService, PlatformService } from 'tabby-core'
import { OpenAICompatibleProvider } from '../../core/llm/openai-compatible'
import { SessionStoreService } from '../../core/session-store.service'
import { AiPanelConfig, CONFIG_KEY, DEFAULT_CONFIG } from '../../types/config'

@Component({
    selector: 'ai-panel-settings',
    templateUrl: './settings.component.html',
    styleUrls: ['./settings.component.scss'],
})
export class AiPanelSettingsComponent implements OnInit {
    testing = false
    testResult: { ok: boolean, message: string } | null = null
    models: string[] = []
    extraParamsError: string | null = null

    constructor (
        public config: ConfigService,
        private platform: PlatformService,
        public store: SessionStoreService,
    ) {}

    ngOnInit (): void {
        this.config.store[CONFIG_KEY] ??= {}
        for (const [k, v] of Object.entries(DEFAULT_CONFIG)) {
            this.config.store[CONFIG_KEY][k] ??= v
        }
        this.validateExtraParams()
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
            this.models = result.models ?? []
            const modelNote = this.models.length ? ` ${this.models.length} model${this.models.length === 1 ? '' : 's'} available.` : ''
            this.testResult = { ok: true, message: `Connected.${modelNote}` }
            if (!this.c.model && this.models.length === 1) {
                this.c.model = this.models[0]
                this.save()
            }
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
