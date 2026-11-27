// Floating toolbar for the active table. Implemented as a CM6 ViewPlugin so
// it lives inside Obsidian's markdown editor and follows scroll / selection /
// focus changes naturally. Three placement modes are supported (see
// `FloatingToolbarPosition`):
//   `on-click`      (default) — rests at the editor's top-left corner;
//                     jumps to click position when clicking inside a table;
//                     returns to top-left when clicking outside.
//   `follow-mouse`  — follows the mouse pointer inside a table;
//                     falls back to top-left otherwise.
//   `top-left`      — always pinned to the editor's top-left corner.

import { EditorView, ViewPlugin, ViewUpdate, PluginValue } from "@codemirror/view";
import { App, MarkdownView } from "obsidian";
import type TableMasterPlugin from "../main";
import { Icons } from "./icons";
import { t } from "../i18n";
import { appendSvgIcon, renderToolbar } from "./toolbarButtons";
import type { FloatingToolbarPosition } from "../settings";
import { findTableBlock } from "../editor/tableLocator";

/** Resolve the CM6 EditorView that is currently the *active* markdown editor.
 *  Returns null when the active workspace leaf isn't a markdown view (file
 *  explorer, settings, etc.). Used to gate every toolbar instance on whether
 *  it belongs to that view — without this, multiple open / split / hover
 *  markdown panes each show their own toolbar simultaneously. */
function activeMarkdownEditorView(app: App): EditorView | null {
  const md = app.workspace.getActiveViewOfType(MarkdownView);
  // `editor.cm` is the CM6 EditorView in Obsidian's Live Preview build. It's
  // not part of the public types but is the de facto way community plugins
  // bridge from `Editor` to CodeMirror; safe-cast through `unknown`.
  const cm = (md?.editor as unknown as { cm?: EditorView } | undefined)?.cm;
  return cm ?? null;
}

interface ToolbarHost {
  getApp(): App;
  getPlugin(): TableMasterPlugin;
}

