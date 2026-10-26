import { App, PluginSettingTab, Setting } from "obsidian";
import type TableMasterPlugin from "./main";
import type { OutputFormat } from "./table/serializer";
import type { Align } from "./table/model";
import type { LangChoice } from "./i18n";
import { setLanguage, t } from "./i18n";

/** Where the floating toolbar should anchor.
 *  - `on-click`        : default. Hidden until the user clicks inside a
 *                        table, then springs up at the click point. Stays
 *                        put until the next click outside any table.
 *  - `follow-mouse`    : always visible while editor is focused. Follows the
 *                        mouse pointer when it's hovering over a table; falls
 *                        back to the editor's top-left corner otherwise.
 *  - `top-left`        : always visible while editor is focused, pinned to the
 *                        editor's top-left corner.
 */
export type FloatingToolbarPosition =
  | "on-click"
  | "follow-mouse"
  | "top-left";

export interface TableMasterSettings {
  outputFormat: OutputFormat;
  showFloatingToolbar: boolean;
  toolbarPosition: "floating" | "sidebar";
  floatingToolbarPosition: FloatingToolbarPosition;
  enableTabNavigation: boolean;
  defaultAlign: Align;
  language: LangChoice;
}

export const DEFAULT_SETTINGS: TableMasterSettings = {
  outputFormat: "extended",
  showFloatingToolbar: true,
  toolbarPosition: "floating",
  floatingToolbarPosition: "on-click",
  enableTabNavigation: true,
  defaultAlign: "none",
  language: "auto",
};

export class TableMasterSettingTab extends PluginSettingTab {
  plugin: TableMasterPlugin;

  constructor(app: App, plugin: TableMasterPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // Obsidian renders the plugin name as the settings-tab heading
    // automatically, so we don't add a manual <h2> here (which would also
    // trip `obsidianmd/settings-tab/no-manual-html-headings`).

    new Setting(containerEl)
      .setName(t("set.language"))
      .addDropdown((dd) => {
        dd.addOption("auto", t("set.language.auto"));
        dd.addOption("en", t("set.language.en"));
        dd.addOption("zh", t("set.language.zh"));
        dd.setValue(this.plugin.settings.language);
        dd.onChange(async (v) => {
          this.plugin.settings.language = v as LangChoice;
          setLanguage(this.plugin.settings.language);
          await this.plugin.saveSettings();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName(t("set.outputFormat"))
      .setDesc(t("set.outputFormat.desc"))
      .addDropdown((dd) => {
        dd.addOption("extended", t("set.outputFormat.extended"));
        dd.addOption("html", t("set.outputFormat.html"));
        dd.setValue(this.plugin.settings.outputFormat);
        dd.onChange(async (v) => {
          this.plugin.settings.outputFormat = v as OutputFormat;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("set.toolbarLocation"))
      .setDesc(t("set.toolbarLocation.desc"))
      .addDropdown((dd) => {
        dd.addOption("floating", t("set.toolbarLocation.floating"));
        dd.addOption("sidebar", t("set.toolbarLocation.sidebar"));
        dd.setValue(this.plugin.settings.toolbarPosition);
        dd.onChange(async (v) => {
          this.plugin.settings.toolbarPosition = v as "floating" | "sidebar";
          this.plugin.settings.showFloatingToolbar = true;
          await this.plugin.saveSettings();
          await this.plugin.syncToolbarPosition();
          this.display();
        });
      });

    if (this.plugin.settings.toolbarPosition === "floating") {
      new Setting(containerEl)
        .setName(t("set.toolbarPosition"))
        .setDesc(t("set.toolbarPosition.desc"))
        .addDropdown((dd) => {
          dd.addOption("on-click", t("set.toolbarPosition.onClick"));
          dd.addOption("follow-mouse", t("set.toolbarPosition.followMouse"));
          dd.addOption("top-left", t("set.toolbarPosition.topLeft"));
          // Old config files may still hold the removed `above-table` value;
          // fall back to the new default so the dropdown shows a valid choice.
          const current = (this.plugin.settings.floatingToolbarPosition as string) === "above-table"
            ? "on-click"
            : this.plugin.settings.floatingToolbarPosition;
          dd.setValue(current);
          dd.onChange(async (v) => {
            this.plugin.settings.floatingToolbarPosition = v as FloatingToolbarPosition;
            await this.plugin.saveSettings();
            this.plugin.broadcastSettingsChanged();
          });
        });

    }

    new Setting(containerEl)
      .setName(t("set.tabNavigation"))
      .setDesc(t("set.tabNavigation.desc"))
      .addToggle((tg) => {
        tg.setValue(this.plugin.settings.enableTabNavigation);
        tg.onChange(async (v) => {
          this.plugin.settings.enableTabNavigation = v;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName(t("set.defaultAlign"))
      .addDropdown((dd) => {
        dd.addOption("none", "—");
        dd.addOption("left", t("modal.alignLeft"));
        dd.addOption("center", t("modal.alignCenter"));
        dd.addOption("right", t("modal.alignRight"));
        dd.setValue(this.plugin.settings.defaultAlign);
        dd.onChange(async (v) => {
          this.plugin.settings.defaultAlign = v as Align;
          await this.plugin.saveSettings();
        });
      });
  }
}
