import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../db.js";
import { AdmissionRepository } from "./admission-repository.js";
import {
  JiangsuOfficialAdmissionAdapter,
  JIANGSU_EEA_SOURCE,
  parseJiangsuEeaRankText,
  parseJiangsuEeaScoreRows,
  parseJiangsuEeaScoreText
} from "./jiangsu-official-adapter.js";
import { UniversityRepository } from "./university-repository.js";

describe("JiangsuOfficialAdmissionAdapter", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses Jiangsu EEA score PDF text rows", () => {
    const rows = parseJiangsuEeaScoreText(`
      院校 代号 院校、专业组（再选科目要求） 投档最低分
      1101 南京大学03专业组(不限) 638 135 122 110
      1102 东南大学05专业组(化学) 632 130 120 108
    `);

    expect(rows).toEqual([
      expect.objectContaining({
        institutionCode: "1101",
        schoolName: "南京大学",
        planGroup: "03",
        requirement: "不限",
        minScore: 638
      }),
      expect.objectContaining({
        institutionCode: "1102",
        schoolName: "东南大学",
        planGroup: "05",
        requirement: "化学",
        minScore: 632
      })
    ]);
  });

  it("parses Jiangsu EEA rank table text rows with cumulative rank validation", () => {
    const rows = parseJiangsuEeaRankText(`
      分数段 同分人数 累计人数
      638 475 8837
      637 442 9279
      636 486 9765
      635 497 10262
    `);

    expect(rows).toEqual([
      expect.objectContaining({ score: 638, sameCount: 475, cumulative: 8837 }),
      expect.objectContaining({ score: 637, sameCount: 442, cumulative: 9279 }),
      expect.objectContaining({ score: 636, sameCount: 486, cumulative: 9765 }),
      expect.objectContaining({ score: 635, sameCount: 497, cumulative: 10262 })
    ]);
  });

  it("parses Jiangsu EEA score Excel rows", () => {
    const rows = parseJiangsuEeaScoreRows([
      ["院校代号", "院校、专业组（再选科目要求）", "投档最低分"],
      ["1101", "南京大学07专业组(不限)", "661"],
      ["1101", "南京大学08专业组(化学)", "658"],
      ["1102", "东南大学06专业组（化学）", "650"]
    ]);

    expect(rows).toEqual([
      expect.objectContaining({
        institutionCode: "1101",
        schoolName: "南京大学",
        planGroup: "07",
        requirement: "不限",
        minScore: 661
      }),
      expect.objectContaining({
        institutionCode: "1101",
        schoolName: "南京大学",
        planGroup: "08",
        requirement: "化学",
        minScore: 658
      }),
      expect.objectContaining({
        institutionCode: "1102",
        schoolName: "东南大学",
        planGroup: "06",
        requirement: "化学",
        minScore: 650
      })
    ]);
  });

  it("syncs official Jiangsu EEA score rows into admission scores", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-jiangsu-official-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([
      fixtureUniversity("南京大学", "nan-jing-da-xue"),
      fixtureUniversity("东南大学", "dong-nan-da-xue")
    ]);
    const admissions = new AdmissionRepository(database);
    const adapter = new JiangsuOfficialAdmissionAdapter(universities, admissions);

    const result = await adapter.sync({
      sources: [
        {
          year: 2025,
          subjectType: "物理类",
          batch: "本科批",
          title: "江苏省2025年普通高校招生普通类本科批次平行志愿投档线（物理等科目类）",
          pdfUrl: "https://www.jseea.cn/official.pdf",
          rank: {
            pageUrl: "https://www.jseea.cn/rank.html",
            imageUrl: "https://www.jseea.cn/rank.jpg",
            text: `
              638 475 8837
              637 442 9279
              632 521 11769
              631 551 12320
            `
          },
          text: `
            1101 南京大学03专业组(不限) 638 135 122 110
            1102 东南大学05专业组(化学) 632 130 120 108
            9999 不存在大学01专业组(不限) 500 90 80 70
          `
        }
      ]
    });

    expect(result).toMatchObject({
      source: JIANGSU_EEA_SOURCE,
      total: 3,
      mapped: 2,
      scoreRows: 2,
      sourceRows: 2,
      skipped: 1,
      errors: []
    });
    expect(admissions.getMapping(universities.listUniversities("南京大学", 1)[0].id, JIANGSU_EEA_SOURCE)).toMatchObject({
      sourceSchoolId: "1101",
      sourceSchoolName: "南京大学"
    });
    expect(admissions.queryScores({ provinceName: "江苏", subjectType: "物理类", years: [2025] })).toEqual([
      expect.objectContaining({
        sourceSchoolId: "1101",
        universityName: "南京大学",
        source: JIANGSU_EEA_SOURCE,
        year: 2025,
        provinceName: "江苏",
        subjectType: "物理类",
        batch: "本科批",
        planGroup: "03",
        minScore: 638,
        minRank: 8837,
        selectionRequirements: "不限"
      }),
      expect.objectContaining({
        sourceSchoolId: "1102",
        universityName: "东南大学",
        source: JIANGSU_EEA_SOURCE,
        planGroup: "05",
        minScore: 632,
        minRank: 11769,
        selectionRequirements: "化学"
      })
    ]);
    expect(admissions.listSources({ sourceKind: "jiangsu-eea-score-pdf" })).toEqual([
      expect.objectContaining({
        source: JIANGSU_EEA_SOURCE,
        sourceKind: "jiangsu-eea-score-pdf",
        status: "success",
        sourceUrl: "https://www.jseea.cn/official.pdf",
        responseJson: expect.stringContaining("\"rankRowCount\":4")
      })
    ]);
    expect(admissions.listSources({ sourceKind: "jiangsu-eea-rank-image" })).toEqual([
      expect.objectContaining({
        source: JIANGSU_EEA_SOURCE,
        sourceKind: "jiangsu-eea-rank-image",
        status: "success",
        sourceUrl: "https://www.jseea.cn/rank.jpg",
        responseJson: expect.stringContaining("\"rowCount\":4")
      })
    ]);

    database.close();
  });
});

function fixtureUniversity(name: string, slug: string) {
  return {
    name,
    slug,
    filePath: `docs/universities/${slug}.md`,
    sourceUrl: `https://example.com/${slug}.md`,
    rawMarkdown: `# ${name}\n`,
    questions: []
  };
}
