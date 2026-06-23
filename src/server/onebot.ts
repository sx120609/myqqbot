import type { FastifyInstance, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import type { SettingsStore } from "./settings.js";
import type { MessageProcessor } from "./services/message-processor.js";

interface OneBotEvent {
  post_type?: string;
  message_type?: "private" | "group";
  user_id?: number | string;
  group_id?: number | string;
  self_id?: number | string;
  raw_message?: string;
  message?: string | Array<{ type: string; data?: Record<string, string | number> }>;
}

export class OneBotGateway {
  private sockets = new Set<WebSocket>();
  private connectedAt: string | null = null;
  private lastEventAt: string | null = null;
  private selfId: string | null = null;

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
    let event: OneBotEvent;
    try {
      event = JSON.parse(raw) as OneBotEvent;
    } catch {
      return;
    }

    if (event.self_id) this.selfId = String(event.self_id);
    this.lastEventAt = new Date().toISOString();
    if (event.post_type !== "message" || !event.message_type || !event.user_id) return;

    const text = extractText(event);
    if (!text.trim()) return;

    const mentionedBot = isMentioned(event, this.selfId);
    const conversationKey =
      event.message_type === "group" ? `group:${event.group_id}:user:${event.user_id}` : `private:${event.user_id}`;

    const result = await this.processor.process({
      platform: "onebot",
      text,
      messageType: event.message_type,
      userId: String(event.user_id),
      groupId: event.group_id == null ? undefined : String(event.group_id),
      conversationKey,
      mentionedBot
    });

    if (result.handled && result.reply) {
      this.sendReply(socket, event, result.reply);
    }
  }

  private sendReply(socket: WebSocket, event: OneBotEvent, reply: string): void {
    const chunks = splitMessage(reply, 850);
    chunks.forEach((message, index) => {
      const action = event.message_type === "group" ? "send_group_msg" : "send_private_msg";
      const params =
        event.message_type === "group"
          ? { group_id: event.group_id, message }
          : { user_id: event.user_id, message };
      socket.send(
        JSON.stringify({
          action,
          params,
          echo: `reply-${Date.now()}-${index}`
        })
      );
    });
  }

  private authorized(request: FastifyRequest): boolean {
    const token = this.settings.runtime().onebot.accessToken;
    if (!token) return true;
    const query = request.query as Record<string, string | undefined>;
    const authorization = request.headers.authorization ?? "";
    return query.access_token === token || authorization === `Bearer ${token}`;
  }
}

function extractText(event: OneBotEvent): string {
  if (event.raw_message) return event.raw_message.replace(/\[CQ:at,[^\]]+\]/g, "").trim();
  if (typeof event.message === "string") return event.message.replace(/\[CQ:at,[^\]]+\]/g, "").trim();
  if (!Array.isArray(event.message)) return "";
  return event.message
    .filter((segment) => segment.type === "text")
    .map((segment) => String(segment.data?.text ?? ""))
    .join("")
    .trim();
}

function isMentioned(event: OneBotEvent, selfId: string | null): boolean {
  if (!selfId) return false;
  if (typeof event.raw_message === "string" && event.raw_message.includes(`[CQ:at,qq=${selfId}]`)) return true;
  if (!Array.isArray(event.message)) return false;
  return event.message.some((segment) => segment.type === "at" && String(segment.data?.qq) === selfId);
}

function splitMessage(text: string, size: number): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks.length ? chunks : [text];
}
