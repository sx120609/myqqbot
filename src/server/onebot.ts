import type { FastifyInstance, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import type { SettingsStore } from "./settings.js";
import type { MessageProcessor } from "./services/message-processor.js";
import { markdownToPlainText, renderReplyImage } from "./services/reply-image-renderer.js";

interface OneBotEvent {
  post_type?: string;
  message_type?: "private" | "group";
  user_id?: number | string;
  group_id?: number | string;
  self_id?: number | string;
  raw_message?: string;
  message?: string | Array<{ type: string; data?: Record<string, string | number> }>;
}

interface OneBotActionResponse {
  echo?: string;
  status?: string;
  retcode?: number;
  data?: {
    message_id?: number | string;
  };
}

interface ExtractedContent {
  text: string;
  images: Array<{
    url?: string;
    file?: string;
    summary?: string;
  }>;
}

type OutgoingMessage =
  | string
  | Array<{
      type: "image";
      data: {
        file: string;
      };
    }>;

const ACTION_RESPONSE_TIMEOUT_MS = 5_000;
const GENERATING_NOTICE_TEXT = "正在生成回答中，请稍等。内容较长时可能需要更多时间。";

export class OneBotGateway {
  private sockets = new Set<WebSocket>();
  private connectedAt: string | null = null;
  private lastEventAt: string | null = null;
  private selfId: string | null = null;
  private actionSeq = 0;
  private readonly pendingActions = new Map<
    string,
    {
      timer: ReturnType<typeof setTimeout>;
      resolve: (response: OneBotActionResponse | null) => void;
    }
  >();

  constructor(
    private readonly settings: SettingsStore,
    private readonly processor: MessageProcessor
  ) {}

  async register(app: FastifyInstance): Promise<void> {
    await app.register(websocket);
    app.get("/onebot/v11/ws", { websocket: true }, (socket, request) => {
      if (!this.authorized(request)) {
        socket.close(1008, "unauthorized");
        return;
      }

      this.sockets.add(socket);
      this.connectedAt = new Date().toISOString();

      socket.on("message", (raw: Buffer) => {
        void this.handleMessage(socket, raw.toString());
      });
      socket.on("close", () => {
        this.sockets.delete(socket);
      });
      socket.on("error", () => {
        this.sockets.delete(socket);
      });
    });
  }

  status(): unknown {
    return {
      connected: this.sockets.size > 0,
      connections: this.sockets.size,
      connectedAt: this.connectedAt,
      lastEventAt: this.lastEventAt,
      selfId: this.selfId,
      wsPath: "/onebot/v11/ws"
    };
  }

  private async handleMessage(socket: WebSocket, raw: string): Promise<void> {
    let payload: unknown;
    try {
      payload = JSON.parse(raw) as unknown;
    } catch {
      return;
    }

    if (isActionResponse(payload)) {
      this.resolveActionResponse(payload);
      return;
    }

    const event = payload as OneBotEvent;
    if (event.self_id) this.selfId = String(event.self_id);
    this.lastEventAt = new Date().toISOString();
    if (event.post_type !== "message" || !event.message_type || !event.user_id) return;

    const content = extractContent(event);
    if (!content.text.trim() && content.images.length === 0) return;

    const mentionedBot = isMentioned(event, this.selfId);
    const conversationKey =
      event.message_type === "group" ? `group:${event.group_id}:user:${event.user_id}` : `private:${event.user_id}`;

    const generatingNotice = this.shouldSendGeneratingNotice(event, mentionedBot)
      ? this.sendMessage(socket, event, GENERATING_NOTICE_TEXT, "generating", true)
      : null;

    try {
      const result = await this.processor.process({
        platform: "onebot",
        text: content.text,
        images: content.images,
        messageType: event.message_type,
        userId: String(event.user_id),
        groupId: event.group_id == null ? undefined : String(event.group_id),
        conversationKey,
        mentionedBot
      });

      if (result.handled && result.reply) {
        await this.sendReply(socket, event, result.reply);
      }
    } catch (error) {
      console.error("[onebot] Failed to process message:", error);
    } finally {
      await this.deleteGeneratingNotice(socket, generatingNotice);
    }
  }

  private async sendReply(socket: WebSocket, event: OneBotEvent, reply: string): Promise<void> {
    const onebotSettings = this.settings.runtime().onebot;
    if (onebotSettings.replyAsImage) {
      try {
        const image = renderReplyImage(reply, {
          headerTitle: onebotSettings.replyImageTitle,
          headerBadge: onebotSettings.replyImageBadge
        });
        await this.sendMessage(socket, event, [
          {
            type: "image",
            data: {
              file: `base64://${image.dataBase64}`
            }
          }
        ]);
        return;
      } catch (error) {
        console.warn("[onebot] Failed to render reply image, falling back to text:", error);
      }
    }

    const chunks = splitMessage(markdownToPlainText(reply), 850);
    for (const [index, message] of chunks.entries()) {
      await this.sendMessage(socket, event, message, `reply-${index}`);
    }
  }

  private async deleteGeneratingNotice(
    socket: WebSocket,
    generatingNotice: Promise<OneBotActionResponse | null> | null
  ): Promise<void> {
    if (!generatingNotice) return;
    const response = await generatingNotice;
    const messageId = response?.data?.message_id;
    if (messageId == null) return;
    await this.sendAction(socket, "delete_msg", { message_id: messageId });
  }

  private sendMessage(
    socket: WebSocket,
    event: OneBotEvent,
    message: OutgoingMessage,
    purpose = "reply",
    waitForResponse = false
  ): Promise<OneBotActionResponse | null> {
    const action = event.message_type === "group" ? "send_group_msg" : "send_private_msg";
    const params =
      event.message_type === "group"
        ? { group_id: event.group_id, message }
        : { user_id: event.user_id, message };
    return this.sendAction(socket, action, params, purpose, waitForResponse);
  }

  private sendAction(
    socket: WebSocket,
    action: string,
    params: Record<string, unknown>,
    purpose = "action",
    waitForResponse = false
  ): Promise<OneBotActionResponse | null> {
    const echo = `${purpose}-${Date.now()}-${this.actionSeq++}`;
    if (!waitForResponse) {
      socket.send(JSON.stringify({ action, params, echo }));
      return Promise.resolve(null);
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingActions.delete(echo);
        resolve(null);
      }, ACTION_RESPONSE_TIMEOUT_MS);
      this.pendingActions.set(echo, { timer, resolve });
      socket.send(JSON.stringify({ action, params, echo }), (error) => {
        if (!error) return;
        const pending = this.pendingActions.get(echo);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pendingActions.delete(echo);
        pending.resolve(null);
      });
    });
  }

  private resolveActionResponse(response: OneBotActionResponse): void {
    if (!response.echo) return;
    const pending = this.pendingActions.get(response.echo);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingActions.delete(response.echo);
    pending.resolve(response);
  }

  private authorized(request: FastifyRequest): boolean {
    const token = this.settings.runtime().onebot.accessToken;
    if (!token) return true;
    const query = request.query as Record<string, string | undefined>;
    const authorization = request.headers.authorization ?? "";
    return query.access_token === token || authorization === `Bearer ${token}`;
  }

  private shouldSendGeneratingNotice(event: OneBotEvent, mentionedBot: boolean): boolean {
    if (event.message_type === "private") return true;
    const runtime = this.settings.runtime();
    if (!runtime.naturalLanguage.groupNaturalEnabled) return false;
    if (runtime.naturalLanguage.requireMentionInGroup) return mentionedBot;
    return true;
  }
}

