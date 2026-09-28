// ============================================================================
// cm-editor.ts — CodeMirror 6 wrapper for the OPT editor panes.
//
// Replaces the 2016-vendored ACE editor (js/lib/ace), which had poor mobile
// support: its custom selection layer made multi-line touch selection and
// copy/paste painful on phones. CodeMirror 6 uses the browser's native text
// input/selection machinery, so select-all + copy/paste just work.
//
// Exposes the surface the existing opt-frontend.ts / opt-live.ts code depends
// on: value get/set, mode (python for main, multi-lang for test cases),
// change events, the red full-line "errorLine" highlight, the per-step gutter
// arrows (current=red, prev=green, overlap=both), and focus.
//
// Mobile-friendliness: 16px base font (avoids iOS auto-zoom-on-focus), line
// numbers on, soft tabs (4 spaces for main, 2 for test cases).
// ============================================================================

import {
  EditorState, Compartment, StateField, StateEffect, RangeSet,
} from "@codemirror/state";
import {
  EditorView, keymap, lineNumbers, highlightActiveLineGutter,
  drawSelection, dropCursor, placeholder, Decoration, GutterMarker,
  gutter, rectangularSelection,
} from "@codemirror/view";
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle, syntaxHighlighting, indentUnit,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Range as CmRange } from "@codemirror/state";
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from "@codemirror/autocomplete";
import { python, globalCompletion, localCompletionSource } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";

// --- Red error line (0-based), null to clear --------------------------------
const setErrorLineEffect = StateEffect.define<number | null>();

const errorLineField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let v = value;
    for (const e of tr.effects) {
      if (e.is(setErrorLineEffect)) v = e.value;
    }
    if (tr.docChanged && v != null) {
      v = Math.min(v, tr.state.doc.lines - 1);
    }
    return v;
  },
  provide: (f) => EditorView.decorations.of((view) => {
    const line = view.state.field(f);
    if (line == null) return RangeSet.empty;
    const from = view.state.doc.line(Math.min(line + 1, view.state.doc.lines)).from;
    return RangeSet.of([Decoration.line({ class: "cm-errorLine" }).range(from)]);
  }),
});

// --- Step-marker state (current/prev instruction line, 0-based) -------------
interface StepState { cur: number | null; prev: number | null; }
const setStepLinesEffect = StateEffect.define<StepState>();

const stepField = StateField.define<StepState>({
  create: () => ({ cur: null, prev: null }),
  update(value, tr) {
    let v = value;
    for (const e of tr.effects) {
      if (e.is(setStepLinesEffect)) v = e.value;
    }
    if (tr.docChanged) {
      const len = tr.state.doc.lines - 1;
      v = {
        cur: v.cur == null ? null : Math.min(v.cur, len),
        prev: v.prev == null ? null : Math.min(v.prev, len),
      };
    }
    return v;
  },
});

// --- Gutter marker that paints the red/green step arrows --------------------
// Uses elementClass (not toDOM): CM6 stamps the class directly on the gutter
// CELL, which carries an explicit inline pixel height, so the arrow
// background-image paints reliably (a child span with height:100% is fragile).
// This mirrors CM6's own activeLineGutterMarker. The background IMAGES live in
// css/opt-frontend.css (url() must be rewritten by css-loader).
class StepMarker extends GutterMarker {
  constructor(className: string) {
    super();
    this.elementClass = className;
  }
  eq(other: GutterMarker) {
    return other instanceof StepMarker &&
      other.elementClass === this.elementClass;
  }
}

