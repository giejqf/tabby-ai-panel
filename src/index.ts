import { NgModule } from '@angular/core'
import { CommonModule } from '@angular/common'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, { CommandProvider, ConfigProvider, HotkeyProvider } from 'tabby-core'
import TabbyTerminalModule, { TerminalDecorator } from 'tabby-terminal'
import { SettingsTabProvider } from 'tabby-settings'

import './ui/styles.scss'

import { AiPanelConfigProvider } from './config'
import { AiPanelHotkeyProvider } from './hotkeys'
import { AiPanelCommandProvider } from './commands'
import { AiPanelSettingsTabProvider } from './settings-tab'
import { AiPanelTerminalDecorator } from './decorator'
import { PanelHostService } from './ui/panel-host.service'
import { AgentService } from './core/agent.service'
import { TerminalRegistryService } from './core/terminal-registry.service'

import { AiPanelComponent } from './ui/panel/panel.component'
import { TranscriptComponent } from './ui/transcript/transcript.component'
import { ToolCallComponent } from './ui/transcript/tool-call.component'
import { ComposerComponent } from './ui/composer/composer.component'
import { TerminalStripComponent } from './ui/terminal-strip/terminal-strip.component'
import { SessionListComponent } from './ui/sessions/session-list.component'
import { AiPanelSettingsComponent } from './ui/settings/settings.component'
import { MarkdownPipe } from './ui/pipes/markdown.pipe'
import { RelativeTimePipe } from './ui/pipes/relative-time.pipe'

/** @hidden */
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        TabbyCoreModule,
        TabbyTerminalModule,
    ],
    providers: [
        { provide: ConfigProvider, useClass: AiPanelConfigProvider, multi: true },
        { provide: HotkeyProvider, useClass: AiPanelHotkeyProvider, multi: true },
        { provide: CommandProvider, useClass: AiPanelCommandProvider, multi: true },
        { provide: SettingsTabProvider, useClass: AiPanelSettingsTabProvider, multi: true },
        { provide: TerminalDecorator, useClass: AiPanelTerminalDecorator, multi: true },
    ],
    declarations: [
        AiPanelComponent,
        TranscriptComponent,
        ToolCallComponent,
        ComposerComponent,
        TerminalStripComponent,
        SessionListComponent,
        AiPanelSettingsComponent,
        MarkdownPipe,
        RelativeTimePipe,
    ],
})
export default class AiPanelModule {
    // Instantiating the host service here makes it subscribe to hotkeys and
    // restore the panel on startup even before the toolbar button is used.
    constructor (host: PanelHostService, agent: AgentService, registry: TerminalRegistryService) {
        host.registerPanelComponent(AiPanelComponent)
        // handy for debugging from the devtools console
        ;(window as any).tabbyAiPanel = { host, agent, registry }
    }
}
