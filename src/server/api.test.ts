import { describe, expect, it } from "vitest";
import { renderAnswerSourcePage } from "./api.js";
import type { AnswerSourceRecord } from "./services/answer-source-store.js";

describe("renderAnswerSourcePage", () => {
  it("renders admission source pages as traceable sections", () => {
    const html = renderAnswerSourcePage(
      sourceRecord({
        topic: "招生数据",
        contextText: [
          "查询条件：中国药科大学；省份：河南；科类：理科；专业：未指定",
          "当前日期：2026-06-25。历史分数默认使用 2023-2025。",
          "",
          "招生计划：",
          "年份 | 科类 | 批次/专业组 | 专业 | 计划数",
          "2026 | 理科 | 本科一批 | 药学类 | 20",
          "",
          "分数趋势摘要：",
          "最低位次区间：12000-16000",
          "",
          "录取分数/位次：",
          "年份 | 类型 | 科类 | 批次/专业组 | 专业 | 最低分 | 最低位次",
          "2025 | 院校线 | 理科 | 本科一批 | - | 610 | 12000",
          "",
          "资料页追溯：",
          "使用的数据表：admission_plans、admission_scores、admission_sources。",
          "掌上高考来源记录：101、102",
          "原始数据行摘要：year=2025, min=610, min_section=12000",
          "",
          "来源：掌上高考公开聚合数据；最终请以省考试院和学校招生网为准。"
        ].join("\n")
      }),
      "ICP备案号"
    );

    expect(html).toContain("<h2>查询条件与同步状态</h2>");
    expect(html).toContain("<h2>招生计划</h2>");
    expect(html).toContain("<h2>分数趋势摘要</h2>");
    expect(html).toContain("<h2>录取分数与最低位次</h2>");
    expect(html).toContain("<h2>资料页追溯</h2>");
    expect(html).toContain("<h2>来源提醒</h2>");
    expect(html).toContain("admission_plans、admission_scores、admission_sources");
    expect(html).toContain("year=2025, min=610, min_section=12000");
    expect(html).toContain("ICP备案号");
  });
});

function sourceRecord(overrides: Partial<AnswerSourceRecord>): AnswerSourceRecord {
  return {
    token: "source-token",
    question: "中国药科大学河南近三年分数线",
    universityId: 1,
    universityName: "中国药科大学",
    topic: "招生数据",
    sourceUrl: "https://www.gaokao.cn/school/114",
    contextText: "",
    schoolProfileText: null,
    srgaoxiaoReviewsText: null,
    answerText: "可以参考近三年位次。",
    createdAt: "2026-06-25T00:00:00.000Z",
    ...overrides
  };
}
