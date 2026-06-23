import { describe, expect, it } from "vitest";
import { markdownToPlainText, renderReplyImage } from "./reply-image-renderer.js";

describe("reply-image-renderer", () => {
  it("renders markdown reply text to a png image", () => {
    const image = renderReplyImage("## 模型信息\n我现在使用的是 **gpt-5.5**。\n\n- 支持自然语言提问\n- 可以查询高校生活资料");

    expect(image.mimeType).toBe("image/png");
    expect(image.bytes).toBeGreaterThan(1000);
    expect(Buffer.from(image.dataBase64, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("renders with configurable header text", () => {
    const image = renderReplyImage("测试回复", {
      headerTitle: "自定义助手名",
      headerBadge: "自定义角标"
    });

    expect(image.mimeType).toBe("image/png");
    expect(image.bytes).toBeGreaterThan(1000);
  });

  it("strips markdown syntax for plain-text fallback", () => {
    expect(markdownToPlainText("**你是什么模型**：后台配置为 `gpt-5.5`")).toBe("你是什么模型：后台配置为 gpt-5.5");
  });
});
