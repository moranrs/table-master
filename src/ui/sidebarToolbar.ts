import { ItemView, WorkspaceLeaf } from "obsidian";
import type TableMasterPlugin from "../main";
import { locateTable } from "../editor/tableLocator";
import { renderToolbar } from "./toolbarButtons";

export const TOOLBAR_VIEW_TYPE = "table-master-toolbar";

export class SidebarToolbar extends ItemView {
  constructor(leaf: WorkspaceLeaf, private plugin: TableMasterPlugin) {
    super(leaf);
  }

  getViewType(): string { return TOOLBAR_VIEW_TYPE; }
  getDisplayText(): string { return this.plugin.manifest.name; }
  getIcon(): string { return "table"; }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("tm-sidebar-toolbar");
    const toolbar = this.contentEl.createDiv({ cls: "tm-toolbar-content" });
    renderToolbar(toolbar, this.plugin);
    // Keep the editor's caret and Live Preview widget selection on mouse clicks.
    this.registerDomEvent(toolbar, "mousedown", (event) => event.preventDefault());
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
    this.registerEvent(this.app.workspace.on("editor-change", () => this.refresh()));
    this.refresh();
  }

  refresh(): void {
    const view = this.plugin.getTargetMarkdownView();
    const inTable = !!view && !!locateTable(view.editor);
    this.contentEl.querySelectorAll<HTMLButtonElement>("button.tm-btn").forEach((button) => {
      button.disabled = !view || (button.dataset.requiresTable !== "false" && !inTable);
    });
  }
}
