import type { WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SettingsStore } from "./settings.js";
import type { MessageProcessor } from "./services/message-processor.js";
import { OneBotGateway } from "./onebot.js";

describe("OneBotGateway", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends a generating notice immediately and deletes it after the final reply", async () => {
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

    expect(sent).toHaveLength(1);
    expect(sent[0].action).toBe("send_private_msg");
    expect(sent[0].params.message).toBe("正在生成回答中，请稍等。内容较长时可能需要更多时间。");

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

  it("still sends and retracts the generating notice for quick replies", async () => {
    vi.useFakeTimers();
    const processor = {
      process: vi.fn().mockResolvedValue({ handled: true, reply: "很快的回复", reason: "ok" })
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
        message: "你好"
      })
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].params.message).toBe("正在生成回答中，请稍等。内容较长时可能需要更多时间。");
    await callHandleMessage(
      gateway,
      socket,
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: { message_id: 789 },
        echo: sent[0].echo
      })
    );
    await task;

    expect(sent).toHaveLength(3);
    expect(sent[1].params.message).toBe("很快的回复");
    expect(sent[2]).toMatchObject({
      action: "delete_msg",
      params: { message_id: 789 }
    });
  });

  it("automatically approves friend requests without setting a remark", async () => {
    const processor = {
      process: vi.fn()
    } as unknown as MessageProcessor;
    const gateway = new OneBotGateway(settings(), processor);
    const sent: Array<{ action: string; params: Record<string, unknown>; echo: string }> = [];
    const socket = fakeSocket(sent);

    await callHandleMessage(
      gateway,
      socket,
      JSON.stringify({
        post_type: "request",
        request_type: "friend",
        user_id: 10001,
        flag: "friend-request-flag",
        comment: "你好"
      })
    );

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      action: "set_friend_add_request",
      params: {
        flag: "friend-request-flag",
        approve: true
      }
    });
    expect(sent[0].params).not.toHaveProperty("remark");
    expect(processor.process).not.toHaveBeenCalled();
  });

  it("polls and approves doubtful friend requests", async () => {
    const processor = {
      process: vi.fn()
    } as unknown as MessageProcessor;
    const gateway = new OneBotGateway(settings(), processor);
    const sent: Array<{ action: string; params: Record<string, unknown>; echo: string }> = [];
    const socket = fakeSocket(sent);
    addSocket(gateway, socket);

    const task = callApproveDoubtFriendRequests(gateway);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      action: "get_doubt_friends_add_request",
      params: { count: 20 }
    });

    await callHandleMessage(
      gateway,
      socket,
      JSON.stringify({
        status: "ok",
        retcode: 0,
        data: {
          list: [{ flag: "doubt-1" }, { flag: "doubt-2" }]
        },
        echo: sent[0].echo
      })
    );
    await task;

    expect(sent).toHaveLength(3);
    expect(sent[1]).toMatchObject({
      action: "set_doubt_friends_add_request",
      params: { flag: "doubt-1", approve: true }
    });
    expect(sent[2]).toMatchObject({
      action: "set_doubt_friends_add_request",
      params: { flag: "doubt-2", approve: true }
    });
  });
});

function settings(): SettingsStore {
  return {
    runtime: () => ({
      onebot: {
        accessToken: "",
        replyEnabled: true,
        replyAsImage: false
      },
      naturalLanguage: {
        groupNaturalEnabled: true,
        requireMentionInGroup: false,
        confidenceThreshold: 0.55,
        contextTtlMinutes: 10,
        cooldownSeconds: 5
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

function addSocket(gateway: OneBotGateway, socket: WebSocket): void {
  (gateway as unknown as { sockets: Set<WebSocket> }).sockets.add(socket);
}

function callApproveDoubtFriendRequests(gateway: OneBotGateway): Promise<void> {
  return (gateway as unknown as { approveDoubtFriendRequests: () => Promise<void> }).approveDoubtFriendRequests();
}