function stepGutter() {
  return gutter({
    class: "cm-stepGutter",
    markers: (view) => {
      const { cur, prev } = view.state.field(stepField);
      const spans: CmRange<StepMarker>[] = [];
      const doc = view.state.doc;
      for (let i = 1; i <= doc.lines; i++) {
        const line0 = i - 1;
        let cls: string | null = null;
        if (cur != null && prev != null && cur === prev && line0 === cur) {
          cls = "curPrevOverlapLineStepGutter";
        } else {
          const parts: string[] = [];
          if (cur != null && line0 === cur) parts.push("curLineStepGutter");
          if (prev != null && line0 === prev) parts.push("prevLineStepGutter");
          if (parts.length) cls = parts.join(" ");
        }
        if (cls) spans.push(new StepMarker(cls).range(doc.line(i).from));
      }
      return RangeSet.of(spans);
    },
    // Re-render when the step state or the doc changes.
    lineMarkerChange: (update) =>
      update.docChanged ||
      update.state.field(stepField) !== update.startState.field(stepField),
  });
}

// Lightweight syntax highlighting — classic light-on-white look.
const baseHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#0033b3", fontWeight: "bold" },
  { tag: tags.operatorKeyword, color: "#0033b3" },
  { tag: tags.controlKeyword, color: "#0033b3", fontWeight: "bold" },
  { tag: tags.moduleKeyword, color: "#0033b3", fontWeight: "bold" },
  { tag: tags.definitionKeyword, color: "#0033b3" },
  { tag: tags.number, color: "#a31515" },
  { tag: tags.bool, color: "#0033b3" },
  { tag: tags.string, color: "#067d17" },
  { tag: tags.comment, color: "#236e25", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#236e25", fontStyle: "italic" },
  { tag: tags.blockComment, color: "#236e25", fontStyle: "italic" },
  { tag: tags.typeName, color: "#267f99" },
  { tag: tags.macroName, color: "#808000" },
  { tag: tags.variableName, color: "#001080" },
  { tag: tags.propertyName, color: "#001080" },
]);

// Dark-mode syntax highlighting — bright tokens that read well on a dark editor
// background. Swapped in/out via the highlightCompartment when the app theme
// changes (see OptCmEditor.setThemeDark / the shell's theme watcher).
const darkHighlight = HighlightStyle.define([
  { tag: tags.keyword, color: "#79c0ff", fontWeight: "bold" },
  { tag: tags.operatorKeyword, color: "#79c0ff" },
  { tag: tags.controlKeyword, color: "#79c0ff", fontWeight: "bold" },
  { tag: tags.moduleKeyword, color: "#79c0ff", fontWeight: "bold" },
  { tag: tags.definitionKeyword, color: "#79c0ff" },
  { tag: tags.number, color: "#ffa657" },
  { tag: tags.bool, color: "#79c0ff" },
  { tag: tags.string, color: "#7ee787" },
  { tag: tags.comment, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.lineComment, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.blockComment, color: "#8b949e", fontStyle: "italic" },
  { tag: tags.typeName, color: "#d2a8ff" },
  { tag: tags.macroName, color: "#f2cc60" },
  { tag: tags.variableName, color: "#e6edf3" },
  { tag: tags.propertyName, color: "#e6edf3" },
]);

// Box / rectangular selection: CM6's rectangularSelection() reacts to Alt+drag
// by default, selecting one range (cursor) per line. Works once the
// allowMultipleSelections facet is enabled in the extensions list below.
const boxSelect = rectangularSelection();

// Language mode map — maps the old ACE mode names to CM6 language extensions.
// Only python and c_cpp are installed as CM6 lang packages; the others are
// legacy ACE modes that were never actually selectable at runtime (the
// pythonVersionSelector only offers pyodide).
function langExtension(mode: string): any {
  switch (mode) {
    case "python": return python();
    case "c_cpp": return cpp();
    default: return python(); // fallback
  }
}

