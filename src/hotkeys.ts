import { Injectable } from '@angular/core'
import { HotkeyDescription, HotkeyProvider } from 'tabby-core'
import { HOTKEY_IDS } from './types/config'

/** @hidden */
@Injectable()
export class AiPanelHotkeyProvider extends HotkeyProvider {
    async provide (): Promise<HotkeyDescription[]> {
        return [
            { id: HOTKEY_IDS.toggle, name: 'AI panel: toggle' },
            { id: HOTKEY_IDS.approve, name: 'AI panel: approve pending action' },
            { id: HOTKEY_IDS.deny, name: 'AI panel: deny pending action' },
            { id: HOTKEY_IDS.stop, name: 'AI panel: stop the agent' },
            { id: HOTKEY_IDS.focusInput, name: 'AI panel: focus the prompt' },
            { id: HOTKEY_IDS.newSession, name: 'AI panel: new session' },
        ]
    }
}
