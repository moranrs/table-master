// Locate the GFM table that surrounds the editor cursor.
//
// Uses only line scans on Editor lines, so it's cheap and resilient to
// CodeMirror internal changes.

import type { Editor, EditorPosition } from "obsidian";
import { isSeparatorLine, looksLikeDelimitedTableLine, looksLikeTableLine, splitRow } from "../table/parser";

export interface TableLocation {
  /** First line index (0-based) of the table block (header). */
  startLine: number;
  /** Last line index (inclusive) of the table block. */
  endLine: number;
  /** Raw text of the table block joined by `\n`. */
  text: string;
  /** Cursor row within the table (0 = header). May be -1 if cursor is between cells. */
  row: number;
  /** Cursor column within the table. */
  col: number;
}

function getLine(editor: Editor, n: number): string | null {
  if (n < 0 || n >= editor.lineCount()) return null;
  return editor.getLine(n);
}

export function isCaptionLine(line: string): boolean {
  return /^\s*\[[^\]]+\](?:\s*\[[^\]]+\])?\s*$/.test(line);
}

export function isTableContextLine(line: string): boolean {
  return looksLikeTableLine(line) || isTableSeparatorLine(line);
}

export function isTableSeparatorLine(line: string): boolean {
  return looksLikeTableLine(line) && isSeparatorLine(line);
}

export function isStructuralTableLine(line: string): boolean {
  return isTableContextLine(line) || isCaptionLine(line);
}

export interface TableBlock {
  startLine: number;
  endLine: number;
  sepLine: number;
}

/**
 * Locate the table block surrounding a given cursor line. The block always
 * has exactly one separator row — a blank line between two separate tables
 * never causes the two to be merged into one block, but a blank line *inside*
 * the body (a MultiMarkdown tbody break) is preserved.
 *
 * Pure function; takes a `getLine(n)` callback so it can be unit-tested
 * without an Obsidian editor.
 */
export function findTableBlock(
  getLineFn: (n: number) => string | null,
  lineCount: number,
  cursorLine: number,
): TableBlock | null {
  const cur = getLineFn(cursorLine);
  if (cur == null) return null;
  if (!isStructuralTableLine(cur)) return null;

  // 1) Find the nearest separator line that owns this cursor. Walk both
  //    directions, never cross another separator, never cross 2+ blanks, and
  //    never cross a non-table non-blank line.
  const findSep = (dir: 1 | -1): number => {
    if (isTableSeparatorLine(cur)) return cursorLine;
    let i = cursorLine;
    let blanks = 0;
    while (true) {
      i += dir;
      if (i < 0 || i >= lineCount) return -1;
      const line = getLineFn(i);
      if (line == null) return -1;
      if (isTableSeparatorLine(line)) return i;
      if (line.trim() === "") {
        blanks++;
        if (blanks >= 2) return -1;
        continue;
      }
      blanks = 0;
      if (!isStructuralTableLine(line)) return -1;
    }
  };

  const upSep = findSep(-1);
  const downSep = findSep(1);
  let sepLine: number;
  if (upSep >= 0 && downSep >= 0) {
    sepLine = cursorLine - upSep <= downSep - cursorLine ? upSep : downSep;
  } else if (upSep >= 0) {
    sepLine = upSep;
  } else if (downSep >= 0) {
    sepLine = downSep;
  } else {
    return null;
  }

  // 2) Extend up from sepLine. Header / caption lines must be contiguous; a
  //    blank line means the table ends there. Crossing another separator is
  //    forbidden so the previous table can't be glued on.
  let start = sepLine;
  let firstHeaderLine = true;
  while (start > 0) {
    const prev = getLineFn(start - 1);
    if (prev == null) break;
    if (isTableSeparatorLine(prev)) break;
    if (isCaptionLine(prev)) {
      start--;
      continue;
    }
    if (!looksLikeTableLine(prev)) break;
    if (!firstHeaderLine && !looksLikeDelimitedTableLine(prev)) break;
    firstHeaderLine = false;
    start--;
  }

  // 3) Extend down from sepLine. Single blank acts as tbody-break only when
  //    the line two below is body (table-context but NOT a separator).
  let end = sepLine;
  while (end < lineCount - 1) {
    const next = getLineFn(end + 1);
    if (next == null) break;
    if (isTableSeparatorLine(next)) break;
    if (isStructuralTableLine(next)) {
      end++;
      continue;
    }
    if (next.trim() === "") {
      // Peek ahead: a single blank line is a tbody break only if the rows
      // below are plain body rows. If the blank is followed by a header +
      // separator pair, that's a *new table* and we must stop here.
      let j = end + 2;
      let sawSep = false;
      let sawBody = false;
      while (j < lineCount) {
        const peek = getLineFn(j);
        if (peek == null) break;
        if (isTableSeparatorLine(peek)) {
          sawSep = true;
          break;
        }
        if (peek.trim() === "") break;
        if (!isStructuralTableLine(peek)) break;
        sawBody = true;
        j++;
      }
      if (sawBody && !sawSep) {
        end += 2;
        continue;
      }
    }
    break;
  }

  if (cursorLine < start || cursorLine > end) return null;
  let hasContentRow = false;
  for (let i = start; i <= end; i++) {
    const line = getLineFn(i);
    if (line && !isTableSeparatorLine(line) && looksLikeTableLine(line)) {
      hasContentRow = true;
      break;
    }
  }
  if (!hasContentRow) return null;
  return { startLine: start, endLine: end, sepLine };
}

