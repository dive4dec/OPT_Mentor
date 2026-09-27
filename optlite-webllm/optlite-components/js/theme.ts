// OPT Mentor — theme manager (light / dark / auto)
// ---------------------------------------------------------------------------
// The theme is a `data-theme` attribute on <html> with values "light" | "dark"
// | "auto". CSS custom properties (css/opt-theme.css) resolve per theme; "auto"
// follows prefers-color-scheme. This module:
//   * reads the persisted choice (localStorage key "opt-theme") — an inline
//     <head> script in the template sets data-theme BEFORE first paint so there
//     is no light-theme flash on a dark-preference load;
//   * exposes applyTheme()/cycleTheme() for the nav-bar control;
//   * keeps "auto" live by tracking prefers-color-scheme changes.
//
// Deliberately dependency-free (no jQuery) so it can run before/after the app
// bootstrap and in both the visualize and live bundles.
// ---------------------------------------------------------------------------

export type OptTheme = "light" | "dark" | "auto";

const STORAGE_KEY = "opt-theme";
const ORDER: OptTheme[] = ["light", "dark", "auto"];

export function currentTheme(): OptTheme {
  const t = (document.documentElement.getAttribute("data-theme") || "auto") as OptTheme;
  return ORDER.indexOf(t) >= 0 ? t : "auto";
}

function persist(t: OptTheme) {
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch (_e) { /* private mode / storage disabled — non-fatal */ }
}

// Resolve the stored preference (default "auto") and apply it. Called both by
// the inline head script (via window.__optInitialTheme, if present) and here.
export function initTheme(): OptTheme {
  let t: OptTheme = "auto";
  const seeded = (window as any).__optInitialTheme as OptTheme | undefined;
  if (ORDER.indexOf(seeded) >= 0) {
    t = seeded;
  } else {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as OptTheme | null;
      if (ORDER.indexOf(stored) >= 0) t = stored;
    } catch (_e) { /* ignore */ }
  }
  applyTheme(t, /*persist=*/false);

  // Keep "auto" in sync with OS-level changes.
  if (typeof window.matchMedia === "function") {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (currentTheme() === "auto") {
        // No-op re-apply: the attribute is already "auto"; the CSS media query
        // handles it. We only re-dispatch so JS-side consumers can refresh.
        dispatchThemeChange("auto");
      }
    };
    if (typeof (mq as any).addEventListener === "function") {
      (mq as any).addEventListener("change", onChange);
    } else if (typeof (mq as any).addListener === "function") {
      (mq as any).addListener(onChange); // older Safari
    }
  }
  return t;
}

function dispatchThemeChange(t: OptTheme) {
  const resolved = resolvedTheme(t);
  document.documentElement.setAttribute("data-theme-resolved", resolved);
  window.dispatchEvent(new CustomEvent("opt-theme-change", {
    detail: { theme: t, resolved },
  }));
}

// What the user would actually SEE for a given setting (auto -> light|dark).
export function resolvedTheme(t: OptTheme): "light" | "dark" {
  if (t === "auto") {
    return (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
  }
  return t;
}

export function applyTheme(t: OptTheme, doPersist = true): OptTheme {
  document.documentElement.setAttribute("data-theme", t);
  if (doPersist) persist(t);
  dispatchThemeChange(t);
  return t;
}

export function cycleTheme(from: OptTheme): OptTheme {
  const i = ORDER.indexOf(from);
  return applyTheme(ORDER[(i + 1) % ORDER.length], true);
}

// Human-facing label for the current setting (used in the tooltip).
export function themeLabel(t: OptTheme): string {
  return t === "auto" ? "Auto" : (t === "dark" ? "Dark" : "Light");
}

// Hook a CodeMirror-6 editor (anything exposing setThemeDark(dark)) to theme
// changes: it re-paints its token palette on every "opt-theme-change" and syncs
// to the current resolved theme immediately. No-op if editor is null.
export function bindEditorTheme(editor: { setThemeDark?: (d: boolean) => void } | null | undefined) {
  if (!editor || typeof (editor as any).setThemeDark !== "function") return;
  const apply = () => {
    const html = document.documentElement;
    const resolved = (html.getAttribute("data-theme-resolved") as string) || resolvedTheme(currentTheme());
    (editor as any).setThemeDark(resolved === "dark");
  };
  window.addEventListener("opt-theme-change", apply);
  apply(); // sync the initial state
}
