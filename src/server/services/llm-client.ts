import type { SettingsStore } from "../settings.js";
import type { LogStore } from "./log-store.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | ChatContentPart[];
}

export type ChatContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

export class LlmClient {
  constructor(
    private readonly settings: SettingsStore,
    private readonly logs: LogStore
  ) {}

  async chat(messages: ChatMessage[], purpose = "answer"): Promise<string> {
    const runtime = this.settings.runtime().llm;
    const started = Date.now();
    const payload = {
      model: runtime.model,
      messages,
      temperature: runtime.temperature,
      max_tokens: runtime.maxTokens
    };

    if (!runtime.apiKey) {
      const error = "LLM API Key 未配置";
      this.logs.llm({ purpose, model: runtime.model, requestJson: sanitizePayloadForLog(payload), error, latencyMs: Date.now() - started });
      throw new Error(error);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), runtime.timeoutMs);
    try {
      const endpoint = `${runtime.baseUrl.replace(/\/+$/, "")}/chat/completions`;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${runtime.apiKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const text = await response.text();
      if (!response.ok) {
        throw new Error(`LLM HTTP ${response.status}: ${text.slice(0, 400)}`);
      }

      const data = JSON.parse(text) as {
        choices?: Array<{ message?: { content?: string }; text?: string }>;
      };
      const content = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.text ?? "";
      if (!content.trim()) throw new Error("LLM 返回为空");
      this.logs.llm({
        purpose,
        model: runtime.model,
        requestJson: sanitizePayloadForLog(payload),
        responseText: content,
        latencyMs: Date.now() - started
      });
      return content.trim();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logs.llm({
        purpose,
        model: runtime.model,
        requestJson: sanitizePayloadForLog(payload),
        error: message,
        latencyMs: Date.now() - started
      });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async testConnection(): Promise<string> {
    return this.chat(
      [
        { role: "system", content: "你是连接测试助手。只回答 OK。" },
        { role: "user", content: "请回答 OK" }
      ],
      "test"
    );
  }
}

function sanitizePayloadForLog<T>(payload: T): T {
  return JSON.parse(
    JSON.stringify(payload, (_key, value: unknown) => {
      if (typeof value === "string" && value.startsWith("data:image/")) {
        const mime = value.slice(5, value.indexOf(";") === -1 ? 30 : value.indexOf(";"));
        return `[image data omitted: ${mime}]`;
      }
      return value;
    })
  ) as T;
}