// --- Python autocomplete: Jedi attributes + static builtins/locals ---------
//
// The default CodeMirror python() completion only knows a static list of
// keywords/builtins/local-name-hints, so `str.` offered the bare `format`
// *function* (a builtin) but not the `str.format` *method*. That's the reported
// bug. This source fixes attribute completion by asking Jedi (static analysis,
// running in the pyodide worker) for the real member list.
//
// It is used as the single `autocompletion({ override: [source] })` source:
//   * DOT context (`str.`, `mylist.ap`, `os.`)  -> Jedi, async. Returns the
//     actual attribute/method list. Async because it round-trips the worker;
//     CodeMirror shows nothing until it settles (the worker is warm, so this
//     is ~0.5s; a client timeout in pyComplete degrades to null).
//   * BARE context (typing a plain name)        -> the exact static sources
//     @codemirror/lang-python ships (globalCompletion + localCompletionSource),
//     merged. Synchronous and identical to the current behavior, so bare-word
//     completion (keywords, builtins, None/True, local vars) never regresses
//     and never waits on the worker.
// A single source (rather than adding Jedi as a third source) prevents the
// static builtin list from also firing in dot contexts and leaking unrelated
// builtins (e.g. the bare `format`) next to the correct `str.format`.
const IDENT = /[A-Za-z0-9_]/;

function mergeCompletionResults(a: CompletionResult | null, b: CompletionResult | null): CompletionResult | null {
  const live = [a, b].filter(Boolean) as CompletionResult[];
  if (live.length === 0) return null;
  if (live.length === 1) return live[0];
  const options: Completion[] = [];
  const seen = new Set<string>();
  let from = Infinity;
  for (const r of live) {
    if (r.from < from) from = r.from;
    for (const o of r.options as Completion[]) {
      if (!seen.has(o.label)) { seen.add(o.label); options.push(o); }
    }
  }
  return { options, from, validFor: live[0].validFor };
}

// Map Jedi's completion type string to a CodeMirror option type (icon hint).
function mapJediType(t: string): Completion["type"] {
  switch (t) {
    case "class": return "class";
    case "module": return "module";
    case "keyword": return "keyword";
    case "param": return "variable";
    case "function": return "function";
    case "instance": return "property";
    default: return "property"; // methods / attributes / statement
  }
}

// A function that asks the (already-running) pyodide worker for completions at
// a cursor position. Injected from the caller, which is compiled under the
// main (ES5) tsconfig and imports it from ./pyodide/runner. cm-editor.ts itself
// stays self-contained (compiled by its own ES2017 tsconfig) and has no
// dependency on the worker/runner modules.
export type PyCompleter = (
  code: string, line: number, column: number,
) => Promise<Array<{ name: string; type: string }> | null>;

// A function that asks the (already-running) pyodide worker to RESOLVE the
// symbol at a cursor position — its name, type, module, a human-friendly repr
// (tostr), and the symbol's own docstring. Injected from the caller (which
// imports it from ./pyodide/runner); cm-editor.ts stays self-contained. Returns
// null when the symbol can't be resolved (unknown name / a bare local variable).
export type PyInferrer = (
  code: string, line: number, column: number,
) => Promise<{ name: string; type: string; module: string; tostr: string; doc: string } | null>;

function makeJediPythonSource(completer: PyCompleter) {
  return (context: CompletionContext): CompletionResult | null | Promise<CompletionResult | null> => {
    const pos = context.pos;
    // Find the start of the identifier fragment ending at the cursor.
    let from = pos;
    const doc = context.state.doc;
    while (from > 0 && IDENT.test(doc.sliceString(from - 1, from))) from--;
    // DOT context: the char immediately before that fragment is '.'.
    if (from > 0 && doc.sliceString(from - 1, from) === ".") {
      const line = doc.lineAt(pos);
      const lineNo = line.number;            // 1-based
      const column = pos - line.from;        // 0-based
      return completer(doc.toString(), lineNo, column).then((sugs) => {
        if (!sugs || sugs.length === 0) return null;
        return {
          from,               // start of the member-name fragment (just after '.')
          to: pos,
          validFor: /[A-Za-z0-9_]*/,
          options: sugs.map((s) => ({ label: s.name, type: mapJediType(s.type) })),
        };
      });
    }
    // BARE context: exact current behavior (builtins/keywords + local names).
    // globalCompletion is typed as a CompletionSource (may return a Promise in
    // some versions); in lang-python 6.x it is synchronous (completeFromList).
    // Guard for the async case and fall through to it if it ever appears.
    const a = globalCompletion(context);
    const b = localCompletionSource(context);
    if (a && typeof (a as any).then === "function") return a;
    if (b && typeof (b as any).then === "function") return b;
    return mergeCompletionResults(a as CompletionResult | null, b as CompletionResult | null);
  };
}

