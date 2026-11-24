import {
  Align,
  Cell,
  TableCaption,
  TableModel,
  makeAnchor,
  makeMergeLeft,
  makeMergeUp,
  recomputeSpans,
} from "./model";

interface RowPart {
  raw: string;
  text: string;
}

interface LogicalRow {
  parts: RowPart[];
  separator: boolean;
  blank: boolean;
}

/** Split a single table line into its raw cell strings, honoring `\|` escapes. */
export function splitRow(line: string): string[] {
  return splitRowParts(line).map((p) => p.text);
}

function splitRowParts(line: string): RowPart[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);

  const cells: RowPart[] = [];
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") {
      buf += "\\|";
      i++;
      continue;
    }
    if (ch === "|") {
      cells.push({ raw: buf, text: buf.trim() });
      buf = "";
      continue;
    }
    buf += ch;
  }
  cells.push({ raw: buf, text: buf.trim() });
  return cells;
}

/** Detect alignment from a separator cell like `:--`, `:-:`, `--:` or `---`. */
function parseAlign(cell: string): Align | null {
  const s = cell.trim().replace(/\+$/, "");
  if (!/^:?[=\-.]{1,}:?$/.test(s)) return null;
  const left = s.startsWith(":");
  const right = s.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return "none";
}

/** Returns whether the given line looks like a separator row, ignoring pipes. */
export function isSeparatorLine(line: string): boolean {
  const cells = splitRow(line);
  if (!cells.length) return false;
  return cells.every((c) => parseAlign(c) !== null);
}

/** Returns whether the line is a plausible table line (contains `|`). */
export function looksLikeTableLine(line: string): boolean {
  // Must contain at least one unescaped pipe
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      escaped = !escaped;
      continue;
    }
    if (line[i] === "|" && !escaped) return true;
    escaped = false;
  }
  return false;
}

/** Returns whether the line looks like a delimited Markdown table row. */
export function looksLikeDelimitedTableLine(line: string): boolean {
  const s = line.trim();
  let escaped = false;
  let pipes = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\") {
      escaped = !escaped;
      continue;
    }
    if (s[i] === "|" && !escaped) pipes++;
    escaped = false;
  }
  return pipes > 0 && (s.startsWith("|") || s.endsWith("|") || pipes >= 2);
}

export interface ParseResult {
  model: TableModel;
  /** True if the parser had to relax some checks (e.g. ragged rows). */
  warnings: string[];
}

function parseCaption(line: string): TableCaption | null {
  const m = line.trim().match(/^\[([^\]]+)\](?:\s*\[([^\]]+)\])?$/);
  if (!m) return null;
  return { text: m[1], label: m[2] };
}

function hasContinuation(line: string): boolean {
  const s = line.trimEnd();
  let count = 0;
  for (let i = s.length - 1; i >= 0 && s[i] === "\\"; i--) count++;
  return count % 2 === 1;
}

function removeContinuation(line: string): string {
  const s = line.trimEnd();
  return s.slice(0, -1);
}

function joinCell(a: string, b: string): string {
  if (a === "") return b;
  if (b === "") return a;
  return `${a}\n${b}`;
}

function logicalRows(lines: string[]): LogicalRow[] {
  const out: LogicalRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      out.push({ parts: [], separator: false, blank: true });
      continue;
    }
    let current = hasContinuation(line) ? removeContinuation(line) : line;
    let parts = splitRowParts(current);
    let continued = hasContinuation(line);
    while (continued && i + 1 < lines.length) {
      i++;
      const next = lines[i];
      if (next.trim() === "") break;
      current = hasContinuation(next) ? removeContinuation(next) : next;
      const nextParts = splitRowParts(current);
      const max = Math.max(parts.length, nextParts.length);
      const merged: RowPart[] = [];
      for (let c = 0; c < max; c++) {
        const raw = joinCell(parts[c]?.text ?? "", nextParts[c]?.text ?? "");
        merged.push({ raw, text: raw });
      }
      parts = merged;
      continued = hasContinuation(next);
    }
    out.push({ parts, separator: parts.length > 0 && parts.every((p) => parseAlign(p.text) !== null), blank: false });
  }
  return out;
}

function buildCell(parts: RowPart[], c: number, r: number): Cell {
  const part = parts[c];
  if (!part) return makeAnchor("");
  if (part.text === "^^" && r > 0) return makeMergeUp(1, 0);
  if (part.text === "<" && c > 0) return makeMergeLeft(1, 0);
  if (part.text === "" && part.raw === "" && c > 0) return makeMergeLeft(1, 0);
  return makeAnchor(part.text);
}

/**
 * Parse a contiguous block of table lines. Throws when no valid header/separator
 * pair can be found.
 */
export function parseTable(text: string): ParseResult {
  const rawLines = text.replace(/\r\n?/g, "\n").split("\n");
  while (rawLines.length && rawLines[0].trim() === "") rawLines.shift();
  while (rawLines.length && rawLines[rawLines.length - 1].trim() === "") rawLines.pop();

  if (rawLines.length < 2) throw new Error("Not enough lines for a table");

  let caption: TableCaption | undefined;
  const firstCaption = parseCaption(rawLines[0]);
  if (firstCaption && rawLines.length > 1) {
    caption = firstCaption;
    rawLines.shift();
  } else {
    const lastCaption = parseCaption(rawLines[rawLines.length - 1]);
    if (lastCaption && rawLines.length > 1) {
      caption = lastCaption;
      rawLines.pop();
    }
  }

  const rows = logicalRows(rawLines);
  const sepEntryIndex = rows.reduce((last, row, idx) => (!row.blank && row.separator ? idx : last), -1);
  if (sepEntryIndex < 0) throw new Error("Missing separator row");

  const nonBlankBeforeSep = rows.slice(0, sepEntryIndex).filter((row) => !row.blank);
  const headerRows = nonBlankBeforeSep.length;
  const sepCells = rows[sepEntryIndex].parts.map((p) => p.text);
  const tableRows = [...nonBlankBeforeSep, ...rows.slice(sepEntryIndex + 1).filter((row) => !row.blank)];
  const cols = Math.max(1, sepCells.length, ...tableRows.map((row) => row.parts.length));

  const aligns: Align[] = [];
  for (let i = 0; i < cols; i++) {
    aligns.push(parseAlign(sepCells[i] ?? "---") ?? "none");
  }

  const warnings: string[] = [];
  const grid: Cell[][] = [];
  const tbodyBreaks: number[] = [];
  let logicalRow = 0;
  let pendingBreak = false;

  for (let i = 0; i < rows.length; i++) {
    const entry = rows[i];
    if (i === sepEntryIndex) continue;
    if (entry.blank) {
      if (i > sepEntryIndex) pendingBreak = true;
      continue;
    }
    if (i > sepEntryIndex && pendingBreak && logicalRow >= headerRows) {
      tbodyBreaks.push(logicalRow);
    }
    pendingBreak = false;
    if (entry.parts.length !== cols) warnings.push(`Row ${logicalRow} has ${entry.parts.length} cells, expected ${cols}`);
    const row: Cell[] = [];
    for (let c = 0; c < cols; c++) {
      row.push(buildCell(entry.parts, c, logicalRow));
    }
    grid.push(row);
    logicalRow++;
  }

  const model: TableModel = {
    rows: grid,
    aligns,
    headerRows,
    cols,
    caption,
    tbodyBreaks,
  };
  recomputeSpans(model);
  return { model, warnings };
}
