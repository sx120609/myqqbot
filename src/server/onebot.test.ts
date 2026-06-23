import type { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsStore } from "./settings.js";
import type { MessageProcessor } from "./services/message-processor.js";
import { OneBotGateway } from "./onebot.js";

describe("OneBotGateway", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a generating notice after 10s and deletes it after the final reply", async () => {
    vi.useFakeTimers();
    let finishProcessing!: (value: { handled: boolean; reply: string; reason: string }) => void;
    const processor = {
      process: vi.fn(
        () =>
          new Promise((resolve) => {
            finishProcessing = resolve;
          })
      )
    } as unknown as MessageProcessor;
    const gateway = new OneBotGateway(settings(), processor);
    const sent: Array<{ action: string; params: Record<string, unknown>; echo: string }> = [];
    const socket = fakeSocket(sent);

    const task = callHandleMessage(
      gateway,
      socket,
      JSON.stringify({
        post_type: "message",
        message_type: "private",
        user_id: 10001,
        message: "评价中国药科大学"
      })
    );

    await vi.advanceTimersByTimeAsync(9999);
    expect(sent).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].action).toBe("send_private_msg");
    expect(sent[0].params.message).toBe("回复仍在生成中，请稍等。");

    await callHandleMessage(
      gateway,
      socket,
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: { message_id: 456 },
        echo: sent[0].echo
      })
    );

    finishProcessing({ handled: true, reply: "**最终回复**", reason: "ok" });
    await task;

    expect(sent).toHaveLength(3);
    expect(sent[1].action).toBe("send_private_msg");
    expect(sent[1].params.message).toBe("最终回复");
    expect(sent[2]).toMatchObject({
      action: "delete_msg",
      params: { message_id: 456 }
    });
  });

  it("does not send a generating notice for quick replies", async () => {
    vi.useFakeTimers();
    const processor = {
      process: vi.fn().mockResolvedValue({ handled: true, reply: "很快的回复", reason: "ok" })
    } as unknown as MessageProcessor;
    const gateway = new OneBotGateway(settings(), processor);
    const sent: Array<{ action: string; params: Record<string, unknown>; echo: string }> = [];
    const socket = fakeSocket(sent);

    await callHandleMessage(
      gateway,
      socket,
      JSON.stringify({
        post_type: "message",
        message_type: "private",
        user_id: 10001,
        message: "你好"
      })
    );
    await vi.advanceTimersByTimeAsync(10_000);

    expect(sent).toHaveLength(1);
    expect(sent[0].params.message).toBe("很快的回复");
  });
});

function settings(): SettingsStore {
  return {
    runtime: () => ({
      onebot: {
        accessToken: "",
        replyEnabled: true,
        replyAsImage: false
      }
    })
  } as SettingsStore;
}

function fakeSocket(sent: Array<{ action: string; params: Record<string, unknown>; echo: string }>): WebSocket {
  return {
    send: vi.fn((raw: string, callback?: (error?: Error) => void) => {
      sent.push(JSON.parse(raw) as { action: string; params: Record<string, unknown>; echo: string });
      callback?.();
    })
  } as unknown as WebSocket;
}

function callHandleMessage(gateway: OneBotGateway, socket: WebSocket, raw: string): Promise<void> {
  return (gateway as unknown as { handleMessage: (socket: WebSocket, raw: string) => Promise<void> }).handleMessage(socket, raw);
}
