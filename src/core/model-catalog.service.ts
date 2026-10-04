import { Injectable, NgZone } from '@angular/core'
import { BehaviorSubject, Observable } from 'rxjs'
import { ConfigService } from 'tabby-core'
import { OpenAICompatibleProvider, normalizeBaseUrl } from './llm/openai-compatible'
import { ModelInfo } from './llm/models'
import { CONFIG_KEY } from '../types/config'

export type CatalogStatus =
    | 'unconfigured'    // no endpoint set
    | 'loading'
    | 'ready'
    | 'unsupported'     // the server has no /v1/models
    | 'error'

export interface CatalogState {
    status: CatalogStatus
    /** Kept while reloading the same endpoint, so the list does not flicker. */
    models: ModelInfo[]
    error?: string
}

const MAX_AGE_MS = 5 * 60_000

/**
 * The configured server's model list, shared by the settings page and the
 * composer's model switcher. Cached per endpoint + API key.
 */
@Injectable({ providedIn: 'root' })
export class ModelCatalogService {
    private state = new BehaviorSubject<CatalogState>({ status: 'unconfigured', models: [] })
    private key: string | null = null
    private fetchedAt = 0
    private inflight: Promise<void> | null = null

    constructor (private config: ConfigService, private zone: NgZone) {}

    get state$ (): Observable<CatalogState> {
        return this.state
    }

    /** Load unless a fresh list for the current endpoint is already there. */
    ensure (): Promise<void> {
        const fresh = this.key === this.currentKey() && this.state.value.status !== 'error' && Date.now() - this.fetchedAt < MAX_AGE_MS
        return fresh ? this.inflight ?? Promise.resolve() : this.refresh()
    }

    refresh (): Promise<void> {
        const key = this.currentKey()
        if (this.inflight && key === this.key) return this.inflight
        const settings = this.config.store[CONFIG_KEY] ?? {}
        if (!key) {
            this.key = null
            this.inflight = null
            this.set({ status: 'unconfigured', models: [] })
            return Promise.resolve()
        }
        const keep = key === this.key ? this.state.value.models : []
        this.key = key
        this.set({ status: 'loading', models: keep })
        const provider = new OpenAICompatibleProvider({ endpoint: settings.endpoint, apiKey: settings.apiKey, model: settings.model })
        const run = provider.listModels().then(
            models => {
                if (this.key !== key) return
                this.fetchedAt = Date.now()
                this.set(models ? { status: 'ready', models } : { status: 'unsupported', models: [] })
            },
            (e: Error) => {
                if (this.key !== key) return
                this.set({ status: 'error', models: keep, error: e.message })
            },
        ).finally(() => {
            if (this.inflight === run) this.inflight = null
        })
        this.inflight = run
        return run
    }

    private currentKey (): string {
        const s = this.config.store[CONFIG_KEY] ?? {}
        const base = normalizeBaseUrl(s.endpoint ?? '')
        return base ? `${base}\n${s.apiKey ?? ''}` : ''
    }

    private set (state: CatalogState): void {
        this.zone.run(() => this.state.next(state))
    }
}
