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

  it("renders with a longer configurable header badge", () => {
    const image = renderReplyImage("测试回复", {
      headerTitle: "Carbene的高校咨询助手",
      headerBadge: "由ChatGPT基于公开资料生成回复"
    });

    expect(image.mimeType).toBe("image/png");
    expect(image.bytes).toBeGreaterThan(1000);
  });

  it("renders deeper markdown headings and dividers", () => {
    const image = renderReplyImage("#### 食堂 共性是：\n\n- 能吃\n- 但整体评价中等\n\n---\n\n#### 校园环境\n图书馆评价不错");

    expect(image.mimeType).toBe("image/png");
    expect(image.bytes).toBeGreaterThan(1000);
    expect(markdownToPlainText("#### 食堂 共性是：\n---")).toBe("食堂 共性是：");
  });

  it("renders a local QR code for the source page", () => {
    const image = renderReplyImage("测试回复", {
      sourcePageUrl: "https://example.com/sources/source-token"
    });

    expect(image.mimeType).toBe("image/png");
    expect(image.bytes).toBeGreaterThan(2000);
  });

  it("strips markdown syntax for plain-text fallback", () => {
    expect(markdownToPlainText("**你是什么模型**：后台配置为 `gpt-5.5`")).toBe("你是什么模型：后台配置为 gpt-5.5");
  });
});