/** Returns the location, or null if the cursor isn't inside a recognizable table. */
export function locateTable(editor: Editor, pos?: EditorPosition): TableLocation | null {
  const cursor = pos ?? editor.getCursor();
  const block = findTableBlock(
    (n) => getLine(editor, n),
    editor.lineCount(),
    cursor.line,
  );
  if (!block) return null;
  const { startLine: start, endLine: end } = block;

  const lines: string[] = [];
  for (let i = start; i <= end; i++) lines.push(getLine(editor, i) ?? "");

  // Compute logical (row, col) for the cursor; skip captions, separators and blank lines.
  const cursorLine = getLine(editor, cursor.line) ?? "";
  let row = -1;
  if (!isSeparatorLine(cursorLine) && !isCaptionLine(cursorLine) && cursorLine.trim() !== "") {
    let logical = -1;
    for (let i = start; i <= cursor.line; i++) {
      const line = getLine(editor, i) ?? "";
      if (isSeparatorLine(line)) continue;
      if (isCaptionLine(line)) continue;
      if (line.trim() === "") continue;
      logical++;
      if (i === cursor.line) {
        row = logical;
        break;
      }
    }
  }
  const col = columnAtCursor(cursorLine, cursor.ch);

  return {
    startLine: start,
    endLine: end,
    text: lines.join("\n"),
    row,
    col,
  };
}

/** Map a horizontal character offset to the cell index in the row. */
export function columnAtCursor(line: string, ch: number): number {
  // Count unescaped pipes before `ch`. The first pipe is a leading delimiter so
  // the first cell index is 0.
  let escaped = false;
  let pipes = 0;
  for (let i = 0; i < Math.min(ch, line.length); i++) {
    const c = line[i];
    if (c === "\\") {
      escaped = !escaped;
      continue;
    }
    if (c === "|" && !escaped) pipes++;
    escaped = false;
  }
  // If the row starts with `|`, the first pipe doesn't precede any cell.
  const startsWithPipe = line.trimStart().startsWith("|");
  let col = startsWithPipe ? pipes - 1 : pipes;
  if (col < 0) col = 0;
  // Clamp to total cell count
  const total = splitRow(line).length;
  if (col >= total) col = total - 1;
  return col;
}