// --- Contextual-help keybinding (Shift+Tab) ----------------------------
// Shift+Tab shows the docstring of the symbol under the cursor (Jedi, local).
// It FALLS THROUGH to the normal outdent (indentLess) when either:
//   * no inferrer is wired / mode isn't python,
//   * the cursor is at the start of the line (in / just after the leading
//     whitespace) — i.e. where Shift+Tab has always meant "outdent",
//   * the cursor isn't sitting on a word,
//   * an autocomplete popup is open (let it keep cycling candidates).
// So we never steal the outdent shortcut — only when the cursor is on a symbol
// in the code. The returned keymap is placed FIRST so it is matched before
// indentWithTab's own Shift+Tab -> outdent binding; returning false hands off.
function makeHelpKeymap(
  inferrer: PyInferrer | undefined,
  isPython: boolean,
  showHelpAtCursor: () => boolean,
): { key: string; run: (v: EditorView) => boolean }[] {
  if (!inferrer || !isPython) return [];
  return [{
    key: "Shift-Tab",
    run: (view) => {
      const st = view.state;
      const head = st.selection.main.head;
      const line = st.doc.lineAt(head);
      const before = st.doc.sliceString(line.from, head); // text on line, before cursor
      // Start-of-line guard: cursor in the leading whitespace, or within a few
      // chars of it (e.g. just landed at `  |`) = keep the outdent behavior.
      if (/^[ \t]*$/.test(before) || before.length <= 4) return false;
      const word = st.wordAt(head);
      if (!word || word.from === word.to) return false;
      if (view.contentDOM.querySelector(".cm-tooltip.cm-tooltip-autocomplete")) return false;
      return showHelpAtCursor();
    },
  }];
}

export interface OptCmEditorOptions {
  container: HTMLElement;
  value: string;
  mode?: string;            // 'python' | 'c_cpp' (others fall back to python)
  tabSize?: number;
  placeholderText?: string;
  fontSize?: string;        // override for test-case editor (smaller)
  minLines?: number;
  maxLines?: number;
  // When set (and mode is python), attribute completion (`str.` -> format/join)
  // is served by this async completer (backed by the pyodide/Jedi worker) while
  // bare-word completion keeps the exact static behavior. Omit for the
  // test-case editor / c_cpp to keep the default static completion.
  pythonCompleter?: PyCompleter;
  // When set (and mode is python), pressing Shift+Tab with the cursor on a
  // symbol shows that symbol's docstring in a small tooltip (resolved via this
  // async inferrer — Jedi in the pyodide worker). Shift+Tab still outdents when
  // the cursor is at the start of the line (see makeHelpKeymap). Omit for the
  // test-case editor / c_cpp to disable the shortcut.
  pythonInferrer?: PyInferrer;
  onChange?: (text: string) => void;
}

export class OptCmEditor {
  private view: EditorView;
  private modeCompartment = new Compartment();
  private highlightCompartment = new Compartment();
  // --- Contextual-help (Shift+Tab) state ------------------------------
  private helpInferId = 0;            // monotonically-increasing request id (supersede stale results)
  private helpBox: HTMLElement | null = null;
  private onHelpEsc: ((e: KeyboardEvent) => void) | null = null;
  private onHelpClick: ((e: MouseEvent) => void) | null = null;
  private opts: OptCmEditorOptions;

