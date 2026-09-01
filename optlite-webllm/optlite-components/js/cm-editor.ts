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
  gutter,
} from "@codemirror/view";
import {
  defaultKeymap, history, historyKeymap, indentWithTab,
} from "@codemirror/commands";
import {
  HighlightStyle, syntaxHighlighting, indentUnit,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import type { Range as CmRange } from "@codemirror/state";
import { python } from "@codemirror/lang-python";
import { cpp } from "@codemirror/lang-cpp";
import { autocompletion } from "@codemirror/autocomplete";
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

export interface OptCmEditorOptions {
  container: HTMLElement;
  value: string;
  mode?: string;            // 'python' | 'c_cpp' (others fall back to python)
  tabSize?: number;
  placeholderText?: string;
  fontSize?: string;        // override for test-case editor (smaller)
  minLines?: number;
  maxLines?: number;
  onChange?: (text: string) => void;
}

export class OptCmEditor {
  private view: EditorView;
  private modeCompartment = new Compartment();
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
        lineNumbers(),
        highlightActiveLineGutter(),
        stepGutter(),
        drawSelection(),
        dropCursor(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        autocompletion(),
        highlightSelectionMatches(),
        syntaxHighlighting(baseHighlight),
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

  destroy() { this.view.destroy(); }
}
