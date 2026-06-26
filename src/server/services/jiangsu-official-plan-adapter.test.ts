import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AppDatabase } from "../db.js";
import { AdmissionRepository } from "./admission-repository.js";
import { JiangsuOfficialPlanAdapter, JIANGSU_SCHOOL_OFFICIAL_SOURCE, parseJiangsuOfficialPlanHtml, parseNjustOfficialPlanJson } from "./jiangsu-official-plan-adapter.js";
import { UniversityRepository } from "./university-repository.js";

describe("JiangsuOfficialPlanAdapter", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses official Jiangsu university plan HTML table rows", () => {
    const records = parseJiangsuOfficialPlanHtml(`
      <table>
        <tr>
          <th>计划性质(类别)</th><th>科类</th><th>专业组/选科</th>
          <th>专业名称</th><th>学制</th><th>计划数</th><th>批次</th>
        </tr>
        <tr>
          <td>普通类</td><td>历史类</td><td>08专业组(历史+不限)</td>
          <td><a href="zyview.aspx?id=1">法学</a><b>含涉外法治方向。</b></td><td>4</td><td>73</td><td>普通类本科</td>
        </tr>
        <tr>
          <td>普通类</td><td>物理类</td><td>20专业组(物理+不限)</td>
          <td><a href="zyview.aspx?id=2">网络与新媒体</a></td><td>4</td><td>2</td><td>普通类提前录取本科</td>
        </tr>
      </table>
    `);

    expect(records).toEqual([
      expect.objectContaining({
        category: "普通类",
        subjectType: "历史类",
        planGroup: "08",
        selectionRequirements: "历史+不限",
        majorName: "法学",
        duration: "4",
        planCount: 73,
        batch: "普通类本科"
      }),
      expect.objectContaining({
        subjectType: "物理类",
        planGroup: "20",
        selectionRequirements: "物理+不限",
        majorName: "网络与新媒体",
        planCount: 2,
        batch: "普通类提前录取本科"
      })
    ]);
  });

  it("parses grouped official Jiangsu university plan table rows", () => {
    const records = parseJiangsuOfficialPlanHtml(`
      <p><strong>历史类（普通本科批）</strong></p>
      <table>
        <tr>
          <th>代号</th><th>院校、专业组（再选科目要求）及专业名称</th><th>计划</th><th>2025录取线</th>
        </tr>
        <tr><td>140101</td><td>江苏大学01专业组（不限）</td><td>637</td><td></td></tr>
        <tr><td>01</td><td>汉语国际教育</td><td>33</td><td>572</td></tr>
        <tr><td>02</td><td>工商管理</td><td>38</td><td>573</td></tr>
      </table>
    `);

    expect(records).toEqual([
      expect.objectContaining({
        subjectType: "历史类",
        batch: "普通本科批",
        planGroup: "01",
        selectionRequirements: "不限",
        majorName: null,
        schoolPlanCount: 637
      }),
      expect.objectContaining({
        subjectType: "历史类",
        batch: "普通本科批",
        planGroup: "01",
        majorName: "汉语国际教育",
        planCount: 33
      }),
      expect.objectContaining({
        subjectType: "历史类",
        batch: "普通本科批",
        planGroup: "01",
        majorName: "工商管理",
        planCount: 38
      })
    ]);
  });

  it("updates grouped plan context when headings are split by HTML tags", () => {
    const records = parseJiangsuOfficialPlanHtml(`
      <p><strong>历史类（普通本科批）</strong></p>
      <table>
        <tr><th>代号</th><th>院校、专业组（再选科目要求）及专业名称</th><th>计划</th></tr>
        <tr><td>140101</td><td>江苏大学01专业组（不限）</td><td>637</td></tr>
        <tr><td>01</td><td>汉语国际教育</td><td>33</td></tr>
      </table>
      <p><strong>物理类<strong><span>（普通本科批）</span></strong></strong></p>
      <table>
        <tr><th>代号</th><th>院校、专业组（再选科目要求）及专业名称</th><th>计划</th></tr>
        <tr><td>140115</td><td>江苏大学15专业组（化学）</td><td>30</td></tr>
        <tr><td>42</td><td>计算机科学与技术</td><td>30</td></tr>
      </table>
    `);

    expect(records).toEqual([
      expect.objectContaining({ subjectType: "历史类", batch: "普通本科批", planGroup: "01", majorName: null, schoolPlanCount: 637 }),
      expect.objectContaining({ subjectType: "历史类", batch: "普通本科批", planGroup: "01", majorName: "汉语国际教育", planCount: 33 }),
      expect.objectContaining({ subjectType: "物理类", batch: "普通本科批", planGroup: "15", majorName: null, schoolPlanCount: 30 }),
      expect.objectContaining({ subjectType: "物理类", batch: "普通本科批", planGroup: "15", majorName: "计算机科学与技术", planCount: 30 })
    ]);
  });

  it("parses Nanjing University of Science and Technology official JSON plan rows", () => {
    const records = parseNjustOfficialPlanJson({
      total: 2,
      data: {
        list: [
          {
            province: "江苏",
            year: "2026",
            professional_name: "法学",
            subject: "历史",
            pain_num: "30",
            tuition: "5200(元/年)",
            class_name: "本科一批"
          },
          {
            province: "江苏",
            year: "2026",
            professional_name: "计算机类(钱学森学院大成创新人才班)(计算机科学与技术、软件工程)",
            subject: "物理+化学",
            pain_num: "20",
            tuition: "6380(元/年)",
            class_name: "本科一批"
          }
        ]
      }
    });

    expect(records).toEqual([
      expect.objectContaining({
        category: "本科一批",
        subjectType: "历史类",
        selectionRequirements: "历史",
        majorName: "法学",
        planCount: 30,
        tuition: "5200(元/年)",
        batch: "本科一批"
      }),
      expect.objectContaining({
        category: "本科一批",
        subjectType: "物理类",
        selectionRequirements: "物理+化学",
        majorName: "计算机类(钱学森学院大成创新人才班)(计算机科学与技术、软件工程)",
        planCount: 20,
        tuition: "6380(元/年)",
        batch: "本科一批"
      })
    ]);
  });

  it("syncs official Jiangsu university plan rows into admission plans", async () => {
    const dir = mkdtempSync(join(tmpdir(), "myqqbot-jiangsu-plan-test-"));
    tempDirs.push(dir);
    const database = new AppDatabase(join(dir, "test.sqlite"));
    const universities = new UniversityRepository(database);
    universities.importAll([
      {
        name: "苏州大学",
        slug: "su-zhou-da-xue",
        filePath: "docs/universities/su-zhou-da-xue.md",
        sourceUrl: "https://example.com/suda.md",
        rawMarkdown: "# 苏州大学\n",
        questions: []
      }
    ]);
    const admissions = new AdmissionRepository(database);
    const adapter = new JiangsuOfficialPlanAdapter(universities, admissions);

    const result = await adapter.sync({
      sources: [
        {
          schoolName: "苏州大学",
          sourceSchoolId: "suda",
          year: 2026,
          provinceName: "江苏",
          url: "https://zsb.suda.edu.cn/search_plan.aspx?nf=2026&sf=%E6%B1%9F%E8%8B%8F&province=%E6%B1%9F%E8%8B%8F",
          records: [
            {
              category: "普通类",
              subjectType: "历史类",
              planGroup: "08",
              selectionRequirements: "历史+不限",
              majorName: "法学",
              duration: "4",
              planCount: 73,
              batch: "普通类本科",
              rawCells: ["普通类", "历史类", "08专业组(历史+不限)", "法学", "4", "73", "普通类本科"]
            }
          ]
        }
      ]
    });

    expect(result).toMatchObject({
      source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
      total: 1,
      mapped: 1,
      planRows: 1,
      sourceRows: 1,
      skipped: 0,
      errors: []
    });
    expect(admissions.queryPlans({ provinceName: "江苏", subjectType: "历史类", years: [2026] })).toEqual([
      expect.objectContaining({
        source: JIANGSU_SCHOOL_OFFICIAL_SOURCE,
        universityName: "苏州大学",
        sourceSchoolId: "suda",
        year: 2026,
        provinceName: "江苏",
        subjectType: "历史类",
        batch: "普通类本科",
        planGroup: "08",
        majorName: "法学",
        planCount: 73,
        duration: "4",
        selectionRequirements: "历史+不限"
      })
    ]);

    database.close();
  });
});
