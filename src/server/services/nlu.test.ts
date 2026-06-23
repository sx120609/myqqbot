import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../db.js";
import type { ParsedUniversity } from "../domain/parser.js";
import { NaturalLanguageService } from "./nlu.js";
import { UniversityRepository } from "./university-repository.js";

describe("NaturalLanguageService", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("matches default aliases and topic keywords", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const repo = new UniversityRepository(database);
    repo.importAll([fixtureUniversity("安徽大学", "an-hui-da-xue")]);

    const nlu = new NaturalLanguageService(repo);
    const analysis = nlu.analyze("安大宿舍怎么样");

    expect(analysis.isUniversityQuery).toBe(true);
    expect(analysis.topicKey).toBe("dorm");
    expect(analysis.candidates[0].name).toBe("安徽大学");
    database.close();
  });
});

function fixtureUniversity(name: string, slug: string): ParsedUniversity {
  return {
    name,
    slug,
    filePath: `docs/universities/${slug}.md`,
    sourceUrl: `https://example.test/${slug}.md`,
    rawMarkdown: "# fixture",
    questions: [
      {
        question: "宿舍是上床下桌吗？",
        topic: "dorm",
        position: 0,
        answers: [{ sourceId: "A1", respondent: null, answeredAt: null, text: "看校区和宿舍楼" }]
      }
    ]
  };
}

