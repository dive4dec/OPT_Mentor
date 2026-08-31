// Shared Ask AI prompt configuration (single source of truth).
//
// The system prompt and the code-fence language tag are build-time
// constants with Python defaults. They can be overridden per deployment
// without code changes:
//
//   DefinePlugin mode (API_INJECT_TARGET=define):
//     __AI_SYSTEM_PROMPT__ / __AI_CODE_LANG__ injected by webpack.config.js
//     from env vars AI_SYSTEM_PROMPT / AI_CODE_LANG (set in Dockerfile
//     via ARG, in CI via workflow env, or in Makefile --build-arg).
//
//   Window mode (API_INJECT_TARGET=window):
//     window.AI_SYSTEM_PROMPT / window.AI_CODE_LANG written into the HTML
//     by HtmlWebpackPlugin's `window` option, read here at runtime.
//
// When unset/empty in both, the Python defaults apply — so every existing
// deployment builds correct Python prompts with zero configuration.

// Optional build-time constants (injected when API_INJECT_TARGET === 'define')
declare const __AI_SYSTEM_PROMPT__: string | undefined;
declare const __AI_CODE_LANG__: string | undefined;

export const DEFAULT_AI_SYSTEM_PROMPT =
  "You are a Python tutor. Respond ONLY with Socratic-style hints: short, guiding QUESTIONS (no solutions, no code, no imperative fixes). At most 100 words.";

export const DEFAULT_AI_CODE_LANG = "python";

function resolveOverride(defineValue: string | undefined, windowKey: string): string | undefined {
  // 1. Compile-time constant (DefinePlugin) — only present in define builds
  if (typeof defineValue !== 'undefined' && typeof defineValue === 'string' && defineValue.trim()) {
    return defineValue.trim();
  }
  // 2. Window injection (HtmlWebpackPlugin `window` option)
  const w: any = (window as any) || {};
  if (typeof w[windowKey] === 'string' && w[windowKey].trim()) {
    return w[windowKey].trim();
  }
  return undefined;
}

export function getAiSystemPrompt(): string {
  return resolveOverride(__AI_SYSTEM_PROMPT__, 'AI_SYSTEM_PROMPT') || DEFAULT_AI_SYSTEM_PROMPT;
}

export function getAiCodeLang(): string {
  return resolveOverride(__AI_CODE_LANG__, 'AI_CODE_LANG') || DEFAULT_AI_CODE_LANG;
}

// Build the Ask AI user prompt. This is the SINGLE source of truth for the
// question format — both the visualize page (visualize-ai.ts) and the live
// page (webllm.ts) must call this so they never drift apart.
//
// Key design point: the code is sent with EXPLICIT line numbers (1-based,
// matching the editor gutter) inside a properly-formed fenced code block, and
// the prompt tells the model the numbers match the editor. Sending unnumbered
// code (the old format) forced the model to count lines itself, which is where
// "wrong line number" answers came from.
export function buildAiQuestion(code: string, error: string): string {
  const cleanedError = (error || "").replace("(UNSUPPORTED FEATURES)", "").trim();

  const lines = code.split("\n");
  const width = Math.min(Math.max(String(lines.length).length, 2), 4);
  const numbered = lines
    .map((l, i) => String(i + 1).padStart(width) + ": " + l)
    .join("\n");

  // 4-backtick fence so a stray ``` in the student's code can't close it early.
  const fence = "````";
  const parts: string[] = [];
  parts.push("The code below is shown with line numbers; the numbers are 1-based and EXACTLY match the line numbers in the user's editor.");
  parts.push("## Code");
  parts.push(fence + getAiCodeLang());
  parts.push(numbered);
  parts.push(fence);
  if (cleanedError) {
    parts.push("## Error");
    parts.push(fence + "text");
    parts.push(cleanedError);
    parts.push(fence);
    parts.push("If the error message references a line number, interpret it using the numbers above. Never re-derive line numbers by counting unnumbered source.");
  }
  parts.push("## Task");
  parts.push("Ask guiding questions that help me discover the mistake myself. When you refer to a specific line, always cite its line number from the numbering above, and quote that line's code.");
  return parts.join("\n");
}
