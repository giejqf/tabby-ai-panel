import { ConfigProvider, Platform } from 'tabby-core'
import { CONFIG_KEY, DEFAULT_CONFIG, HOTKEY_IDS } from './types/config'

/** @hidden */
export class AiPanelConfigProvider extends ConfigProvider {
    defaults = {
        [CONFIG_KEY]: { ...DEFAULT_CONFIG },
        hotkeys: {
            [HOTKEY_IDS.toggle]: ['Ctrl-Alt-A'],
            [HOTKEY_IDS.approve]: ['Ctrl-Alt-Y'],
            [HOTKEY_IDS.deny]: ['Ctrl-Alt-X'],
            [HOTKEY_IDS.stop]: ['Ctrl-Alt-S'],
            [HOTKEY_IDS.focusInput]: ['Ctrl-Alt-I'],
            [HOTKEY_IDS.newSession]: ['Ctrl-Alt-N'],
        },
    }

    platformDefaults = {
        [Platform.macOS]: {
            hotkeys: {
                [HOTKEY_IDS.toggle]: ['⌘-Shift-A'],
                [HOTKEY_IDS.approve]: ['⌘-Shift-Y'],
                [HOTKEY_IDS.deny]: ['⌘-Shift-X'],
                [HOTKEY_IDS.stop]: ['⌘-Shift-S'],
                [HOTKEY_IDS.focusInput]: ['⌘-Shift-I'],
                [HOTKEY_IDS.newSession]: ['⌘-Shift-N'],
            },
        },
    }
}
