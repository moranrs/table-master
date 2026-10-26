import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class Plugin {}
  class MarkdownView { getMode() { return "source"; } }
  return { Plugin, MarkdownView, ItemView: class {}, PluginSettingTab: class {},
    Modal: class {}, MarkdownRenderChild: class {}, Notice: class {} };
});

import { Command, Editor, EditorTransaction, MarkdownView } from "obsidian";
import TableMasterPlugin from "../src/main";
import { TOOLBAR_VIEW_TYPE } from "../src/ui/sidebarToolbar";
import { DEFAULT_SETTINGS } from "../src/settings";
import { parseTable } from "../src/table/parser";
import { serialize } from "../src/table/serializer";
import { alignColumn } from "../src/editor/actions";
import * as widgetMenu from "../src/ui/tableWidgetMenu";
import { getActionContext } from "../src/editor/contextHelper";

describe("sidebar editor targeting and placement", () => {
  let plugin: TableMasterPlugin;
  let active: MarkdownView | null;
  let attached: MarkdownView[];
  let activeType: string;
  beforeEach(() => {
    active = null;
    attached = [];
    activeType = TOOLBAR_VIEW_TYPE;
    plugin = new TableMasterPlugin(null!, null!);
    Object.assign(plugin, {
      app: { workspace: {
        getActiveViewOfType: () => active,
        activeLeaf: { view: { getViewType: () => activeType } },
        iterateAllLeaves: (fn: (leaf: { view: MarkdownView }) => void) => attached.forEach(view => fn({ view })),
        getLeavesOfType: () => [],
        getRightLeaf: () => null,
      } },
      settings: { ...DEFAULT_SETTINGS },
    });
  });
  const remember = (plugin: TableMasterPlugin, view: MarkdownView) => Object.assign(plugin, { lastMarkdownView: view });
  it("registers merge selected cells in the command palette", () => {
    const commands: Command[] = [];
    Object.assign(plugin, { addCommand: (command: Command) => commands.push(command) });
    (plugin as unknown as { registerCommands(): void }).registerCommands();
    const command = commands.find((entry) => entry.id === "merge-selection");
    expect(command?.name).toBe("Merge selected cells");
    expect(command?.editorCallback).toBeTypeOf("function");
  });
  it.each(["text", "widget"])("merges cells through the registered command using %s selection", (selection) => {
    const commands: Command[] = [];
    Object.assign(plugin, { addCommand: (command: Command) => commands.push(command) });
    (plugin as unknown as { registerCommands(): void }).registerCommands();
    let text = "| A | B | C |\n| --- | --- | --- |\n| x | y | z |";
    const editor = {
      getCursor: (end?: string) => ({ line: 2, ch: end === "to" ? 8 : 2 }),
      getLine: (line: number) => text.split("\n")[line],
      lineCount: () => text.split("\n").length,
      transaction: (change: EditorTransaction) => { text = change.changes![0].text!; },
    } as unknown as Editor;
    active = new MarkdownView(null!); Object.assign(active, { editor });
    const range = vi.spyOn(widgetMenu, "findActiveWidgetSelection").mockReturnValue(
      selection === "widget" ? { r1: 1, c1: 0, r2: 1, c2: 1 } : undefined,
    );
    try {
      commands.find((entry) => entry.id === "merge-selection")!.editorCallback!(editor, active);
      expect(parseTable(text).model.rows[1][0].colspan).toBe(2);
      expect(text).toContain("x");
      expect(text).toContain("y");
    } finally { range.mockRestore(); }
  });
  it("retains the attached editor when keyboard focus enters the sidebar", () => {
    const view = new MarkdownView(null!); attached = [view]; remember(plugin, view);
    expect(plugin.getTargetMarkdownView()).toBe(view);
  });
  it("uses the newly active pane rather than the previous editor", () => {
    const previous = new MarkdownView(null!); remember(plugin, previous);
    active = new MarkdownView(null!); attached = [previous, active];
    expect(plugin.getTargetMarkdownView()).toBe(active);
  });
  it("rejects closed editors, reading view and unrelated active panes", () => {
    const view = new MarkdownView(null!); remember(plugin, view);
    expect(plugin.getTargetMarkdownView()).toBeNull();
    attached = [view]; vi.spyOn(view, "getMode").mockReturnValue("preview");
    expect(plugin.getTargetMarkdownView()).toBeNull();
    vi.spyOn(view, "getMode").mockReturnValue("source"); activeType = "canvas";
    expect(plugin.getTargetMarkdownView()).toBeNull();
  });
  it("opening and switching toolbar placement does not write note contents", async () => {
    const transaction = vi.fn();
    const view = new MarkdownView(null!);
    Object.assign(view, { editor: { transaction } });
    active = view;
    plugin.settings.toolbarPosition = "sidebar";
    await plugin.syncToolbarPosition();
    plugin.settings.toolbarPosition = "floating";
    await plugin.syncToolbarPosition();
    expect(transaction).not.toHaveBeenCalled();
  });
  it("routes an editing action from the sidebar and preserves both merge types", () => {
    let text = "| A | B | C |\n| --- | --- | --- |\n| horizontal || x |\n| vertical | y | z |\n| ^^ | q | r |";
    const transaction = vi.fn((change: EditorTransaction) => { text = change.changes![0].text!; });
    const editor = {
      getCursor: () => ({ line: 3, ch: 2 }),
      getLine: (line: number) => text.split("\n")[line],
      lineCount: () => text.split("\n").length,
      transaction,
    } as unknown as Editor;
    const view = new MarkdownView(null!); Object.assign(view, { editor });
    attached = [view]; remember(plugin, view);
    const ctx = getActionContext(plugin.app, plugin)!;
    alignColumn(ctx, "center");
    expect(transaction).toHaveBeenCalledOnce();
    const model = parseTable(text).model;
    expect(model.rows[1][0].colspan).toBe(2);
    expect(model.rows[2][0].rowspan).toBe(2);
    expect(model.aligns[0]).toBe("center");
  });
  it("migrates the old hidden preference without displaying a toolbar", async () => {
    Object.assign(plugin, { loadData: async () => ({ showFloatingToolbar: false }) });
    await plugin.loadSettings();
    expect(plugin.settings.toolbarPosition).toBe("floating");
    expect(plugin.settings.showFloatingToolbar).toBe(false);
  });
  it("restores the saved sidebar position", async () => {
    Object.assign(plugin, { loadData: async () => ({ toolbarPosition: "sidebar" }) });
    await plugin.loadSettings(); expect(plugin.settings.toolbarPosition).toBe("sidebar");
  });
  it("switching to floating detaches sidebar leaves", async () => {
    const detach = vi.fn();
    vi.spyOn(plugin.app.workspace, "getLeavesOfType").mockReturnValue([{ detach } as never]);
    await plugin.syncToolbarPosition(); expect(detach).toHaveBeenCalledOnce();
  });
  it("reveals a right-hand sidebar when none is open", async () => {
    const setViewState = vi.fn(); const revealLeaf = vi.fn(); const leaf = { setViewState };
    Object.assign(plugin.app.workspace, { getRightLeaf: () => leaf, revealLeaf });
    plugin.settings.toolbarPosition = "sidebar";
    await plugin.syncToolbarPosition();
    expect(setViewState).toHaveBeenCalledWith({ type: TOOLBAR_VIEW_TYPE, active: false });
    expect(revealLeaf).toHaveBeenCalledWith(leaf);
  });
});

describe("merged-cell fixtures", () => {
  it("preserves horizontal and vertical spans through the existing serializer", () => {
    const md = "| A | B | C |\n| --- | --- | --- |\n| horizontal || x |\n| vertical | y | z |\n| ^^ | q | r |";
    const model = parseTable(md).model;
    const result = parseTable(serialize(model, "extended")).model;
    expect(result.rows[1][0].colspan).toBe(2);
    expect(result.rows[2][0].rowspan).toBe(2);
  });
});
