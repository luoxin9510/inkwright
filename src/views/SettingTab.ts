import { type App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import { T, type LanguageSetting } from "../i18n";
import { SYNC_MODES, type SyncMode } from "../play/store";

interface LanguageHost {
  getLanguageSetting(): LanguageSetting;
  setLanguageSetting(value: LanguageSetting): Promise<void>;
  getPinBar(): boolean;
  setPinBar(value: boolean): Promise<void>;
  getSaveFolder(): string;
  setSaveFolder(value: string): Promise<void>;
  getSyncMode(): SyncMode;
  setSyncMode(value: SyncMode): Promise<void>;
  getLiveJournal(): boolean;
  setLiveJournal(value: boolean): Promise<void>;
}

const LANGUAGE_SETTINGS: readonly string[] = ["auto", "zh", "en"];

export class InkwrightSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: LanguageHost & ConstructorParameters<typeof PluginSettingTab>[1]) {
    super(app, host);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{
      name: T().settingLanguage,
      desc: T().settingLanguageDesc,
      control: {
        type: "dropdown",
        key: "language",
        options: { auto: T().followObsidian, zh: "中文", en: "English" },
      },
    }, {
      name: T().settingPin,
      desc: T().settingPinDesc,
      control: { type: "toggle", key: "pinBar" },
    }, {
      name: T().settingLiveJournal,
      desc: T().settingLiveJournalDesc,
      control: { type: "toggle", key: "liveJournal" },
    }, {
      name: T().settingSaveFolder,
      desc: T().settingSaveFolderDesc,
      control: { type: "text", key: "saveFolder", placeholder: "Inkwright/存档" },
    }, {
      name: T().settingSync,
      desc: T().settingSyncDesc,
      control: { type: "dropdown", key: "syncMode", options: Object.fromEntries(SYNC_MODES.map((m) => [m, T().syncModes[m]])) },
    }];
  }

  getControlValue(key: string): unknown {
    if (key === "language") return this.host.getLanguageSetting();
    if (key === "pinBar") return this.host.getPinBar();
    if (key === "saveFolder") return this.host.getSaveFolder();
    if (key === "liveJournal") return this.host.getLiveJournal();
    if (key === "syncMode") return this.host.getSyncMode();
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "pinBar" && typeof value === "boolean") {
      await this.host.setPinBar(value);
      return;
    }
    if (key === "liveJournal" && typeof value === "boolean") {
      await this.host.setLiveJournal(value);
      return;
    }
    if (key === "saveFolder" && typeof value === "string") {
      await this.host.setSaveFolder(value);
      return;
    }
    if (key === "syncMode" && typeof value === "string" && (SYNC_MODES as readonly string[]).includes(value)) {
      await this.host.setSyncMode(value as SyncMode);
      return;
    }
    if (key !== "language" || typeof value !== "string" || !LANGUAGE_SETTINGS.includes(value)) return;
    await this.host.setLanguageSetting(value as LanguageSetting);
    // The setting's own name and description change with the language.
    this.update();
  }
}
