import * as webllm from "../../webllm-components";

type VisualizeAIInitParams = {
  getCode: () => string;
  getMode: () => string;
};

const messages: any[] = [
  {
    content: "You are a Python tutor. Respond ONLY with Socratic-style hints: short, guiding QUESTIONS (no solutions, no code, no imperative fixes). At most 100 words.",
    role: "system",
  },
];

const availableModels = webllm.prebuiltAppConfig.model_list.map((m) => m.model_id);
const CHAT_MAX_OUTPUT_TOKENS = 512;
const CHAT_STOP_SEQUENCES = ["<|endoftext|>", "<|im_end|>"];

const engine = new webllm.MLCEngine();
let selectedModel = "sft_model_1.5B-q4f16_1-MLC (Hugging Face)";
let isEngineReady = false;

function getEl<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function formatAIResponse(text: string): string {
  if (!text) {
    return "";
  }
  text = text.replace(/(<\/think>)/gi, "\n$1");
  text = text.replace(/(<\/?(?:think|final)>)/gi, "$1\n");
  return text;
}

function setStatusText(text: string, visible: boolean = true): void {
  const status = getEl<HTMLElement>("download-status");
  if (!status) {
    return;
  }
  status.textContent = text;
  if (visible) {
    status.classList.remove("hidden");
  } else {
    status.classList.add("hidden");
  }
}

function updateEngineInitProgressCallback(report: any): void {
  if (report && report.text) {
    setStatusText(report.text);
  }
}

engine.setInitProgressCallback(updateEngineInitProgressCallback);

function getCurrentErrorText(): string {
  const visualizerError = (getEl<HTMLElement>("errorOutput")?.textContent || "").trim();
  if (visualizerError) {
    return visualizerError;
  }
  return (getEl<HTMLElement>("frontendErrorOutput")?.textContent || "").trim();
}

function hasFrontendError(): boolean {
  return getCurrentErrorText() !== "";
}

function shouldShowAskButton(getMode: () => string): boolean {
  return getMode() === "ai_display" && isEngineReady && hasFrontendError();
}

function setPanelVisibility(getMode: () => string) {
  const panel = getEl<HTMLElement>("visualize-ai-panel");
  const askButton = getEl<HTMLButtonElement>("viz-ask-ai");
  if (!panel || !askButton) {
    return;
  }

  const inAiDisplay = getMode() === "ai_display";
  panel.style.display = inAiDisplay && hasFrontendError() ? "block" : "none";
  askButton.style.display = shouldShowAskButton(getMode) ? "inline-block" : "none";

  if (!inAiDisplay) {
    const msg = getEl<HTMLElement>("viz-message-out");
    const stats = getEl<HTMLElement>("viz-chat-stats");
    if (msg) {
      msg.classList.add("hidden");
      msg.textContent = "";
    }
    if (stats) {
      stats.classList.add("hidden");
      stats.textContent = "";
    }
  }
}

async function initializeWebLLMEngine() {
  const modelSelect = getEl<HTMLSelectElement>("viz-model-selection");
  if (!modelSelect) {
    return;
  }

  setStatusText("Loading local model ...");
  selectedModel = modelSelect.value;
  try {
    await engine.reload(selectedModel, {
      temperature: 1.0,
      top_p: 1,
    } as any);
    isEngineReady = true;
  } catch (err) {
    isEngineReady = false;
    setStatusText("Model load failed.");
    throw err;
  }
}

function buildQuestion(code: string, frontendError: string): string {
  const cleanedError = (frontendError || "").replace("(UNSUPPORTED FEATURES)", "").trim();
  return "## Code ```python  " + code + "  ```  ## Error  ```text  " + cleanedError +
    "  ```  ## Task  Ask guiding questions that help me discover the mistake.";
}

async function sendAskAI(question: string) {
  const output = getEl<HTMLElement>("viz-message-out");
  const stats = getEl<HTMLElement>("viz-chat-stats");
  if (!output || !stats) {
    return;
  }

  if (!isEngineReady) {
    output.classList.remove("hidden");
    output.innerText = "Local model is still loading. Please wait.";
    return;
  }

  messages.length = 1;
  messages.push({ content: question, role: "user" });
  
  console.log("[VisualizeAI] Messages before sending:", JSON.parse(JSON.stringify(messages)));
  
  output.classList.remove("hidden");
  output.innerText = "AI is thinking...";
  stats.classList.add("hidden");
  stats.textContent = "";

  try {
    let usage: any = undefined;
    let curMessage = "";
    const completion: any = await engine.chat.completions.create({
      stream: true,
      messages,
      temperature: 1.0,
      top_p: 1,
      max_tokens: CHAT_MAX_OUTPUT_TOKENS,
      stop: CHAT_STOP_SEQUENCES,
      stream_options: { include_usage: true },
    } as any);
    for await (const chunk of completion) {
      const curDelta = chunk.choices[0]?.delta.content;
      if (curDelta) {
        curMessage += curDelta;
      }
      if (chunk.usage) {
        usage = chunk.usage;
      }
      output.innerText = "AI Response:\n" + formatAIResponse(curMessage).replace(/\?/g, '?\n');
    }

    const finalMessage = await engine.getMessage();

    console.log("[VisualizeAI] Raw model response:", finalMessage);
    
    output.innerText = "AI Response:\n" + formatAIResponse(finalMessage).replace(/\?/g, '?\n');
    if (usage && usage.prompt_tokens && usage.extra) {
      stats.classList.remove("hidden");
      stats.textContent =
        `prompt_tokens: ${usage.prompt_tokens}, completion_tokens: ${usage.completion_tokens}, ` +
        `prefill: ${usage.extra.prefill_tokens_per_s.toFixed(4)} tokens/sec, ` +
        `decoding: ${usage.extra.decode_tokens_per_s.toFixed(4)} tokens/sec`;
    }
  } catch (err) {
    output.innerText = "Error: " + String(err);
  }
}

export function initVisualizeAI(params: VisualizeAIInitParams) {
  const modelSelection = getEl<HTMLSelectElement>("viz-model-selection");
  const downloadBtn = getEl<HTMLButtonElement>("viz-download");
  const askAIButton = getEl<HTMLButtonElement>("viz-ask-ai");

  if (!modelSelection || !downloadBtn || !askAIButton) {
    return;
  }

  modelSelection.innerHTML = "";
  availableModels.forEach((modelId) => {
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = modelId;
    modelSelection.appendChild(option);
  });
  if (availableModels.length > 0) {
    selectedModel = availableModels[0];
  }
  modelSelection.value = selectedModel;
  if (availableModels.length <= 1) {
    modelSelection.style.display = "none";
  }

  askAIButton.disabled = true;

  askAIButton.addEventListener("click", () => {
    const code = params.getCode();
    const errorText = getCurrentErrorText();
    const question = buildQuestion(code, errorText);
    sendAskAI(question);
  });

  const observer = new MutationObserver(() => {
    setPanelVisibility(params.getMode);
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });

  window.addEventListener("hashchange", () => {
    setPanelVisibility(params.getMode);
  });

  // Mimic single-model live behavior: auto-load local model on init.
  if (availableModels.length > 0) {
    setStatusText("Initializing local model ...");
    initializeWebLLMEngine().then(() => {
      askAIButton.disabled = false;
      setPanelVisibility(params.getMode);
    }).catch(() => {
      askAIButton.disabled = true;
      setPanelVisibility(params.getMode);
    });
  }

  setPanelVisibility(params.getMode);
}
