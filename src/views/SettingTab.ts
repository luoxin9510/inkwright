import { type App, PluginSettingTab, type SettingDefinitionItem } from "obsidian";
import { T, type LanguageSetting } from "../i18n";

interface LanguageHost {
  getLanguageSetting(): LanguageSetting;
  setLanguageSetting(value: LanguageSetting): Promise<void>;
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
    }];
  }

  getControlValue(key: string): unknown {
    return key === "language" ? this.host.getLanguageSetting() : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key !== "language" || typeof value !== "string" || !LANGUAGE_SETTINGS.includes(value)) return;
    await this.host.setLanguageSetting(value as LanguageSetting);
    // The setting's own name and description change with the language.
    this.update();
  }
}