  constructor(opts: OptCmEditorOptions) {
    this.opts = opts;
    const tab = opts.tabSize || 4;
    const fontSize = opts.fontSize || "16px";   // >=16px avoids iOS zoom

    const baseTheme = EditorView.theme({
      "&": { height: "100%", fontSize },
      ".cm-scroller": {
        fontFamily: 'Consolas, "Monaco", Menlo, "Courier New", monospace',
        fontSize: opts.fontSize || "15px",
        lineHeight: "1.45",
        overflow: "auto",
      },
      ".cm-content": { padding: "4px 0", caretColor: "#333" },
      // CM6 renders the selection as .cm-selectionBackground spans (NOT the
      // browser ::selection), and a custom baseTheme replaces the default one
      // that normally styles it — so set the color here to guarantee a visible
      // highlight. The var flips with the app theme (opt-theme.css): #c8e1ff
      // (light) / #264f78 (dark).
      ".cm-selectionBackground": { backgroundColor: "var(--opt-editor-selection, #c8e1ff)" },
      ".cm-gutters": {
        backgroundColor: "#f7f7f7",
        borderRight: "1px solid #e1e4e5",
        color: "#9da5b4",
      },
      ".cm-gutterElement": { padding: "0 5px 0 2px", whiteSpace: "pre" },
      // Step-arrow column. Each marked cell gets one of the
      // *LineStepGutter classes directly (via elementClass); its background
      // ARROW IMAGE is set in css/opt-live.css (loaded on the live page, the
      // only one that renders step markers). Here we only size the column and
      // right-align the arrow.
      ".cm-stepGutter": { width: "20px", minWidth: "20px" },
      ".cm-stepGutter .cm-gutterElement": {
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right center",
        padding: "0",
      },
      // Red error line.
      ".cm-errorLine": {
        backgroundColor: "#fdecec",
        boxShadow: "inset 3px 0 0 #e93f34",
      },
      ".cm-activeLineGutter": { background: "transparent" },
      ".cm-placeholder": { color: "#999" },
    });

    const updateListener = EditorView.updateListener.of((vu) => {
      if (vu.docChanged && this.opts.onChange) {
        this.opts.onChange(this.getValue());
      }
    });

    const startState = EditorState.create({
      doc: opts.value,
      extensions: [
        // Enable CM6's built-in multiple-selection / multiple-cursor machinery.
        // This static facet defaults to OFF, which forces every selection
        // through asSingle() (collapsing to one cursor) — the reason multi-
        // cursor appeared "unsupported". Once ON, the following all work with
        // their standard keybindings (already in the keymaps above / CM6 core):
        //   - Ctrl/Cmd+Click      add a cursor at the click (addsSelectionRange)
        //   - Ctrl/Cmd+D          select next occurrence of the word
        //   - Ctrl/Cmd+Shift+L    select ALL occurrences of the word
        //   - Alt+drag            box / rectangular selection (rectangularSelection)
        EditorState.allowMultipleSelections.of(true),
        lineNumbers(),
        highlightActiveLineGutter(),
        stepGutter(),
        drawSelection(),
        dropCursor(),
        history(),
        // Contextual help: Shift+Tab on a symbol shows its docstring. Placed
        // before indentWithTab so it wins for symbols; it returns false at the
        // line start so outdent (indentWithTab's Shift+Tab) still works. No-op
        // (empty keymap) when no inferrer is wired or the mode isn't python.
        keymap.of([...makeHelpKeymap(
          opts.pythonInferrer,
          (opts.mode || "python") === "python",
          () => this.showHelpAtCursor(),
        ), ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        // Jedi-backed attribute completion for the Python editor. When a
        // pythonCompleter is injected and the mode is python, we replace the
        // default source with one that serves real attribute lists
        // (str. -> format/join) from the worker while keeping the exact static
        // builtin/keyword/local completion for bare words. c_cpp and any
        // editor without a completer keep the default (static) behavior.
        (opts.pythonCompleter && (opts.mode || "python") === "python")
          ? autocompletion({ override: [makeJediPythonSource(opts.pythonCompleter)] })
          : autocompletion(),
        highlightSelectionMatches(),
        boxSelect,
        this.highlightCompartment.of(syntaxHighlighting(baseHighlight)),
        indentUnit.of(" ".padStart(tab, " ")),   // soft tabs
        this.modeCompartment.of(langExtension(opts.mode || "python")),
        baseTheme,
        EditorView.lineWrapping,
        placeholder(opts.placeholderText || ""),
        updateListener,
        errorLineField,
        stepField,
      ],
    });

    this.view = new EditorView({ parent: opts.container, state: startState });

    // Dismiss the contextual-help tooltip on Escape or a click elsewhere.
    // Plain document-level listeners (NOT CM6 domEventHandlers — see memory:
    // those race CM6's MouseSelection and are banned for this reason).
    if (opts.pythonInferrer) {
      this.onHelpEsc = (e: KeyboardEvent) => {
        if (e.key === "Escape") this.dismissHelp();
      };
      this.onHelpClick = (e: MouseEvent) => {
        // Dismiss when clicking outside the tip; clicking the tip itself keeps it
        // (so a student can scroll a long docstring, e.g. math.isclose).
        if (this.helpBox && !this.helpBox.contains(e.target as Node)) this.dismissHelp();
      };
      document.addEventListener("keydown", this.onHelpEsc);
      document.addEventListener("mousedown", this.onHelpClick);
    }
  }

  getValue(): string {
    return this.view.state.doc.toString();
  }

  setValue(text: string) {
    const clean = text.replace(/\s+$/, "");   // mirror ACE's rtrim
    const full = this.view.state.doc.length;
    this.view.dispatch({
      changes: { from: 0, to: full, insert: clean },
      selection: { anchor: 0 },
    });
  }

  setMode(mode: string) {
    this.opts.mode = mode;
    this.view.dispatch({
      effects: this.modeCompartment.reconfigure(langExtension(mode)),
    });
  }

  // Swap the syntax-highlight palette between light and dark (called by the
  // layout shell whenever the app theme changes). No-op-safe on the base
  // chrome — the dark editor background comes from CSS custom properties.
  setThemeDark(dark: boolean) {
    this.view.dispatch({
      effects: this.highlightCompartment.reconfigure(
        syntaxHighlighting(dark ? darkHighlight : baseHighlight)
      ),
    });
  }

  // Red full-line error highlight. line0 is 0-based; null clears.
  setErrorLine(line0: number | null) {
    this.view.dispatch({ effects: setErrorLineEffect.of(line0) });
  }

  // Per-step gutter arrows. cur0/prev0 are 0-based; null clears both.
  setStepMarkers(cur0: number | null, prev0: number | null) {
    this.view.dispatch({ effects: setStepLinesEffect.of({ cur: cur0, prev: prev0 }) });
  }

  focus() { this.view.focus(); }

  resize() { this.view.requestMeasure(); }   // CM6 auto-resizes; parity no-op

  // --- Scroll helpers (ACE parity) ----------------------------------------
  // ACE getFirstVisibleRow/getLastVisibleRow are 0-based line indices.
  getFirstVisibleRow(): number {
    return this.view.viewport.from - 1;
  }
  getLastVisibleRow(): number {
    return this.view.viewport.to - 1;
  }

  // ACE scrollToLine(line, center) takes a 1-based line number.
  scrollToLine(line1: number, center = false) {
    const doc = this.view.state.doc;
    if (line1 < 1 || line1 > doc.lines) return;
    EditorView.scrollIntoView(doc.line(line1).from, {
      y: center ? "center" : "start",
      yMargin: 16,
    });
  }

  // Move the cursor to a 0-based line/column and scroll it into view.
  gotoLineCol(line0: number, col?: number) {
    const doc = this.view.state.doc;
    const line1 = Math.max(1, Math.min(line0 + 1, doc.lines));
    let pos = doc.line(line1).from;
    if (col != null) {
      const line = doc.line(line1);
      pos = Math.min(line.from + col, line.to);
    }
    this.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    this.focus();
  }

  destroy() {
    this.dismissHelp();
    if (this.onHelpEsc) document.removeEventListener("keydown", this.onHelpEsc);
    if (this.onHelpClick) document.removeEventListener("mousedown", this.onHelpClick);
    this.onHelpEsc = null;
    this.onHelpClick = null;
    this.view.destroy();
  }

  // --- Contextual help: Shift+Tab shows the symbol under the cursor ----
  // Called by the Shift+Tab keybinding when the cursor is on a symbol (the
  // line-start / outdent guard lives in makeHelpKeymap). Fully local — resolves
  // the word via the injected inferrer (Jedi in the pyodide worker). No AI, no
  // network.
  private showHelpAtCursor(): boolean {
    const inferrer = this.opts.pythonInferrer;
    if (!inferrer || (this.opts.mode || "python") !== "python") return false;
    const view = this.view;
    const head = view.state.selection.main.head;
    const word = view.state.wordAt(head);
    if (!word || word.from === word.to) return false;
    const line = view.state.doc.lineAt(head);
    const lineNo = line.number;          // 1-based
    const column = head - line.from;     // 0-based
    const reqId = ++this.helpInferId;
    const coords = view.coordsAtPos(word.from);
    if (!coords) return false;
    inferrer(view.state.doc.toString(), lineNo, column).then((info) => {
      // Drop the result if a newer help request or dismiss superseded it.
      if (reqId !== this.helpInferId) return;
      this.showHelpBox(view, info, word, coords);
    });
    // We handled the key even though the result is async (we're going to show
    // or not show shortly); suppress CM6's default (outdent).
    return true;
  }

  private showHelpBox(
    view: EditorView,
    info: { name: string; type: string; module: string; tostr: string; doc: string } | null,
    word: { from: number; to: number },
    anchor: { top: number; left: number },
  ): void {
    this.dismissHelp();
    const box = document.createElement("div");
    box.className = "opt-help-tip";
    if (info && (info.tostr || info.doc)) {
      const sig = document.createElement("div");
      sig.className = "opt-help-sig";
      sig.textContent = info.tostr || info.name;
      box.appendChild(sig);
      const docText = (info.doc || "").trim();
      if (docText) {
        const body = document.createElement("div");
        body.className = "opt-help-doc";
        body.textContent = docText;
        box.appendChild(body);
      }
    } else {
      const none = document.createElement("div");
      none.className = "opt-help-none";
      const name = (view.state.doc.sliceString(word.from, word.to)) || "this name";
      none.textContent = "No local help available for \u201c" + name + "\u201d (unknown symbol or a local variable with no docstring).";
      box.appendChild(none);
    }
    this.view.dom.appendChild(box);
    // Position next to the word. coordsAt() is viewport-relative; the box is
    // absolutely positioned inside this.view.dom, so convert with the parent's
    // page rect (getBoundingClientRect already accounts for the scroller's
    // scroll offset). Clamp to the visible viewport.
    const host = this.view.dom;
    const hostRect = host.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const boxW = 360, boxH = Math.min(box.scrollHeight || 120, 260);
    let left = anchor.left - hostRect.left + 6;
    let top = anchor.top - hostRect.top - 6;
    if (anchor.left + 6 + boxW > vw - 6) left = anchor.left - hostRect.left - boxW - 6;
    if (left < 4) left = 4;
    if (anchor.top - 6 + boxH > vh - 6) top = anchor.top - hostRect.top - boxH - 6;
    if (top < 4) top = 4;
    box.style.left = left + "px";
    box.style.top = top + "px";
    this.helpBox = box;
  }

  dismissHelp() {
    if (this.helpBox) { this.helpBox.remove(); this.helpBox = null; }
  }
}