export function buildFloatingToolbarExt(host: ToolbarHost) {
  return ViewPlugin.fromClass(
    class implements PluginValue {
      view: EditorView;
      dom: HTMLElement;
      visible = false;
      /** Gate: becomes true after the first paint settles, so we never reveal
       *  the toolbar before its stylesheet is applied (prevents the one-time
       *  "large → small" flash on first plugin enable). */
      revealed = false;
      /** Remembered collapsed state of the *docked* (top-left) presentation.
       *  When the toolbar jumps next to a cell it is forced expanded (and the
       *  toggle is hidden), but the docked state is restored on return.
       *  Backed by the plugin settings so the state is shared across every
       *  note (including ones opened later) and survives a restart, instead
       *  of each fresh note resetting to "expanded". */
      private get dockedCollapsed(): boolean {
        return host.getPlugin().settings.floatingToolbarCollapsed;
      }
      lastFrom = -1;

      constructor(view: EditorView) {
        this.view = view;
        // Use the editor's own ownerDocument (and its defaultView) instead of
        // the global `document` / `window` so the toolbar keeps working when
        // the markdown view lives inside a popout window. obsidianmd's
        // `prefer-active-doc` lint rule explicitly forbids referencing the
        // bare `document` / `window` globals.
        const doc = view.dom.ownerDocument;
        // Create the toolbar and mount it on <body> (see the note below on
        // why not `view.dom.parentElement`). `createDiv` builds the element
        // through the body's own document, so popout windows get their own
        // toolbar instead of one stranded in the main window.
        this.dom = doc.body.createDiv({ cls: "tm-floating-toolbar" });
        // Tagged so `TableMasterPlugin.onunload` can sweep up any toolbars
        // whose CM6 destroy() hook didn't fire (Obsidian doesn't always
        // reconfigure already-open editor views on plugin unload).
        this.dom.dataset.tmFloatingToolbar = "1";
        // Hidden until refresh() decides to show it. Toggled via the
        // `is-hidden` CSS class (defined in styles.css) rather than an inline
        // `display` style — obsidianmd lint forbids static style.display
        // assignments because they bypass theme overrides.
        this.dom.classList.add("is-hidden");
        // Belt-and-braces: the native `hidden` attribute (plus the
        // `.tm-floating-toolbar[hidden]` CSS rule) hides the toolbar even
        // before styles.css is applied, so an unstyled full-width box never
        // flashes on screen.
        this.dom.hidden = true;
        // Stop bubbling to avoid Obsidian re-focusing editor and dropping cursor
        this.dom.addEventListener("mousedown", (e) => e.preventDefault());
        // IMPORTANT: mount on <body>, not view.dom.parentElement. Some
        // Obsidian themes / wrappers put a `transform` (or `filter` /
        // `perspective`) on an ancestor of the editor pane to trigger GPU
        // compositing. Any of those properties anchor `position: fixed` to
        // that ancestor instead of the viewport, which is why the user saw
        // the toolbar systematically offset to the bottom-right. <body> is
        // never inside such a transform, so fixed positioning is reliable.
        this.render();
        // Subscribe to settings broadcasts so the toolbar reacts to a position
        // change without requiring the user to also click in the editor.
        this.settingsListener = () => this.refresh(this.view);
        doc.addEventListener("table-master:settings-changed", this.settingsListener);
        // Track scroll on the editor's scroll container so the toolbar can
        // re-anchor itself if a future placement mode wants viewport-tied
        // coordinates. CM6's `viewportChanged` only fires when the rendered
        // range changes, not on every scroll tick.
        // (Currently a no-op for the active modes, but kept so adding a new
        // mode that needs scroll updates is friction-free.)
        this.scrollListener = () => {
          if (this.raf != null) return;
          const win = this.view.dom.ownerDocument.defaultView ?? activeWindow;
          this.raf = win.requestAnimationFrame(() => {
            this.raf = null;
            this.refresh(this.view);
          });
        };
        view.scrollDOM.addEventListener("scroll", this.scrollListener, { passive: true });
        // Listen on the view's own window so popout windows receive their
        // own scroll events; the main `window` global wouldn't fire for them.
        const win = doc.defaultView ?? activeWindow;
        win.addEventListener("scroll", this.scrollListener, { passive: true, capture: true });
        // Install the on-click mousedown handler eagerly. It MUST exist before
        // the user's first click on a table — otherwise that click happens
        // while no listener is attached and the toolbar misses it. The handler
        // self-gates on the current mode, so it's a no-op while the user is
        // in `follow-mouse` / `top-left` mode.
        this.ensureMouseDownListener();
        // Install the mousemove listener eagerly as well. It must exist before
        // the user merely *hovers* a table in `follow-mouse` mode — otherwise
        // the toolbar would only start following after an initial click (which
        // is what previously triggered the next CM update). The handler
        // self-gates on the current mode, so it stays inert for the other
        // modes and costs nothing until a table is hovered.
        this.ensureMouseListener();
        this.scheduleInitialReveal();
      }

      // Most recent mouse coords *in viewport-relative pixels* — fed by a
      // `mousemove` listener and consumed by both the "follow-mouse" and
      // "on-click" position modes. We use `clientX/Y` so the placement code
      // can rely on `position: fixed`, which sidesteps any quirks in the
      // editor's parent chain (custom themes / unusual leaf wrappers etc.
      // — that was the root cause of "top-left mode also doesn't show").
      clientX = 0;
      clientY = 0;
      mouseInTable = false;
      hoveredCell: HTMLElement | null = null;
      /** True while the on-click toolbar is positioned at the last click
       *  point (inside a table). Cleared when the user clicks outside. */
      clickedInTable = false;
      mouseListener: ((e: MouseEvent) => void) | null = null;
      mouseDownListener: ((e: MouseEvent) => void) | null = null;
      settingsListener: (() => void) | null = null;
      scrollListener: (() => void) | null = null;
      raf: number | null = null;

      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.focusChanged) host.getPlugin().refreshSidebar();
        const settings = host.getPlugin().settings;
        if ((!settings.showFloatingToolbar || settings.toolbarPosition !== "floating")) {
          this.hide();
          return;
        }
        // `focusChanged` is essential: when the user clicks into another
        // markdown leaf (split / hover / second tab) every ViewPlugin
        // instance receives a focusChanged update. Each refresh() then
        // re-checks whether *its* view is still the active one, so only the
        // currently-active toolbar stays visible — fixing the "two toolbars
        // showing at once" symptom in split / hover-editor layouts.
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.geometryChanged ||
          u.focusChanged
        ) {
          this.refresh(u.view);
        }
      }

      destroy() {
        // Mirror the constructor's choice of doc/win so add/remove pair on
        // the same EventTarget even after the view has been detached.
        const doc = this.view.dom.ownerDocument;
        const win = doc.defaultView ?? activeWindow;
        this.dom.remove();
        if (this.mouseListener) {
          doc.removeEventListener("mousemove", this.mouseListener, true);
          doc.removeEventListener("pointermove", this.mouseListener, true);
          doc.removeEventListener("mouseover", this.mouseListener, true);
          doc.removeEventListener("pointerover", this.mouseListener, true);
          this.mouseListener = null;
        }
        if (this.mouseDownListener) {
          doc.removeEventListener("mousedown", this.mouseDownListener, true);
          this.mouseDownListener = null;
        }
        if (this.settingsListener) {
          doc.removeEventListener("table-master:settings-changed", this.settingsListener);
          this.settingsListener = null;
        }
        if (this.scrollListener) {
          this.view.scrollDOM.removeEventListener("scroll", this.scrollListener);
          win.removeEventListener("scroll", this.scrollListener, true);
          this.scrollListener = null;
        }
        if (this.raf != null) {
          win.cancelAnimationFrame(this.raf);
          this.raf = null;
        }
      }

      /** Shared entry point used by both `update()` and the mouse handler. */
      refresh(view: EditorView) {
        const settings = host.getPlugin().settings;
        if ((!settings.showFloatingToolbar || settings.toolbarPosition !== "floating")) {
          // Both mouse listeners are installed for the plugin's lifetime and
          // self-gate on the current settings, so re-enabling the toolbar does
          // not require re-loading or an extra click. Just hide for now.
          this.hide();
          return;
        }
        // Only the *active* markdown editor's toolbar should be drawn.
        // Obsidian routinely keeps multiple EditorView instances alive at
        // once — split panes, hover editors, the second pane of a linked
        // pane, the embedded editor inside a popover, etc. Every one of
        // those instances runs this ViewPlugin and mounts its own toolbar
        // DOM on <body>; without this gate they all show up simultaneously
        // (which is exactly the "two toolbars" screenshot the user reported
        // for top-left mode). We deliberately do NOT use `view.hasFocus`:
        // it only flips on keyboard focus, so common cases like "the user
        // just opened the file" or "clicked the toolbar button (which
        // preventDefaults focus shift)" would incorrectly hide us.
        const activeCM = activeMarkdownEditorView(host.getApp());
        if (!activeCM || activeCM !== view) {
          this.hide();
          return;
        }
        // Belt-and-braces: if the active view's DOM somehow has zero size
        // (e.g. mid-layout transition), bail out rather than land the
        // toolbar at (0,0).
        const rect = view.dom.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) {
          this.hide();
          return;
        }
        // Normalize legacy/unknown values to a live mode.
        const rawMode = settings.floatingToolbarPosition as string;
        const mode: FloatingToolbarPosition =
          rawMode === "follow-mouse" || rawMode === "top-left" || rawMode === "click-only"
            ? rawMode
            : "on-click";
        const parent = view.dom.parentElement;
        if (!parent) {
          this.hide();
          return;
        }

        const inTable = this.hasTableContext();

        // The continuous mousemove listener was installed once in the
        // constructor and self-gates on the current mode, so `follow-mouse`
        // works immediately after switching modes — no initial click needed.
        this.ensureMouseListener();

        // `click-only`: hidden until the user clicks a table cell.
        if (mode === "click-only") {
          if ((inTable || this.mouseInTable) && this.clickedInTable) {
            if (this.hoveredCell) this.placeNearCell(this.hoveredCell);
            else this.placeAtMouse();
          } else {
            if (!inTable && !this.mouseInTable) this.clickedInTable = false;
            this.hide();
          }
          return;
        }

        // These three modes stay visible whenever the editor is focused; only
        // `click-only` (handled above) stays hidden until a table cell is
        // clicked. `top-left` stays put; `follow-mouse` tracks the pointer;
        // `on-click` parks top-left until a cell click recenters it.
        this.ensureVisible();

        if (mode === "top-left") {
          this.placeTopLeft(view);
          return;
        }

        if (mode === "follow-mouse") {
          if (this.mouseInTable && this.hoveredCell) this.placeNearCell(this.hoveredCell);
          else if (this.mouseInTable) this.placeAtMouse();
          else this.placeTopLeft(view);
          return;
        }

        // `on-click`: park at top-left, then sit next to the cell that was
        // clicked inside the table.
        if (this.clickedInTable) {
          if (this.hoveredCell) this.placeNearCell(this.hoveredCell);
          else this.placeAtMouse();
        } else {
          this.placeTopLeft(view);
        }
      }

      /** Make the toolbar measurable & visible without leaving it at a stale position. */
      private ensureVisible() {
        if (!this.revealed) return;
        this.hideOtherToolbars();
        this.dom.hidden = false;
        if (this.dom.classList.contains("is-hidden")) {
          this.dom.classList.remove("is-hidden");
          this.visible = true;
        }
      }

      /**
       * Only one floating toolbar may be visible per window. A note can have
       * several editor instances alive (split panes, hover editors, popovers),
       * and a hot-reloaded build can leave a stale toolbar behind; without this
       * the toolbar could appear twice (one of them just a collapsed toggle
       * pill sitting next to the real toolbar).
       */
      private hideOtherToolbars() {
        const doc = this.view.dom.ownerDocument;
        doc.querySelectorAll<HTMLElement>('[data-tm-floating-toolbar="1"]').forEach((el) => {
          if (el === this.dom) return;
          el.classList.add("is-hidden");
          el.hidden = true;
        });
      }

      /** Reveal only after two animation frames so the plugin stylesheet and
       *  initial layout are in place. This eliminates the one-time
       *  "grows then shrinks" flash seen the first time the plugin is enabled. */
      private scheduleInitialReveal() {
        const win = this.view.dom.ownerDocument.defaultView ?? activeWindow;
        const reveal = () => {
          this.revealed = true;
          this.dom.classList.add("is-ready");
          this.refresh(this.view);
        };
        if (typeof win.requestAnimationFrame === "function") {
          win.requestAnimationFrame(() => win.requestAnimationFrame(reveal));
        } else {
          win.setTimeout(reveal, 0);
        }
      }

      private ensureMouseListener() {
        if (this.mouseListener) return;
        const fn = (e: MouseEvent) => {
          const target = e.target as HTMLElement | null;
          // Ignore pointer movement over the toolbar itself (it lives on
          // <body>) so hovering it to click a button never yanks it away.
          if (target && this.dom.contains(target)) return;
          // Only react to moves inside this editor pane.
          if (!target || !this.view.dom.contains(target)) return;
          const settings = host.getPlugin().settings;
          if ((!settings.showFloatingToolbar || settings.toolbarPosition !== "floating")) return;
          if (settings.floatingToolbarPosition !== "follow-mouse") return;
          // The element actually under the pointer tells us precisely whether
          // we are over a table — no coordinate guessing that would also fire
          // over the empty space beside a table.
          this.clientX = e.clientX;
          this.clientY = e.clientY;
          this.hoveredCell = target.closest?.("td, th") ?? null;
          this.mouseInTable = !!target.closest?.("table");
          if (this.raf != null) return;
          const win = this.view.dom.ownerDocument.defaultView ?? activeWindow;
          this.raf = win.requestAnimationFrame(() => {
            this.raf = null;
            const rect = this.view.dom.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return;
            // DOM-rect fallback for cases where the table widget swallows the
            // event target (e.g. pointer-events styling): if the pointer is
            // geometrically inside a rendered table, treat it as hovering it.
            const hit = this.hitTestTable(this.clientX, this.clientY);
            const inTable = this.mouseInTable || hit.inTable;
            const cell = this.hoveredCell ?? hit.cell;
            this.mouseInTable = inTable;
            this.hoveredCell = cell;
            this.ensureVisible();
            if (inTable) {
              if (cell) this.placeNearCell(cell);
              else this.placeAtMouse(true);
            } else {
              this.placeTopLeft(this.view);
            }
          });
        };
        // Listen on the document in the capture phase so Obsidian's Live
        // Preview table widget (which can stop propagation in the bubble
        // phase) can't hide hover events from us. Scoped to events whose
        // target is inside this editor, so other panes don't react.
        const doc = this.view.dom.ownerDocument;
        doc.addEventListener("mousemove", fn, true);
        doc.addEventListener("pointermove", fn, true);
        doc.addEventListener("mouseover", fn, true);
        doc.addEventListener("pointerover", fn, true);
        this.mouseListener = fn;
      }

      /** Find the table cell (if any) under a viewport-space point. */
      private hitTestTable(x: number, y: number): { cell: HTMLElement | null; inTable: boolean } {
        // Prefer tables that live inside this editor; fall back to the whole
        // document in case a renderer places the table in a sibling node.
        const root: ParentNode = this.view.dom.querySelector("table")
          ? this.view.dom
          : this.view.dom.ownerDocument;
        const tables = root.querySelectorAll<HTMLTableElement>("table");
        for (const table of Array.from(tables)) {
          const tr = table.getBoundingClientRect();
          if (x < tr.left || x > tr.right || y < tr.top || y > tr.bottom) continue;
          const cells = table.querySelectorAll<HTMLElement>("td, th");
          for (const cell of Array.from(cells)) {
            const cr = cell.getBoundingClientRect();
            if (x >= cr.left && x <= cr.right && y >= cr.top && y <= cr.bottom) {
              return { cell, inTable: true };
            }
          }
          return { cell: null, inTable: true };
        }
        return { cell: null, inTable: false };
      }

      /**
       * Document-level mousedown handler that drives the `on-click` mode.
       * Captured (useCapture=true) so we see the click before CM6 / Obsidian
       * potentially stop propagation. Clicks inside a `<table>` show the
       * toolbar at that point; clicks outside any table (and not on the
       * toolbar itself) hide it.
       */
      private ensureMouseDownListener() {
        if (this.mouseDownListener) return;
        const fn = (e: MouseEvent) => {
          const settings = host.getPlugin().settings;
          if ((!settings.showFloatingToolbar || settings.toolbarPosition !== "floating")) return;
          const mode = settings.floatingToolbarPosition as string;
          if (mode !== "on-click" && mode !== "click-only") return;
          const target = e.target as HTMLElement | null;
          if (!target) return;
          // Click on the toolbar itself: don't hide, don't reposition; let
          // the button's own click handler run.
          if (this.dom.contains(target)) return;
          // Only act on clicks within our editor view; otherwise stale state
          // from another pane could move our toolbar.
          if (!this.view.dom.contains(target)) return;
          // Don't pop up unless we're the active markdown editor — prevents a
          // background split-pane / hover-editor view from snapping its own
          // toolbar to a click that was intended for the foreground pane.
          const activeCM = activeMarkdownEditorView(host.getApp());
          if (activeCM !== this.view) return;
          if (target.closest("table")) {
            this.clientX = e.clientX;
            this.clientY = e.clientY;
            this.hoveredCell = target.closest<HTMLElement>("td, th");
            this.mouseInTable = true;
            this.clickedInTable = true;
            // Position first, then reveal — so the toolbar appears directly at
            // the click position instead of flashing at its previous spot.
            if (this.hoveredCell) {
              this.placeNearCell(this.hoveredCell);
            } else {
              this.placeAtMouse();
            }
          } else {
            this.clickedInTable = false;
            this.hoveredCell = null;
            this.mouseInTable = false;
            // `click-only` hides again after clicking outside a table; the
            // other modes simply return to the editor's top-left corner.
            if (mode === "click-only") this.hide();
            else this.placeTopLeft(this.view);
          }
        };
        // Listen on the view's own document so the on-click handler still
        // fires when the editor lives inside a popout window.
        this.view.dom.ownerDocument.addEventListener("mousedown", fn, true);
        this.mouseDownListener = fn;
      }

      private removeMouseDownListener() {
        if (!this.mouseDownListener) return;
        this.view.dom.ownerDocument.removeEventListener("mousedown", this.mouseDownListener, true);
        this.mouseDownListener = null;
      }

      hide() {
        this.dom.classList.add("is-hidden");
        this.dom.hidden = true;
        this.visible = false;
      }

      /**
       * Pin the toolbar to the top-left corner of the editor pane using
       * `position: fixed`. Uses the editor's own bounding rect (in viewport
       * coords) and — because we're mounted on <body> — those coords land
       * exactly where the user expects, with no transformed-ancestor offset.
       */
      private placeTopLeft(view: EditorView) {
        const rect = view.dom.getBoundingClientRect();
        const baseLeft = Math.max(rect.left, 0);
        this.dom.style.top = `${Math.max(rect.top, 0)}px`;
        this.dom.style.left = `${baseLeft}px`;
        // Docked presentation → the collapse toggle is available.
        this.dom.classList.remove("is-near-cell");
        this.applyDockedState();
        this.ensureVisible();
      }

      /** True when the caret/selection is inside a rendered table. */
      private hasTableContext(): boolean {
        const sel = this.view.dom.ownerDocument.getSelection();
        const node = sel?.anchorNode;
        const anchor = node && node.instanceOf(HTMLElement) ? node : node?.parentElement;
        const table = anchor?.closest?.("table");
        if (table && this.view.dom.contains(table)) return true;

        const doc = this.view.state.doc;
        const line = doc.lineAt(this.view.state.selection.main.head).number - 1;
        return (
          findTableBlock(
            (n) => (n < 0 || n >= doc.lines ? null : doc.line(n + 1).text),
            doc.lines,
            line,
          ) !== null
        );
      }

      /** Place the toolbar just below a table cell (slightly overlapping its
       *  bottom border) instead of on top of the cell / next cell. */
      private placeNearCell(cell: HTMLElement) {
        const rect = cell.getBoundingClientRect();
        const myWidth = this.dom.offsetWidth || 200;
        const myHeight = this.dom.offsetHeight || 80;
        const win = this.view.dom.ownerDocument.defaultView ?? activeWindow;
        const maxLeft = win.innerWidth - myWidth - 4;
        const maxTop = win.innerHeight - myHeight - 4;
        const left = Math.min(Math.max(rect.left, 4), Math.max(maxLeft, 4));
        const top = Math.min(Math.max(rect.bottom - 2, 4), Math.max(maxTop, 4));
        this.dom.style.top = `${top}px`;
        this.dom.style.left = `${left}px`;
        // Docked next to a cell → no collapse toggle, always expanded.
        this.dom.classList.add("is-near-cell");
        this.expandIfCollapsed();
        this.ensureVisible();
      }

      /**
       * Place the toolbar so its top-left corner sits at the latest pointer
       * position. The user explicitly asked for no offset — the toolbar
       * shows up exactly at the click point. Clamp to the viewport so the
       * toolbar is never partially off-screen.
       */
      private placeAtMouse(offset = false) {
        // `position: fixed` lives in styles.css; only the dynamic top/left
        // are set inline (see comment in placeTopLeft).
        const myWidth = this.dom.offsetWidth || 200;
        const myHeight = this.dom.offsetHeight || 80;
        // Clamp against the editor's own window so popout-window toolbars
        // get the right viewport extents.
        const win = this.view.dom.ownerDocument.defaultView ?? activeWindow;
        const maxLeft = win.innerWidth - myWidth - 4;
        const maxTop = win.innerHeight - myHeight - 4;
        // For hover-following, nudge the toolbar off the cursor so it doesn't
        // sit underneath the pointer (which would swallow the next mousemove).
        const dx = offset ? 14 : 0;
        const dy = offset ? 18 : 0;
        const left = Math.min(Math.max(this.clientX + dx, 4), Math.max(maxLeft, 4));
        const top = Math.min(Math.max(this.clientY + dy, 4), Math.max(maxTop, 4));
        this.dom.style.top = `${top}px`;
        this.dom.style.left = `${left}px`;
        this.dom.classList.add("is-near-cell");
        this.expandIfCollapsed();
        this.ensureVisible();
      }

      /** When the toolbar jumps next to a table cell it must be fully expanded,
       *  because the collapse toggle is hidden in that presentation. */
      private expandIfCollapsed() {
        if (!this.dom.classList.contains("is-collapsed")) return;
        this.dom.classList.remove("is-collapsed");
        const content = this.dom.querySelector<HTMLElement>(".tm-toolbar-content");
        if (content) {
          content.classList.remove("is-size-locked");
          content.setCssProps({ "--tm-locked-width": "", "--tm-locked-height": "" });
        }
      }

      /** Restore the remembered docked collapsed/expanded state. */
      private applyDockedState() {
        // Skip until the first reveal has happened: before the toolbar is
        // visible the content has zero size, so we couldn't measure its
        // natural width/height (needed for a smooth later expand animation).
        if (!this.revealed) return;
        const content = this.dom.querySelector<HTMLElement>(".tm-toolbar-content");
        if (this.dockedCollapsed) {
          // Capture the natural size once so collapsing now and expanding
          // later can animate from a concrete pixel width instead of `auto`.
          if (content && (!content.dataset.tmWidth || !content.dataset.tmHeight)) {
            const w = content.offsetWidth;
            const h = content.offsetHeight;
            if (w > 0 && h > 0) {
              content.dataset.tmWidth = String(w);
              content.dataset.tmHeight = String(h);
            }
          }
          this.dom.classList.add("is-collapsed");
          if (content && content.dataset.tmWidth && content.dataset.tmHeight) {
            content.setCssProps({
              "--tm-locked-width": `${content.dataset.tmWidth}px`,
              "--tm-locked-height": `${content.dataset.tmHeight}px`,
            });
            content.classList.add("is-size-locked");
          }
        } else {
          this.dom.classList.remove("is-collapsed");
          if (content) {
            content.classList.remove("is-size-locked");
            content.setCssProps({ "--tm-locked-width": "", "--tm-locked-height": "" });
          }
        }
      }

      render() {
        this.dom.empty();

        // Content wrapper holds all button groups.
        const content = this.dom.createDiv({ cls: "tm-toolbar-content" });
        renderToolbar(content, host.getPlugin());

        // Collapse toggle: only shown in the docked (top-left) presentation.
        // This rule is enforced in CSS via `.is-near-cell` (added by
        // placeNearCell/placeAtMouse), so the button disappears when the
        // toolbar jumps next to a table cell.
        const toggleBtn = this.dom.createDiv({ cls: "tm-collapse-toggle" });
        toggleBtn.setAttribute("aria-label", t("tip.collapseToolbar"));
        toggleBtn.title = t("tip.collapseToolbar");
        appendSvgIcon(toggleBtn, Icons.chevronLeft);
        const lockContentSize = () => {
          const w = content.offsetWidth;
          const h = content.offsetHeight;
          content.setCssProps({
            "--tm-locked-width": `${w}px`,
            "--tm-locked-height": `${h}px`,
          });
          content.dataset.tmWidth = String(w);
          content.dataset.tmHeight = String(h);
          content.classList.add("is-size-locked");
        };
        const unlockContentSize = () => {
          if (this.dom.classList.contains("is-collapsed")) return;
          content.classList.remove("is-size-locked");
          content.setCssProps({
            "--tm-locked-width": "",
            "--tm-locked-height": "",
          });
        };
        toggleBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!this.dom.classList.contains("is-collapsed")) {
            lockContentSize();
            void content.offsetWidth;
            this.dom.classList.add("is-collapsed");
            host.getPlugin().setFloatingToolbarCollapsed(true);
            this.placeTopLeft(this.view);
            this.clickedInTable = false;
          } else {
            if (content.dataset.tmWidth && content.dataset.tmHeight) {
              content.setCssProps({
                "--tm-locked-width": `${content.dataset.tmWidth}px`,
                "--tm-locked-height": `${content.dataset.tmHeight}px`,
              });
              content.classList.add("is-size-locked");
            }
            this.dom.classList.remove("is-collapsed");
            host.getPlugin().setFloatingToolbarCollapsed(false);
            const win = this.view.dom.ownerDocument.defaultView ?? activeWindow;
            win.setTimeout(unlockContentSize, 350);
          }
        });
      }

    },
  );
}
