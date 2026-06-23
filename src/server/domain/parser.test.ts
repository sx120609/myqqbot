import { describe, expect, it } from "vitest";
import { parseUniversityMarkdown } from "./parser.js";

describe("parseUniversityMarkdown", () => {
  it("parses title, source metadata, questions, and answers", () => {
    const parsed = parseUniversityMarkdown(
      "docs/universities/an-hui-da-xue.md",
      "https://example.test/an-hui-da-xue.md",
      `# 安徽大学

> 数据来源：

<details><summary>点击展开</summary>
<ul>
<li>A17312: 匿名 (2023 年 05 月)</li>
</ul>
</details>

## Q: 宿舍是上床下桌吗？

- A17312: 是，看宿舍楼

## Q: 校园网怎么样？

- A17312: 还可以
`
    );

    expect(parsed?.name).toBe("安徽大学");
    expect(parsed?.slug).toBe("an-hui-da-xue");
    expect(parsed?.questions).toHaveLength(2);
    expect(parsed?.questions[0].topic).toBe("dorm");
    expect(parsed?.questions[0].answers[0]).toMatchObject({
      sourceId: "A17312",
      respondent: "匿名",
      answeredAt: "2023-05",
      text: "是，看宿舍楼"
    });
  });
});