function extractContent(event: OneBotEvent): ExtractedContent {
  if (Array.isArray(event.message)) {
    return {
      text: event.message
        .filter((segment) => segment.type === "text")
        .map((segment) => String(segment.data?.text ?? ""))
        .join("")
        .trim(),
      images: event.message
        .filter((segment) => segment.type === "image")
        .map((segment) => ({
          url: segment.data?.url == null ? undefined : String(segment.data.url),
          file: segment.data?.file == null ? undefined : String(segment.data.file),
          summary: segment.data?.summary == null ? undefined : String(segment.data.summary)
        }))
    };
  }

  const raw = typeof event.message === "string" ? event.message : event.raw_message ?? "";
  return {
    text: raw.replace(/\[CQ:at,[^\]]+\]/g, "").replace(/\[CQ:image,[^\]]+\]/g, "").trim(),
    images: extractImagesFromCq(raw)
  };
}

function isMentioned(event: OneBotEvent, selfId: string | null): boolean {
  if (!selfId) return false;
  if (typeof event.raw_message === "string" && event.raw_message.includes(`[CQ:at,qq=${selfId}]`)) return true;
  if (!Array.isArray(event.message)) return false;
  return event.message.some((segment) => segment.type === "at" && String(segment.data?.qq) === selfId);
}

function isActionResponse(value: unknown): value is OneBotActionResponse {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.echo === "string" && ("retcode" in record || "status" in record || "data" in record);
}

function splitMessage(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length ? chunks : [text];
}

function extractImagesFromCq(raw: string): ExtractedContent["images"] {
  const images: ExtractedContent["images"] = [];
  const pattern = /\[CQ:image,([^\]]+)\]/g;
  for (const match of raw.matchAll(pattern)) {
    const data = parseCqData(match[1]);
    images.push({
      url: data.url,
      file: data.file,
      summary: data.summary
    });
  }
  return images;
}

function parseCqData(raw: string): Record<string, string> {
  const data: Record<string, string> = {};
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq);
    data[key] = decodeCqValue(part.slice(eq + 1));
  }
  return data;
}

function decodeCqValue(value: string): string {
  return value.replace(/&#44;/g, ",").replace(/&#91;/g, "[").replace(/&#93;/g, "]").replace(/&amp;/g, "&");
}
