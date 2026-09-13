import { Injectable } from '@angular/core'
import { Command, CommandContext, CommandLocation, CommandProvider } from 'tabby-core'
import { PanelHostService } from './ui/panel-host.service'

export const PANEL_ICON = `
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="4" width="18" height="16" rx="2"/>
  <path d="M14 4v16"/>
  <path d="M6 9l2.5 2L6 13"/>
  <path d="M17 12h.01"/>
  <path d="M17 9h.01"/>
  <path d="M17 15h.01"/>
</svg>`

/** Toolbar button (top-right of the tab bar) that toggles the panel. */
@Injectable()
export class AiPanelCommandProvider extends CommandProvider {
    constructor (private host: PanelHostService) {
        super()
    }

    async provide (_context: CommandContext): Promise<Command[]> {
        return [
            {
                id: 'ai-panel:toggle',
                label: 'AI Agent',
                icon: PANEL_ICON,
                locations: [CommandLocation.RightToolbar],
                weight: 5,
                run: async () => this.host.toggle(),
            },
        ]
    }
}
