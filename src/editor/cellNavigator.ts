// Tab / Shift-Tab / Enter navigation between table cells. Used by the editor
// extension wired up in main.ts.
//
// IMPORTANT: navigation only moves the caret to another cell — it never
// rewrites/reformats the table. The previous implementation re-serialized the
// whole table on every key press and then re-positioned the caret, which in
// Obsidian's Live Preview table widget produced wrong caret positions
// ("jumps to bottom-left") and dropped focus (issue #1). A pure caret move has
// none of those side effects.

import type { Editor, EditorPosition } from "obsidian";
import { locateTable, TableLocation } from "./tableLocator";
import { isSeparatorLine, parseTable } from "../table/parser";
import type { TableModel } from "../table/model";

function isCaptionLine(line: string): boolean {
  return /^\s*\[[^\]]+\](?:\s*\[[^\]]+\])?\s*$/.test(line);
}

/** Start char (just after the leading `| ` and padding) of cell `col` in a row. */
function cellStartCh(line: string, col: number): number {
  let pipes = 0;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "\\") {
      escaped = !escaped;
      continue;
    }
    if (c === "|" && !escaped) {
      pipes++;
      if (pipes === col + 1) {
        let ch = i + 1;
        while (ch < line.length && line[ch] === " ") ch++;
        return ch;
      }
    }
    escaped = false;
  }
  // Table without outer pipes (e.g. `a | b`): first cell starts at line start.
  return 0;
}

/** Compute the editor position of the (row, col) cell inside a located table. */
function cellPosition(editor: Editor, loc: TableLocation, row: number, col: number): EditorPosition | null {
  let logical = -1;
  let targetLine = -1;
  for (let i = loc.startLine; i <= loc.endLine; i++) {
    const line = editor.getLine(i);
    if (isSeparatorLine(line) || isCaptionLine(line) || line.trim() === "") continue;
    logical++;
    if (logical === row) {
      targetLine = i;
      break;
    }
  }
  if (targetLine < 0) return null;
  return { line: targetLine, ch: cellStartCh(editor.getLine(targetLine), col) };
}

/** Append a blank markdown row after the table and place the caret in `col`. */
function appendBlankRow(editor: Editor, loc: TableLocation, model: TableModel, col: number): void {
  const lastLine = loc.endLine;
  const lastText = editor.getLine(lastLine) ?? "";
  const blank = "| " + new Array(model.cols).fill("  ").join(" | ") + " |";
  const ch = Math.min(cellStartCh(blank, col), blank.length);
  const pos: EditorPosition = { line: lastLine + 1, ch };
  editor.transaction({
    changes: [{ from: { line: lastLine, ch: lastText.length }, to: { line: lastLine, ch: lastText.length }, text: "\n" + blank }],
    selection: { from: pos, to: pos },
  });
}

export function navigateCell(editor: Editor, dir: "next" | "prev"): boolean {
  const loc = locateTable(editor);
  if (!loc) return false;
  const model = parseTable(loc.text).model;
  let row = loc.row < 0 ? 0 : loc.row;
  let col = loc.col;

  if (dir === "next") {
    col += 1;
    if (col >= model.cols) {
      col = 0;
      row += 1;
    }
  } else {
    col -= 1;
    if (col < 0) {
      col = model.cols - 1;
      row -= 1;
    }
  }

  // Shift-Tab on the very first cell: consume the key but do nothing (issue #1.4).
  if (row < 0) return true;

  // Tab past the bottom-right cell: append a new row, land on its first cell.
  if (row >= model.rows.length) {
    appendBlankRow(editor, loc, model, 0);
    return true;
  }

  const pos = cellPosition(editor, loc, row, col);
  if (!pos) return false;
  editor.setCursor(pos);
  return true;
}

export function navigateRowEnter(editor: Editor): boolean {
  const loc = locateTable(editor);
  if (!loc) return false;
  const model = parseTable(loc.text).model;
  const row = (loc.row < 0 ? 0 : loc.row) + 1;
  const col = loc.col;

  if (row >= model.rows.length) {
    appendBlankRow(editor, loc, model, col);
    return true;
  }

  const pos = cellPosition(editor, loc, row, col);
  if (!pos) return false;
  editor.setCursor(pos);
  return true;
}
