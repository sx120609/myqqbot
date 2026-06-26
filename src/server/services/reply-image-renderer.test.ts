import { describe, expect, it } from "vitest";
import {
  __layoutKindsForTest,
  __splitReplyImageContentForTest,
  __wrapInlineTextForTest,
  markdownToPlainText,
  renderReplyImage
} from "./reply-image-renderer.js";

const IMAGE_RENDER_TIMEOUT_MS = 60_000;

describe("reply-image-renderer", () => {
  it("renders markdown reply text to a png image", () => {
    const image = renderReplyImage("## 模型信息\n我现在使用的是 **gpt-5.5**。\n\n- 支持自然语言提问\n- 可以查询高校生活资料");

    expect(image.mimeType).toBe("image/png");
    expect(image.bytes).toBeGreaterThan(1000);
    expect(Buffer.from(image.dataBase64, "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  }, IMAGE_RENDER_TIMEOUT_MS);

  it("renders with a longer configurable header badge", () => {
    const image = renderReplyImage("测试回复", {
      headerTitle: "Carbene的高校咨询助手",
      headerBadge: "由ChatGPT基于公开资料生成回复"
    });

    expect(image.mimeType).toBe("image/png");
    expect(image.bytes).toBeGreaterThan(1000);
  }, IMAGE_RENDER_TIMEOUT_MS);

  it("renders deeper markdown headings and dividers", () => {
    expect(__layoutKindsForTest("#### 食堂 共性是：\n\n- 能吃\n- 但整体评价中等\n\n---\n\n#### 校园环境\n图书馆评价不错"))
      .toEqual(expect.arrayContaining(["text", "rule"]));
    expect(markdownToPlainText("#### 食堂 共性是：\n---")).toBe("食堂 共性是：");
  });

  it("renders markdown admission tables as structured rows", () => {
    const markdown = [
      "中国药科大学 近三年河南录取情况",
      "",
      "年份 | 科类 | 批次 | 最低分 | 最低位次 | 计划数",
      "--- | --- | --- | --- | --- | ---",
      "2025 | 理科 | 本科一批 | 610 | 12000 | 20",
      "2024 | 理科 | 本科一批 | 604 | 14000 | 18"
    ].join("\n");

    expect(__layoutKindsForTest(markdown).filter((kind) => kind === "tableRow")).toHaveLength(3);
  });

  it("renders a local QR code for the source page", () => {
    const image = renderReplyImage("测试回复", {
      sourcePageUrl: "https://example.com/sources/source-token"
    });

    expect(image.mimeType).toBe("image/png");
    expect(image.bytes).toBeGreaterThan(2000);
  }, IMAGE_RENDER_TIMEOUT_MS);

  it("moves the source disclaimer into the image footer", () => {
    expect(__splitReplyImageContentForTest(
      "测试回复\n\n院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。"
    )).toEqual({
      body: "测试回复",
      footerNotice: "院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。"
    });
  });

  it("keeps common punctuation away from awkward line edges", () => {
    const cases = [
      { text: "共性优点：后面内容继续继续", width: 120 },
      { text: "最好别默认 “浙大全都有”", width: 180 },
      { text: "最好别默认 \"浙大全都有\"", width: 180 },
      { text: "最好别默认（浙大全都有）", width: 96 },
      { text: "可能会这样……但是还要看具体宿舍区", width: 150 },
      { text: "结论是——如果重视平台就优先考虑", width: 95 },
      { text: "211/双一流、保研率较高。", width: 50 }
    ];

    for (const item of cases) {
      const lines = __wrapInlineTextForTest(item.text, item.width);
      expect(lines.length, item.text).toBeGreaterThan(1);
      expect(lines.slice(1).some(startsWithForbiddenClosingPunctuation), item.text).toBe(false);
      expect(lines.slice(0, -1).some(endsWithForbiddenOpeningPunctuation), item.text).toBe(false);
    }

    const quoteLines = __wrapInlineTextForTest("最好别默认 “浙大全都有”", 180);
    expect(quoteLines[0]).toBe("最好别默认");
    expect(quoteLines[1].startsWith("“浙")).toBe(true);

    const asciiQuoteLines = __wrapInlineTextForTest("最好别默认 \"浙大全都有\"", 180);
    expect(asciiQuoteLines[0]).toBe("最好别默认");
    expect(asciiQuoteLines[1].startsWith("\"浙")).toBe(true);

    const colonLines = __wrapInlineTextForTest("共性优点：后面内容继续继续", 120);
    expect(colonLines[0]).toBe("共性优点：");
  });

  it("strips markdown syntax for plain-text fallback", () => {
    expect(markdownToPlainText("**你是什么模型**：后台配置为 `gpt-5.5`")).toBe("你是什么模型：后台配置为 gpt-5.5");
  });
});

function startsWithForbiddenClosingPunctuation(line: string): boolean {
  return /^[，。！？；：、,.!?;:%％‰℃°）)\]］｝}】〕〗〙〛〉》」』”’…—–－·/／]/.test(line);
}

function endsWithForbiddenOpeningPunctuation(line: string): boolean {
  return /[（(\[［｛{【〔〖〘〚〈《「『“‘]$/.test(line);
}
