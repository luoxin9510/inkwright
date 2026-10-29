import { type App, PluginSettingTab, Setting } from "obsidian";
import { T, type LanguageSetting } from "../i18n";

interface LanguageHost {
  getLanguageSetting(): LanguageSetting;
  setLanguageSetting(value: LanguageSetting): Promise<void>;
}

export class InkwrightSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly host: LanguageHost & ConstructorParameters<typeof PluginSettingTab>[1]) {
    super(app, host);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName(T().settingLanguage)
      .setDesc(T().settingLanguageDesc)
      .addDropdown((d) =>
        d
          .addOption("auto", T().followObsidian)
          .addOption("zh", "中文")
          .addOption("en", "English")
          .setValue(this.host.getLanguageSetting())
          .onChange(async (v) => {
            await this.host.setLanguageSetting(v as LanguageSetting);
            this.display();
          }),
      );
  }
}
