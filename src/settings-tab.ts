import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'
import { AiPanelSettingsComponent } from './ui/settings/settings.component'

/** @hidden */
@Injectable()
export class AiPanelSettingsTabProvider extends SettingsTabProvider {
    id = 'ai-panel'
    icon = 'robot'
    title = 'AI Panel'

    getComponentType (): any {
        return AiPanelSettingsComponent
    }
}
