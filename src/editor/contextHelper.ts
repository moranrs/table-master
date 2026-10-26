// Tiny helper used by UI modules to obtain the current ActionContext from the
// active Obsidian editor.

import { App } from "obsidian";
import type TableMasterPlugin from "../main";
import type { ActionContext } from "./actions";

export function getActionContext(_app: App, plugin: TableMasterPlugin): ActionContext | null {
  const view = plugin.getTargetMarkdownView();
  if (!view) return null;
  return {
    editor: view.editor,
    format: plugin.settings.outputFormat,
  };
}
