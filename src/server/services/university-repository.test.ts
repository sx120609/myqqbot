import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../db.js";
import type { ParsedUniversity } from "../domain/parser.js";
import { AdmissionRepository } from "./admission-repository.js";
import { UniversityRepository } from "./university-repository.js";

describe("UniversityRepository", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves university ids and dependent admission data across imports", () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-university-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);

    universities.importAll([fixtureUniversity("中国药科大学", "zhong-guo-yao-ke-da-xue", "# old")]);
    const [before] = universities.listUniversities("中国药科大学", 1);
    const admissions = new AdmissionRepository(database);
    admissions.upsertMapping({
      universityId: before.id,
      sourceSchoolId: "114",
      sourceSchoolName: "中国药科大学",
      payloadJson: "{}"
    });
    admissions.upsertPlan({
      universityId: before.id,
      sourceSchoolId: "114",
      year: 2026,
      provinceName: "江苏",
      subjectType: "物理类",
      batch: "本科批",
      majorName: "药学类",
      planCount: 20,
      rawJson: "{}"
    });

    universities.importAll([fixtureUniversity("中国药科大学", "zhong-guo-yao-ke-da-xue", "# updated")]);

    const [after] = universities.listUniversities("中国药科大学", 1);
    expect(after.id).toBe(before.id);
    expect(universities.getUniversity(after.id)?.raw_markdown).toBe("# updated");
    expect(admissions.getMapping(after.id)).toMatchObject({ sourceSchoolId: "114" });
    expect(admissions.queryPlans({ universityId: after.id }).map((row) => row.majorName)).toEqual(["药学类"]);

    database.close();
  });
});

function fixtureUniversity(name: string, slug: string, rawMarkdown: string): ParsedUniversity {
  return {
    name,
    slug,
    filePath: `docs/universities/${slug}.md`,
    sourceUrl: `https://example.test/${slug}.md`,
    rawMarkdown,
    questions: [
      {
        question: "宿舍怎么样？",
        topic: "宿舍",
        position: 1,
        answers: [
          {
            sourceId: "fixture",
            respondent: null,
            answeredAt: null,
            text: "还可以。"
          }
        ]
      }
    ]
  };
}
