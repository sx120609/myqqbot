import { describe, expect, it, vi } from "vitest";
import { MessageProcessor } from "./message-processor.js";
import type { AnswerSourceStore } from "./answer-source-store.js";
import type { LlmClient } from "./llm-client.js";
import type { LogStore } from "./log-store.js";
import type { NaturalLanguageService } from "./nlu.js";
import type { SrgaoxiaoSyncService } from "./srgaoxiao-sync.js";
import type { SettingsStore } from "../settings.js";
import type { UniversityRepository } from "./university-repository.js";

describe("MessageProcessor", () => {
  it("uses the LLM route for private casual messages before local handling", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "http://127.0.0.1:8787",
          filingNumber: ""
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 900,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [],
        reason: "没有本地学校候选"
      }))
    } as unknown as NaturalLanguageService;
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("casual"))
        .mockResolvedValueOnce("后台配置的模型是 gpt-5.5。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;

    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn(() => university) } as unknown as UniversityRepository,
      nlu,
      llm,
      logs
    );

    const result = await processor.process({
      platform: "debug",
      text: "你是什么模型",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toBe("后台配置的模型是 gpt-5.5。");
    expect(result.reason).toBe("模型判断为普通对话");
    expect(vi.mocked(llm.chat).mock.calls[0][1]).toBe("message-route");
    expect(vi.mocked(llm.chat).mock.calls[1][1]).toBe("casual-message");
    expect(nlu.analyze).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0])).not.toContain("学校候选提示");
  });

  it("blocks admission questions when the product is scoped to university life info", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "http://127.0.0.1:8787",
          filingNumber: ""
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 900,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: false
        }
      })
    } as SettingsStore;
    const nlu = {
      analyze: vi.fn()
    } as unknown as NaturalLanguageService;
    const llm = {
      chat: vi.fn().mockResolvedValueOnce(routeJson("admission", {
        schoolNames: ["南京大学"],
        province: "江苏",
        subjectType: "物理类",
        queryTypes: ["score", "rank"]
      }))
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;

    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn() } as unknown as UniversityRepository,
      nlu,
      llm,
      logs
    );

    const result = await processor.process({
      platform: "debug",
      text: "南京大学江苏物理类多少位能上",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生问答已关闭");
    expect(result.reply).toContain("后台现在关闭了招生问答");
    expect(nlu.analyze).not.toHaveBeenCalled();
    expect(vi.mocked(llm.chat)).toHaveBeenCalledTimes(1);
  });

  it("turns a score-only admission question into rank-aware general advice", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "http://127.0.0.1:8787",
          filingNumber: ""
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [],
        reason: "没有本地学校候选"
      }))
    } as unknown as NaturalLanguageService;
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          majorName: "计算机",
          queryTypes: ["rank", "plan"]
        }))
        .mockResolvedValueOnce("江苏物理类 630 分先按 9031 位左右看，计算机要按位次分层冲稳保。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const admissions = {
      lookupRankByScore: vi.fn(() => ({
        year: 2026,
        provinceName: "江苏",
        subjectType: "物理类",
        score: 630,
        sameCount: 32,
        cumulative: 9031,
        sourceId: 12,
        sourceUrl: "https://www.jseea.cn/example-rank.png",
        fetchedAt: "2026-06-25T00:00:00.000Z",
        rawLine: "630 32 9031"
      }))
    };
    const answerSources = {
      create: vi.fn(() => "source-token")
    } as unknown as AnswerSourceStore;
    const processor = new MessageProcessor(
      settings,
      {} as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      answerSources,
      admissions as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "江苏物化地 630分 计算机怎么报",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生泛报考回答");
    expect(result.reply).toContain("9031");
    expect(result.sourcePageUrl).toBe("http://127.0.0.1:8787/sources/source-token");
    expect(admissions.lookupRankByScore).toHaveBeenCalledWith(expect.objectContaining({
      provinceName: "江苏",
      subjectType: "物理类",
      score: 630,
      years: expect.arrayContaining([2026])
    }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("泛报考查询");
    expect(prompt).toContain("省份：江苏");
    expect(prompt).toContain("科类：物理类");
    expect(prompt).toContain("分数 630");
    expect(prompt).toContain("折算/提供位次 9031");
    expect(prompt).toContain("不要让用户自己查位次");
    expect(prompt).toContain("不要反问学校名来中断回答");
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      universityId: null,
      universityName: "江苏物理类报考建议",
      sourceUrl: "https://www.jseea.cn/example-rank.png",
      contextText: expect.stringContaining("折算/提供位次 9031")
    }));
  });

  it("falls back to local school candidates when the LLM route omits school names", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 900,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const localCandidate = {
      id: 88,
      name: "南京师范大学",
      slug: "nan-jing-shi-fan-da-xue",
      file_path: "docs/universities/nan-jing-shi-fan-da-xue.md",
      source_url: "https://example.com/njnu.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南师大",
      score: 0.9
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [localCandidate],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("university_info", {
          topicKey: "general",
          topicLabel: "整体评价"
        }))
        .mockResolvedValueOnce("南师大整体不错。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const universities = {
      getTopicQuestions: vi.fn(() => []),
      getSchoolProfile: vi.fn(() => null)
    } as unknown as UniversityRepository;
    const processor = new MessageProcessor(settings, universities, nlu, llm, logs);

    const result = await processor.process({
      platform: "debug",
      text: "南师大你觉得怎么样",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("模型判断为高校资料回答");
    expect(result.reply).toContain("南师大整体不错。");
    expect(nlu.analyze).toHaveBeenCalledWith("南师大你觉得怎么样", undefined);
    expect(vi.mocked(llm.chat)).toHaveBeenCalledTimes(2);
  });

  it("uses the LLM with a data-gap note when no questionnaire snippets are retrieved", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 1,
      name: "中国药科大学",
      slug: "zhong-guo-yao-ke-da-xue",
      file_path: "docs/universities/zhong-guo-yao-ke-da-xue.md",
      source_url: "https://example.com/university.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "name",
      score: 0.9
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      })),
      buildRetrievalContext: vi.fn()
    } as unknown as NaturalLanguageService;
    const universities = {
      getTopicQuestions: vi.fn(() => []),
      getSchoolProfile: vi.fn(() => ({
        universityId: 1,
        source: "srgaoxiao",
        sourceSchoolId: "114",
        sourceUrl: "https://srgaoxiao.cn/school/%E4%B8%AD%E5%9B%BD%E8%8D%AF%E7%A7%91%E5%A4%A7%E5%AD%A6",
        payloadJson: "{}",
        profileText: "来源：神人高校网\n学校：中国药科大学\n定位：医药类；江苏省；南京市\n标签：211；双一流\n建校/占地：1936 年建校；占地约 2100 亩",
        updatedAt: "2026-06-24T00:00:00.000Z"
      }))
    } as unknown as UniversityRepository;
    const llm = {
      chat: vi.fn().mockResolvedValue("问卷里没查到这一项，可以先按常见情况判断。\n\n数据来自 CollegesChat 问卷，常识建议仅供参考。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const srgaoxiao = {
      fetchLiveReviewContext: vi.fn().mockResolvedValue("来源：神人高校网实时评论\n1. 宿舍四人寝，食堂一般。")
    } as unknown as SrgaoxiaoSyncService;
    const llmAnswer = "问卷里没查到这一项，可以先按常见情况判断。\n\n数据来自 CollegesChat 问卷，常识建议仅供参考。";
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(routeJson("university_info", {
        schoolNames: ["中国药科大学"],
        topicKey: "general",
        topicLabel: "整体评价"
      }))
      .mockResolvedValueOnce(llmAnswer);

    const processor = new MessageProcessor(settings, universities, nlu, llm, logs, srgaoxiao);

    const result = await processor.process({
      platform: "debug",
      text: "评价中国药科大学",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("模型判断为高校资料回答");
    expect(vi.mocked(llm.chat).mock.calls[0][1]).toBe("message-route");
    expect(vi.mocked(llm.chat).mock.calls[1][1]).toBe("university-answer");
    expect(JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0])).toContain("这次没有检索到 中国药科大学");
    expect(JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0])).toContain("外部院校画像补充资料");
    expect(JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0])).toContain("占地约 2100 亩");
    expect(JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0])).toContain("神人高校网实时评论");
    expect(srgaoxiao.fetchLiveReviewContext).toHaveBeenCalledWith(1, 6);
    expect(String(vi.mocked(llm.chat).mock.calls[1][0][0].content)).toContain("院校定位");
  });

  it("uses the LLM route for multi-school comparison instead of local comparison keywords", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "https://bot.example.com",
          filingNumber: ""
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const pku = {
      id: 1,
      name: "北京大学",
      slug: "bei-jing-da-xue",
      file_path: "docs/universities/bei-jing-da-xue.md",
      source_url: "https://example.com/pku.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "北京大学",
      score: 0.75
    };
    const thu = {
      id: 2,
      name: "清华大学",
      slug: "qing-hua-da-xue",
      file_path: "docs/universities/qing-hua-da-xue.md",
      source_url: "https://example.com/thu.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "清华大学",
      score: 0.75
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [pku, thu],
        reason: "本地学校候选，仅供模型路由参考"
      })),
      buildRetrievalContext: vi.fn((name: string) => `学校：${name}\n问卷片段`)
    } as unknown as NaturalLanguageService;
    const universities = {
      getTopicQuestions: vi.fn((id: number) => [
        {
          id,
          question: id === 1 ? "北京大学生活体验怎么样" : "清华大学生活体验怎么样",
          topic: "general",
          position: 1,
          answers: []
        }
      ]),
      getSchoolProfile: vi.fn((id: number) => ({
        universityId: id,
        source: "srgaoxiao",
        sourceSchoolId: String(id),
        sourceUrl: `https://srgaoxiao.cn/school/${id}`,
        payloadJson: "{}",
        profileText: id === 1 ? "北京大学画像资料" : "清华大学画像资料",
        updatedAt: "2026-06-24T00:00:00.000Z"
      }))
    } as unknown as UniversityRepository;
    const llm = {
      chat: vi.fn().mockResolvedValue("如果按综合学术氛围二选一，要看专业方向。\n\n院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const srgaoxiao = {
      fetchLiveReviewContext: vi.fn((id: number) => Promise.resolve(id === 1 ? "北京大学评论资料" : "清华大学评论资料"))
    } as unknown as SrgaoxiaoSyncService;
    const answerSources = {
      create: vi.fn(() => "comparison-source")
    } as unknown as AnswerSourceStore;
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(routeJson("university_info", {
        schoolNames: ["北京大学", "清华大学"],
        queryTypes: ["compare"],
        topicKey: "general",
        topicLabel: "整体评价"
      }))
      .mockResolvedValueOnce("如果按综合学术氛围二选一，要看专业方向。\n\n院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。");
    const processor = new MessageProcessor(settings, universities, nlu, llm, logs, srgaoxiao, answerSources);

    const result = await processor.process({
      platform: "debug",
      text: "北京大学 清华大学",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("多校对比回答");
    expect(result.reply).not.toContain("我找到了几个可能的学校");
    expect(result.sourcePageUrl).toBe("https://bot.example.com/sources/comparison-source");
    expect(vi.mocked(llm.chat).mock.calls[0][1]).toBe("message-route");
    expect(vi.mocked(llm.chat).mock.calls[1][1]).toBe("university-comparison");
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("北京大学画像资料");
    expect(prompt).toContain("清华大学画像资料");
    expect(prompt).toContain("北京大学评论资料");
    expect(prompt).toContain("清华大学评论资料");
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      universityId: null,
      universityName: "北京大学 / 清华大学",
      sourceUrl: null,
      answerText: expect.stringContaining("如果按综合学术氛围二选一")
    }));
  });

  it("uses the raw message to resolve a university info school when the LLM omits school names", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 21,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南航",
      score: 0.9
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("university_info", {
          schoolNames: [],
          topicKey: "general",
          topicLabel: "整体评价"
        }))
        .mockResolvedValueOnce("南航整体不错。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const universities = {
      getTopicQuestions: vi.fn(() => []),
      getSchoolProfile: vi.fn(() => null)
    } as unknown as UniversityRepository;
    const processor = new MessageProcessor(settings, universities, nlu, llm, logs);

    const result = await processor.process({
      platform: "debug",
      text: "南航怎么样",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("模型判断为高校资料回答");
    expect(result.reply).toContain("南航整体不错。");
    expect(nlu.analyze).toHaveBeenCalledWith("南航怎么样", undefined);
    expect(universities.getTopicQuestions).toHaveBeenCalledWith(21, "general", "南航怎么样", 6);
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it("does not build a comparison from local candidates unless the LLM returns multiple school names", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const pku = {
      id: 22,
      name: "北京大学",
      slug: "bei-jing-da-xue",
      file_path: "docs/universities/bei-jing-da-xue.md",
      source_url: "https://example.com/pku.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "北京大学",
      score: 0.8
    };
    const thu = {
      id: 23,
      name: "清华大学",
      slug: "qing-hua-da-xue",
      file_path: "docs/universities/qing-hua-da-xue.md",
      source_url: "https://example.com/thu.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "清华大学",
      score: 0.8
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [pku, thu],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const llm = {
      chat: vi.fn().mockResolvedValueOnce(routeJson("university_info", {
        schoolNames: [],
        queryTypes: ["compare"],
        topicKey: "general",
        topicLabel: "整体评价"
      }))
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const universities = {
      getTopicQuestions: vi.fn()
    } as unknown as UniversityRepository;
    const processor = new MessageProcessor(settings, universities, nlu, llm, logs);

    const result = await processor.process({
      platform: "debug",
      text: "北京大学和清华大学选哪个",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("需要学校名");
    expect(result.reply).toContain("哪所学校");
    expect(llm.chat).toHaveBeenCalledTimes(1);
  });

  it("does not expose raw abort errors when the LLM times out", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 120000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 6,
      name: "苏州大学",
      slug: "su-zhou-da-xue",
      file_path: "docs/universities/su-zhou-da-xue.md",
      source_url: "https://example.com/suda.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "name",
      score: 0.9
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      })),
      buildRetrievalContext: vi.fn()
    } as unknown as NaturalLanguageService;
    const universities = {
      getTopicQuestions: vi.fn(() => []),
      getSchoolProfile: vi.fn(() => null)
    } as unknown as UniversityRepository;
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("university_info", {
          schoolNames: ["苏州大学"],
          topicKey: "general",
          topicLabel: "整体评价"
        }))
        .mockRejectedValueOnce(new Error("This operation was aborted"))
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const processor = new MessageProcessor(settings, universities, nlu, llm, logs);

    const result = await processor.process({
      platform: "onebot",
      text: "苏州大学怎么样",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reply).toContain("模型响应超时或连接被中断");
    expect(result.reply).not.toContain("This operation was aborted");
  });

  it("passes detected university context into image messages", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 2,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "alias",
      score: 0.85
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      })),
      buildRetrievalContext: vi.fn()
    } as unknown as NaturalLanguageService;
    const universities = {
      getTopicQuestions: vi.fn(() => [])
    } as unknown as UniversityRepository;
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("university_info", {
          schoolNames: ["南京航空航天大学"],
          topicKey: "food",
          topicLabel: "食堂"
        }))
        .mockResolvedValueOnce("这张图可以放在南航食堂吐槽语境里看。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;

    const processor = new MessageProcessor(settings, universities, nlu, llm, logs);

    const result = await processor.process({
      platform: "debug",
      text: "南航的同学这样说",
      images: [{ url: "data:image/png;base64,AAAA" }],
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("模型判断为图片消息");
    expect(vi.mocked(llm.chat).mock.calls[0][1]).toBe("message-route");
    expect(vi.mocked(llm.chat).mock.calls[1][1]).toBe("image-message");
    const messages = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(messages).toContain("南京航空航天大学");
    expect(messages).toContain("入口模型判断：university_info");
    expect(messages).toContain("不要只解释图片梗本身");
  });

  it("allows mentioned group messages when natural group trigger is disabled", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: false,
          requireMentionInGroup: true,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 3,
      name: "南京师范大学",
      slug: "nan-jing-shi-fan-da-xue",
      file_path: "docs/universities/nan-jing-shi-fan-da-xue.md",
      source_url: "https://example.com/njnu.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "alias",
      score: 0.9
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      })),
      buildRetrievalContext: vi.fn()
    } as unknown as NaturalLanguageService;
    const universities = {
      getTopicQuestions: vi.fn(() => []),
      getSchoolProfile: vi.fn(() => null)
    } as unknown as UniversityRepository;
    const llm = {
      chat: vi.fn().mockResolvedValue("南师大整体不错。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(routeJson("university_info", {
        schoolNames: ["南京师范大学"],
        topicKey: "general",
        topicLabel: "整体评价"
      }))
      .mockResolvedValueOnce("南师大整体不错。");
    const processor = new MessageProcessor(settings, universities, nlu, llm, logs);

    const result = await processor.process({
      platform: "onebot",
      text: "南师大你觉得怎么样",
      messageType: "group",
      userId: "u1",
      groupId: "g1",
      conversationKey: "group:g1:user:u1",
      mentionedBot: true
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("模型判断为高校资料回答");
    expect(vi.mocked(llm.chat).mock.calls[0][1]).toBe("message-route");
    expect(vi.mocked(llm.chat).mock.calls[1][1]).toBe("university-answer");
  });

  it("requires mention for every group message even when context exists", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: true,
          contextTtlMinutes: 10,
          cooldownSeconds: 0,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 4,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "alias",
      score: 0.9
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      })),
      buildRetrievalContext: vi.fn()
    } as unknown as NaturalLanguageService;
    const universities = {
      getTopicQuestions: vi.fn(() => []),
      getSchoolProfile: vi.fn(() => null)
    } as unknown as UniversityRepository;
    const llm = {
      chat: vi.fn().mockResolvedValue("南航整体不错。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(routeJson("university_info", {
        schoolNames: ["南京航空航天大学"],
        topicKey: "general",
        topicLabel: "整体评价"
      }))
      .mockResolvedValueOnce("南航整体不错。");
    const processor = new MessageProcessor(settings, universities, nlu, llm, logs);
    const conversationKey = "group:g1:user:u1";

    await processor.process({
      platform: "onebot",
      text: "南航怎么样",
      messageType: "group",
      userId: "u1",
      groupId: "g1",
      conversationKey,
      mentionedBot: true
    });
    const result = await processor.process({
      platform: "onebot",
      text: "食堂呢",
      messageType: "group",
      userId: "u1",
      groupId: "g1",
      conversationKey,
      mentionedBot: false
    });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe("群聊需要 @ 机器人");
    expect(llm.chat).toHaveBeenCalledTimes(2);
  });

  it("creates a public source page url for university answers", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "https://bot.example.com/",
          filingNumber: "蜀ICP备00000000号"
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 5,
      name: "南京师范大学",
      slug: "nan-jing-shi-fan-da-xue",
      file_path: "docs/universities/nan-jing-shi-fan-da-xue.md",
      source_url: "https://example.com/njnu.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "alias",
      score: 0.9
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      })),
      buildRetrievalContext: vi.fn(() => "问卷资料片段")
    } as unknown as NaturalLanguageService;
    const universities = {
      getTopicQuestions: vi.fn(() => [{ question: "南师大怎么样", answers: [] }]),
      getSchoolProfile: vi.fn(() => null)
    } as unknown as UniversityRepository;
    const llm = {
      chat: vi.fn().mockResolvedValue("南师大整体不错。\n\n院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const answerSources = {
      create: vi.fn(() => "source-token")
    } as unknown as AnswerSourceStore;
    vi.mocked(llm.chat)
      .mockResolvedValueOnce(routeJson("university_info", {
        schoolNames: ["南京师范大学"],
        topicKey: "general",
        topicLabel: "整体评价"
      }))
      .mockResolvedValueOnce("南师大整体不错。\n\n院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。");
    const processor = new MessageProcessor(settings, universities, nlu, llm, logs, undefined, answerSources);

    const result = await processor.process({
      platform: "onebot",
      text: "南师大怎么样",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.sourcePageUrl).toBe("https://bot.example.com/sources/source-token");
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      question: "南师大怎么样",
      universityName: "南京师范大学",
      contextText: "问卷资料片段",
      answerText: expect.stringContaining("南师大整体不错")
    }));
  });

  it("uses the confirmed school context for follow-up admission questions without a school name", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "https://bot.example.com/",
          filingNumber: "蜀ICP备00000000号"
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 6,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南航",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      })),
      buildRetrievalContext: vi.fn(() => "问卷资料片段")
    } as unknown as NaturalLanguageService;
    const universities = {
      getUniversity: vi.fn(() => university),
      getTopicQuestions: vi.fn(() => [{ question: "南航怎么样", answers: [] }]),
      getSchoolProfile: vi.fn(() => null)
    } as unknown as UniversityRepository;
    const admissions = {
      queryPlans: vi.fn(() => []),
      queryScores: vi.fn(() => [
        {
          id: 66,
          scoreType: "school",
          universityId: 6,
          universityName: "南京航空航天大学",
          sourceSchoolId: "452",
          year: 2025,
          provinceName: "四川",
          subjectType: "理科",
          batch: "本科一批",
          planGroup: null,
          majorName: null,
          minScore: 622,
          minRank: 14500,
          avgScore: 633,
          avgRank: 10000,
          maxScore: 650,
          planCount: 120,
          controlScore: 520,
          diffScore: 102,
          selectionRequirements: null,
          sourceUrl: "https://www.gaokao.cn/school/452/provinceline",
          sourceRecordId: "166",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      getMapping: vi.fn(() => null)
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({
        source: "gaokao_cn",
        total: 1,
        candidateTotal: 1,
        offset: 0,
        nextOffset: 0,
        mapped: 1,
        planRows: 0,
        planSummaryRows: 0,
        majorPlanRows: 0,
        schoolScoreRows: 1,
        majorScoreRows: 0,
        sourceRows: 1,
        skippedRequests: 0,
        skipped: 0,
        errors: []
      })
    };
    const answerSources = {
      create: vi.fn(() => "source-token")
    } as unknown as AnswerSourceStore;
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("university_info", {
          schoolNames: ["南京航空航天大学"],
          topicKey: "general",
          topicLabel: "整体评价"
        }))
        .mockResolvedValueOnce("南航整体不错。")
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: [],
          province: "四川",
          subjectType: "理科",
          years: [2025, 2024, 2023],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce("南航四川理科近三年分数线可以参考缓存数据。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const processor = new MessageProcessor(
      settings,
      universities,
      nlu,
      llm,
      logs,
      undefined,
      answerSources,
      admissions as never,
      gaokaoCn as never
    );
    const conversationKey = "private:u1";

    await processor.process({
      platform: "onebot",
      text: "南航怎么样",
      messageType: "private",
      userId: "u1",
      conversationKey
    });
    const result = await processor.process({
      platform: "onebot",
      text: "四川近三年分数线呢",
      messageType: "private",
      userId: "u1",
      conversationKey
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据回答");
    expect(nlu.analyze).toHaveBeenCalledTimes(2);
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 6,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      includePlans: true,
      includeScores: false
    }));
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({
      source: "xuefeng_agent",
      universityId: 6,
      provinceName: "四川",
      subjectType: "理科",
      years: [2025, 2024, 2023]
    }));
    expect(answerSources.create).toHaveBeenLastCalledWith(expect.objectContaining({
      question: "四川近三年分数线呢",
      universityName: "南京航空航天大学",
      topic: "招生数据"
    }));
  });

  it("uses local score data and only realtime-syncs plans for admission score queries", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "http://127.0.0.1:8787",
          filingNumber: ""
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 7,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南京航空航天大学",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn(() => [
        {
          id: 70,
          universityId: 7,
          universityName: "南京航空航天大学",
          sourceSchoolId: "452",
          year: 2026,
          provinceName: "四川",
          subjectType: "物理类",
          batch: "本科一批",
          planGroup: null,
          majorName: "航空航天类",
          planCount: 24,
          schoolPlanCount: null,
          majorCount: null,
          tuition: "6380",
          duration: "四年",
          campus: null,
          selectionRequirements: "物理,化学",
          sourceUrl: "https://www.gaokao.cn/school/452/plan",
          sourceRecordId: "89",
          rawJson: "{}",
          fetchedAt: "2026-06-25T01:00:00.000Z"
        }
      ]),
      queryScores: vi.fn(() => [
        {
          id: 1,
          scoreType: "school",
          universityId: 7,
          universityName: "南京航空航天大学",
          sourceSchoolId: "452",
          year: 2025,
          provinceName: "四川",
          subjectType: "理科",
          batch: "本科一批",
          planGroup: null,
          majorName: null,
          minScore: 622,
          minRank: 14500,
          avgScore: 633,
          avgRank: 10000,
          maxScore: 650,
          planCount: 120,
          controlScore: 520,
          diffScore: 102,
          selectionRequirements: null,
          sourceUrl: "https://www.gaokao.cn/school/452/provinceline",
          sourceRecordId: "88",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        },
        {
          id: 2,
          scoreType: "school",
          universityId: 7,
          universityName: "南京航空航天大学",
          sourceSchoolId: "452",
          year: 2024,
          provinceName: "四川",
          subjectType: "理科",
          batch: "本科一批",
          planGroup: null,
          majorName: null,
          minScore: 615,
          minRank: 16000,
          avgScore: 626,
          avgRank: 12000,
          maxScore: 642,
          planCount: 118,
          controlScore: 515,
          diffScore: 100,
          selectionRequirements: null,
          sourceUrl: "https://www.gaokao.cn/school/452/provinceline",
          sourceRecordId: "87",
          rawJson: "{}",
          fetchedAt: "2026-06-24T00:00:00.000Z"
        },
        {
          id: 3,
          scoreType: "school",
          universityId: 7,
          universityName: "南京航空航天大学",
          sourceSchoolId: "452",
          year: 2023,
          provinceName: "四川",
          subjectType: "理科",
          batch: "本科一批",
          planGroup: null,
          majorName: null,
          minScore: 610,
          minRank: 17000,
          avgScore: 620,
          avgRank: 13000,
          maxScore: 638,
          planCount: 116,
          controlScore: 520,
          diffScore: 90,
          selectionRequirements: null,
          sourceUrl: "https://www.gaokao.cn/school/452/provinceline",
          sourceRecordId: "86",
          rawJson: "{}",
          fetchedAt: "2026-06-23T00:00:00.000Z"
        }
      ]),
      getSource: vi.fn((id: number) => ({
        id,
        source: "gaokao_cn",
        sourceKind: "score-school",
        universityId: 7,
        universityName: "南京航空航天大学",
        sourceSchoolId: "452",
        sourceUrl: "https://api.zjzw.cn/web/api/?uri=apidata/api/gk/score/province&school_id=452&local_province_id=51&local_type_id=2&year=2025&page=1&size=20",
        requestJson: JSON.stringify({
          uri: "apidata/api/gk/score/province",
          school_id: "452",
          local_province_id: "51",
          local_type_id: "2",
          year: 2025,
          page: 1,
          size: 20
        }),
        responseJson: JSON.stringify({ code: "0000", message: "成功---success", data: { item: [{ min: 622, min_section: 14500 }] } }),
        status: "success",
        error: null,
        fetchedAt: "2026-06-25T00:00:00.000Z"
      })),
      listSources: vi.fn(() => [
        {
          id: 1888,
          source: "gaokao_cn",
          sourceKind: "plan-major",
          universityId: 7,
          universityName: "南京航空航天大学",
          sourceSchoolId: "452",
          sourceUrl: "https://api.zjzw.cn/web/api/?uri=apidata/api/gkv3/plan/school&school_id=452&local_province_id=51&local_type_id=2073&year=2026&page=1&size=10",
          requestJson: JSON.stringify({
            uri: "apidata/api/gkv3/plan/school",
            school_id: "452",
            local_province_id: "51",
            local_type_id: "2073",
            year: 2026,
            page: 1,
            size: 10
          }),
          responseJson: JSON.stringify({ code: "0000", message: "成功---success", data: { item: [], numFound: 0 } }),
          status: "success",
          error: null,
          fetchedAt: "2026-06-25T01:01:00.000Z"
        },
        {
          id: 88,
          source: "gaokao_cn",
          sourceKind: "score-school",
          universityId: 7,
          universityName: "南京航空航天大学",
          sourceSchoolId: "452",
          sourceUrl: "https://api.zjzw.cn/web/api/?uri=apidata/api/gk/score/province&school_id=452&local_province_id=51&local_type_id=2&year=2025&page=1&size=20",
          requestJson: "{}",
          responseJson: "{}",
          status: "success",
          error: null,
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      getMapping: vi.fn(() => null)
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({
        mapped: 1,
        total: 1,
        candidateTotal: 1,
        offset: 0,
        nextOffset: 0,
        planRows: 0,
        planSummaryRows: 0,
        majorPlanRows: 0,
        schoolScoreRows: 0,
        majorScoreRows: 0,
        sourceRows: 5,
        skippedRequests: 0,
        skipped: 0,
        errors: []
      })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["南京航空航天大学"],
          province: "四川",
          subjectType: "理科",
          years: [2025, 2024, 2023],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce("南航四川近三年分数线可以参考缓存数据。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const answerSources = {
      create: vi.fn(() => "source-token")
    } as unknown as AnswerSourceStore;
    const universities = {
      getUniversity: vi.fn(() => university),
      getSchoolProfile: vi.fn(() => ({
        universityId: 7,
        source: "gaokao_cn",
        sourceSchoolId: "452",
        sourceUrl: "https://www.gaokao.cn/school/452",
        payloadJson: "{}",
        profileText: "掌上高考 school_id：452\n所在地：江苏 南京\n标签：211、双一流\n学校类型：理工类",
        updatedAt: "2026-06-25T01:00:00.000Z"
      }))
    } as unknown as UniversityRepository;
    const processor = new MessageProcessor(
      settings,
      universities,
      nlu,
      llm,
      logs,
      undefined,
      answerSources,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "南航四川近三年分数线和位次",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据回答");
    expect(result.sourcePageUrl).toBe("http://127.0.0.1:8787/sources/source-token");
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 7,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includePlanDetails: false,
      useMnzyPlanDetails: true,
      skipExisting: true
    }));
    expect(gaokaoCn.sync).toHaveBeenCalledTimes(1);
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({
      source: "xuefeng_agent",
      universityId: 7,
      provinceName: "四川",
      subjectType: "理科",
      subjectTypes: ["物理类", "理科"],
      years: [2025, 2024, 2023]
    }));
    expect(admissions.queryPlans).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 7,
      provinceName: "四川",
      subjectType: "理科",
      subjectTypes: ["物理类", "理科"],
      years: [2026]
    }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("雪峰 Agent");
    expect(prompt).toContain("先一句话拍板");
    expect(prompt).toContain("冲、稳、保");
    expect(prompt).toContain("位次优先于分数");
    expect(prompt).toContain("年份|科类|批次/专业组|口径/专业|最低位次|最低分|计划数");
    expect(prompt).toContain("不要把 2026 招生计划当成 2026 录取分数线");
    expect(prompt).toContain("掌上高考院校基础信息");
    expect(prompt).toContain("所在地：江苏 南京");
    expect(prompt).toContain("标签：211、双一流");
    expect(prompt).toContain("院校基础信息补充表：school_profiles");
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      topic: "招生数据",
      schoolProfileText: expect.stringContaining("所在地：江苏 南京")
    }));
    expect(prompt).toContain("科类口径提示");
    expect(prompt).toContain("实际检索科类：物理类 / 理科");
    expect(prompt).toContain("2026 | 招生计划 | 物理类");
    expect(prompt).toContain("航空航天类");
    expect(prompt).toContain("平均位次 | 平均分 | 最高分 | 省控线 | 线差");
    expect(prompt).toContain("14500 | 622 | 10000 | 633 | 650 | 520 | 102");
    expect(prompt).toContain("分数趋势摘要");
    expect(prompt).toContain("最低位次区间：14500-17000");
    expect(prompt).toContain("平均分区间：620-633");
    expect(prompt).toContain("最高分区间：638-650");
    expect(prompt).toContain("省控线区间：515-520");
    expect(prompt).toContain("线差区间：90-102");
    expect(prompt).toContain("2025 相比 2024 位次前移");
    expect(prompt).toContain("招生来源快照：");
    expect(prompt).toContain("score-school");
    expect(prompt).toContain("plan-major");
    expect(prompt).toContain("item_count=1");
    expect(prompt).toContain("item_count=0");
  });

  it("prefers Jiangsu EEA score rows before Xuefeng score supplements", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "http://127.0.0.1:8787",
          filingNumber: ""
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true,
          admissionJiangsuOnlyEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 77,
      name: "苏州大学",
      slug: "su-zhou-da-xue",
      file_path: "docs/universities/su-zhou-da-xue.md",
      source_url: "https://example.com/suda.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "苏州大学",
      score: 0.99
    };
    const nlu = {
      analyze: vi.fn(() => ({ candidates: [university], reason: "本地候选" }))
    } as unknown as NaturalLanguageService;
    const universities = {
      getUniversity: vi.fn(() => university),
      getSchoolProfile: vi.fn(() => null)
    } as unknown as UniversityRepository;
    const makeScore = (source: string, year: number, minRank: number, minScore: number, id: number) => ({
      id,
      source,
      scoreType: "school" as const,
      universityId: 77,
      universityName: "苏州大学",
      sourceSchoolId: "suda",
      year,
      provinceName: "江苏",
      subjectType: "物理类",
      batch: "本科批",
      planGroup: "05",
      majorName: null,
      minScore,
      minRank,
      avgScore: null,
      avgRank: null,
      maxScore: null,
      planCount: null,
      controlScore: null,
      diffScore: null,
      selectionRequirements: "物理,化学",
      sourceUrl: source === "jiangsu_eea" ? "https://www.jseea.cn/" : "https://xuefeng.example/",
      sourceRecordId: String(id),
      rawJson: "{}",
      fetchedAt: "2026-06-25T00:00:00.000Z"
    });
    const admissions = {
      queryPlans: vi.fn(() => []),
      queryScores: vi.fn((query: { source?: string }) => {
        if (query.source === "jiangsu_eea") return [makeScore("jiangsu_eea", 2025, 12000, 610, 501)];
        if (query.source === "xuefeng_agent") {
          return [
            makeScore("xuefeng_agent", 2025, 13000, 609, 601),
            makeScore("xuefeng_agent", 2024, 14000, 606, 602)
          ];
        }
        return [];
      }),
      getMapping: vi.fn(() => null)
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["苏州大学"],
          province: "江苏",
          subjectType: "物理类",
          years: [2025, 2024],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce("苏州大学江苏物理类先看官方位次。")
    } as unknown as LlmClient;
    const logs = { message: vi.fn() } as unknown as LogStore;
    const answerSources = { create: vi.fn(() => "jiangsu-source") } as unknown as AnswerSourceStore;
    const processor = new MessageProcessor(
      settings,
      universities,
      nlu,
      llm,
      logs,
      undefined,
      answerSources,
      admissions as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "苏州大学江苏物理类近两年分数线",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据回答");
    expect(admissions.queryScores).toHaveBeenNthCalledWith(1, expect.objectContaining({ source: "jiangsu_eea" }));
    expect(admissions.queryScores).toHaveBeenNthCalledWith(2, expect.objectContaining({ source: "xuefeng_agent" }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("江苏考试院官方");
    expect(prompt).toContain("雪峰Agent历史库");
    expect(prompt).toContain("12000 | 610");
    expect(prompt).toContain("14000 | 606");
    expect(prompt).not.toContain("13000 | 609");
  });

  it("fills missing score plan counts from matching same-year admission plans", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 20,
      name: "北京邮电大学",
      slug: "bei-jing-you-dian-da-xue",
      file_path: "docs/universities/bei-jing-you-dian-da-xue.md",
      source_url: "https://example.com/bupt.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "北邮",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn(() => [
        {
          id: 2001,
          universityId: 20,
          universityName: "北京邮电大学",
          sourceSchoolId: "42",
          year: 2025,
          provinceName: "山东",
          subjectType: "综合改革",
          batch: "普通类一段",
          planGroup: null,
          majorName: "计算机类",
          planCount: 18,
          schoolPlanCount: null,
          majorCount: null,
          tuition: "5500",
          duration: "四年",
          campus: null,
          selectionRequirements: "物理,化学",
          sourceUrl: "https://www.gaokao.cn/school/42/plan",
          sourceRecordId: "2001",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      queryScores: vi.fn(() => [
        {
          id: 2002,
          scoreType: "major",
          universityId: 20,
          universityName: "北京邮电大学",
          sourceSchoolId: "42",
          year: 2025,
          provinceName: "山东",
          subjectType: "综合改革",
          batch: "普通类一段",
          planGroup: null,
          majorName: "计算机类",
          minScore: 650,
          minRank: 4200,
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: null,
          controlScore: null,
          diffScore: null,
          selectionRequirements: "物理,化学",
          sourceUrl: "https://www.gaokao.cn/school/42/specialline",
          sourceRecordId: "2002",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        },
        {
          id: 2003,
          scoreType: "major",
          universityId: 20,
          universityName: "北京邮电大学",
          sourceSchoolId: "42",
          year: 2025,
          provinceName: "山东",
          subjectType: "综合改革",
          batch: "普通类一段",
          planGroup: null,
          majorName: "人工智能",
          minScore: 648,
          minRank: 4500,
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: null,
          controlScore: null,
          diffScore: null,
          selectionRequirements: "物理,化学",
          sourceUrl: "https://www.gaokao.cn/school/42/specialline",
          sourceRecordId: "2003",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      getSource: vi.fn(() => null),
      getMapping: vi.fn(() => null)
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["北京邮电大学"],
          province: "山东",
          subjectType: "综合改革",
          years: [2025],
          majorName: "计算机",
          queryTypes: ["plan", "major_score", "rank"]
        }))
        .mockResolvedValueOnce("北邮山东计算机类 2025 年可以参考专业线和计划。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn(() => university) } as unknown as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "北邮山东计算机2025分数线和计划",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据回答");
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("2025 | 专业线 | 综合改革 | 普通类一段 | 计算机类 | 4200 | 650 | - | - | - | - | - | 18");
    expect(prompt).toContain("2025 | 专业线 | 综合改革 | 普通类一段 | 人工智能 | 4500 | 648 | - | - | - | - | - | -");
    expect(prompt).toContain("计划数范围：18-18");
    expect(prompt).toContain("2025专业线/计算机类 位次4200 最低650分 计划18");
    expect(prompt).not.toContain("2025专业线/人工智能 最低648分 位次4500 计划18");
  });

  it("stops admission realtime sync after Gaokao.cn rate limits", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 71,
      name: "三亚学院",
      slug: "san-ya-xue-yuan",
      file_path: "docs/universities/san-ya-xue-yuan.md",
      source_url: "https://example.com/syu.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "三亚学院",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn(() => []),
      queryScores: vi.fn(() => []),
      getMapping: vi.fn(() => null),
      listSources: vi.fn(() => [])
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({
        source: "gaokao_cn",
        total: 1,
        candidateTotal: 1,
        offset: 0,
        nextOffset: 0,
        mapped: 0,
        planRows: 0,
        planSummaryRows: 0,
        majorPlanRows: 0,
        schoolScoreRows: 0,
        majorScoreRows: 0,
        sourceRows: 1,
        skippedRequests: 0,
        skipped: 0,
        errors: [{ university: "三亚学院", message: "Gaokao.cn plan-school-summary returned 1069: 访问太过频繁，请稍后再试" }]
      })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["三亚学院"],
          province: "北京",
          subjectType: "综合改革",
          years: [2025],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce("掌上高考当前限流，先参考本地缓存。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn(() => university) } as unknown as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "三亚学院北京近三年分数线",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(gaokaoCn.sync).toHaveBeenCalledTimes(1);
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      includePlans: true,
      includeScores: false
    }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("已停止继续实时获取");
    expect(prompt).toContain("错误 1");
  });

  it("uses a dedicated Bot realtime admission request budget across plan and score syncs", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        },
        sync: {
          gaokaoCnRequestDelayMs: 0,
          gaokaoCnRateLimitCooldownMinutes: 720,
          gaokaoCnMaxRequestsPerRun: 1,
          gaokaoCnRealtimeRequestDelayMs: 250,
          gaokaoCnRealtimeMaxRequestsPerRun: 7,
          gaokaoCnSkipExisting: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 72,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南航",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn(() => []),
      queryScores: vi.fn(() => []),
      getMapping: vi.fn(() => null),
      listSources: vi.fn(() => [])
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({
        source: "gaokao_cn",
        total: 1,
        candidateTotal: 1,
        offset: 0,
        nextOffset: 0,
        mapped: 1,
        planRows: 0,
        planSummaryRows: 0,
        majorPlanRows: 0,
        schoolScoreRows: 0,
        majorScoreRows: 0,
        sourceRows: 1,
        sourceRequests: 7,
        sourceRequestBudget: 7,
        requestBudgetExhausted: true,
        skippedRequests: 0,
        skipped: 0,
        errors: []
      })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["南京航空航天大学"],
          province: "四川",
          subjectType: "理科",
          years: [2025, 2024, 2023],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce("预算用完后先参考本地缓存。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn(() => university) } as unknown as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "南航四川近三年分数线和位次",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(gaokaoCn.sync).toHaveBeenCalledTimes(1);
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      includePlans: true,
      includeScores: false,
      requestDelayMs: 250,
      maxSourceRequests: 7
    }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("实时获取节流");
    expect(prompt).toContain("本批已用 7/7 次源站请求预算");
  });

  it("uses historical scores and explains when the user asks for current-year score lines", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 18,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南航",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn(() => []),
      queryScores: vi.fn(() => [
        {
          id: 1801,
          scoreType: "school",
          universityId: 18,
          universityName: "南京航空航天大学",
          sourceSchoolId: "452",
          year: 2025,
          provinceName: "四川",
          subjectType: "理科",
          batch: "本科一批",
          planGroup: null,
          majorName: null,
          minScore: 622,
          minRank: 14500,
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: null,
          controlScore: null,
          diffScore: null,
          selectionRequirements: null,
          sourceUrl: "https://www.gaokao.cn/school/452/provinceline",
          sourceRecordId: "1801",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      getSource: vi.fn(() => null),
      getMapping: vi.fn(() => null)
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({ mapped: 1, total: 1 })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["南京航空航天大学"],
          province: "四川",
          subjectType: "理科",
          years: [2026],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce("2026 年录取分还没完整出，可以先看历史分数。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn(() => university) } as unknown as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "南航今年四川理科分数线和位次",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据回答");
    expect(nlu.analyze).toHaveBeenCalledWith("南京航空航天大学", undefined);
    expect(gaokaoCn.sync).toHaveBeenCalledTimes(1);
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 18,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      planYears: [2026],
      includePlans: true,
      includeScores: false
    }));
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({
      source: "xuefeng_agent",
      universityId: 18,
      provinceName: "四川",
      subjectType: "理科",
      subjectTypes: ["物理类", "理科"],
      years: [2025, 2024, 2023]
    }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("分数年份提示");
    expect(prompt).toContain("用户请求了 2026 年录取分数/位次");
    expect(prompt).toContain("2023-2025");
  });

  it("marks admission rows as fallback data when a requested major has no exact match", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 19,
      name: "北京邮电大学",
      slug: "bei-jing-you-dian-da-xue",
      file_path: "docs/universities/bei-jing-you-dian-da-xue.md",
      source_url: "https://example.com/bupt.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "北邮",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn((query: { majorName?: string | null }) => query.majorName ? [] : [
        {
          id: 1901,
          universityId: 19,
          universityName: "北京邮电大学",
          sourceSchoolId: "42",
          year: 2026,
          provinceName: "山东",
          subjectType: "综合改革",
          batch: "普通类一段",
          planGroup: null,
          majorName: "电子信息类",
          planCount: 20,
          schoolPlanCount: null,
          majorCount: null,
          tuition: "5500",
          duration: "四年",
          campus: null,
          selectionRequirements: "物理,化学",
          sourceUrl: "https://www.gaokao.cn/school/42/plan",
          sourceRecordId: "1901",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      queryScores: vi.fn((query: { majorName?: string | null }) => query.majorName ? [] : [
        {
          id: 1902,
          scoreType: "school",
          universityId: 19,
          universityName: "北京邮电大学",
          sourceSchoolId: "42",
          year: 2025,
          provinceName: "山东",
          subjectType: "综合改革",
          batch: "普通类一段",
          planGroup: null,
          majorName: null,
          minScore: 645,
          minRank: 5000,
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: null,
          controlScore: null,
          diffScore: null,
          selectionRequirements: null,
          sourceUrl: "https://www.gaokao.cn/school/42/provinceline",
          sourceRecordId: "1902",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      getSource: vi.fn(() => null),
      getMapping: vi.fn(() => null)
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({ mapped: 1, total: 1 })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["北京邮电大学"],
          province: "山东",
          subjectType: "综合改革",
          years: [2026, 2025],
          majorName: "计算机",
          queryTypes: ["plan", "major_score", "rank"]
        }))
        .mockResolvedValueOnce("没有精确计算机专业记录，只能参考院校线。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn(() => university) } as unknown as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "北邮计算机山东多少位次",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据回答");
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({ majorName: "计算机" }));
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.not.objectContaining({ majorName: "计算机" }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("报考参考表");
    expect(prompt).toContain("2026 | 招生计划 | 综合改革");
    expect(prompt).toContain("2025 | 院校线 | 综合改革");
    expect(prompt).toContain("专业匹配提示");
    expect(prompt).toContain("用户请求了“计算机”");
    expect(prompt).toContain("这些不是“计算机”的精确专业数据");
    expect(prompt).toContain("2025 | 院校线");
  });

  it("compares admission data for multiple schools returned by the LLM route", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "https://bot.example.com",
          filingNumber: ""
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const bupt = {
      id: 31,
      name: "北京邮电大学",
      slug: "bei-jing-you-dian-da-xue",
      file_path: "docs/universities/bei-jing-you-dian-da-xue.md",
      source_url: "https://example.com/bupt.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "北邮",
      score: 0.9
    };
    const xidian = {
      id: 32,
      name: "西安电子科技大学",
      slug: "xi-an-dian-zi-ke-ji-da-xue",
      file_path: "docs/universities/xi-an-dian-zi-ke-ji-da-xue.md",
      source_url: "https://example.com/xidian.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "西电",
      score: 0.9
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [bupt, xidian],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn((query: { universityId: number }) => [
        {
          id: query.universityId === 31 ? 3101 : 3201,
          universityId: query.universityId,
          universityName: query.universityId === 31 ? "北京邮电大学" : "西安电子科技大学",
          sourceSchoolId: query.universityId === 31 ? "42" : "253",
          year: 2026,
          provinceName: "山东",
          subjectType: "综合改革",
          batch: "普通类一段",
          planGroup: null,
          majorName: "计算机类",
          planCount: query.universityId === 31 ? 18 : 28,
          schoolPlanCount: null,
          majorCount: null,
          tuition: "5500",
          duration: "四年",
          campus: null,
          selectionRequirements: "物理,化学",
          sourceUrl: "https://www.gaokao.cn/school/plan",
          sourceRecordId: query.universityId === 31 ? "310" : "320",
          rawJson: JSON.stringify({ year: 2026, spname: "计算机类", num: query.universityId === 31 ? 18 : 28 }),
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      queryScores: vi.fn((query: { universityId: number }) => [
        {
          id: query.universityId === 31 ? 3111 : 3211,
          scoreType: "major",
          universityId: query.universityId,
          universityName: query.universityId === 31 ? "北京邮电大学" : "西安电子科技大学",
          sourceSchoolId: query.universityId === 31 ? "42" : "253",
          year: 2025,
          provinceName: "山东",
          subjectType: "综合改革",
          batch: "普通类一段",
          planGroup: null,
          majorName: "计算机类",
          minScore: query.universityId === 31 ? 650 : 635,
          minRank: query.universityId === 31 ? 4100 : 7200,
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: query.universityId === 31 ? 16 : 25,
          controlScore: null,
          diffScore: null,
          selectionRequirements: "物理,化学",
          sourceUrl: "https://www.gaokao.cn/school/provinceline",
          sourceRecordId: query.universityId === 31 ? "311" : "321",
          rawJson: JSON.stringify({ year: 2025, spname: "计算机类", min: query.universityId === 31 ? 650 : 635, min_section: query.universityId === 31 ? 4100 : 7200 }),
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      getSource: vi.fn((id: number) => ({
        id,
        source: "gaokao_cn",
        sourceKind: String(id).endsWith("0") ? "plan-major" : "score-major",
        universityId: id < 320 ? 31 : 32,
        universityName: id < 320 ? "北京邮电大学" : "西安电子科技大学",
        sourceSchoolId: id < 320 ? "42" : "253",
        sourceUrl: `https://api.zjzw.cn/web/api/?source=${id}`,
        requestJson: JSON.stringify({ uri: String(id).endsWith("0") ? "apidata/api/gkv3/plan/school" : "apidata/api/gk/score/special", year: String(id).endsWith("0") ? 2026 : 2025 }),
        responseJson: JSON.stringify({ code: "0000", message: "成功---success", data: { item: [{}] } }),
        status: "success",
        error: null,
        fetchedAt: "2026-06-25T00:00:00.000Z"
      })),
      getMapping: vi.fn((id: number) => ({
        sourceUrl: id === 31 ? "https://www.gaokao.cn/school/42" : "https://www.gaokao.cn/school/253"
      }))
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({ mapped: 1, total: 1, sourceRows: 2 })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["北京邮电大学", "西安电子科技大学"],
          province: "山东",
          subjectType: "综合改革",
          years: [2026, 2025, 2024, 2023],
          majorName: "计算机",
          queryTypes: ["compare", "major_score", "rank", "plan"]
        }))
        .mockResolvedValueOnce("如果只看山东计算机，北邮位次更靠前，西电计划数更宽。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const answerSources = {
      create: vi.fn(() => "admission-comparison-source")
    } as unknown as AnswerSourceStore;
    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn() } as unknown as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      answerSources,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "北邮和西电计算机山东多少位次，怎么选",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据对比回答");
    expect(result.sourcePageUrl).toBe("https://bot.example.com/sources/admission-comparison-source");
    expect(gaokaoCn.sync).toHaveBeenCalledTimes(2);
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({ universityId: 31, provinces: ["山东"], includePlans: true, includeScores: false }));
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({ universityId: 32, provinces: ["山东"], includePlans: true, includeScores: false }));
    expect(vi.mocked(llm.chat).mock.calls[1][1]).toBe("admission-comparison");
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("雪峰 Agent");
    expect(prompt).toContain("先拍板");
    expect(prompt).toContain("直接说按什么前提选哪所");
    expect(prompt).toContain("位次优先于分数");
    expect(prompt).toContain("学校|年份|科类|口径/专业|最低位次|最低分|计划数");
    expect(prompt).toContain("2026 招生计划只能说明名额和方向");
    expect(prompt).toContain("北京邮电大学");
    expect(prompt).toContain("西安电子科技大学");
    expect(prompt).toContain("min_section=4100");
    expect(prompt).toContain("min_section=7200");
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      universityId: null,
      universityName: "北京邮电大学 / 西安电子科技大学",
      topic: "招生数据",
      contextText: expect.stringContaining("多校招生对比查询")
    }));
  });

  it("explains completed admission syncs that return no matching rows", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        site: {
          publicBaseUrl: "https://bot.example.com",
          filingNumber: ""
        },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 17,
      name: "安徽大学",
      slug: "an-hui-da-xue",
      file_path: "docs/universities/an-hui-da-xue.md",
      source_url: "https://example.com/ahu.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "安徽大学",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn(() => []),
      queryScores: vi.fn(() => []),
      listSources: vi.fn(() => [
        {
          id: 308,
          source: "gaokao_cn",
          sourceKind: "plan-major",
          universityId: 17,
          universityName: "安徽大学",
          sourceSchoolId: "67",
          sourceUrl: "https://api.zjzw.cn/web/api/?uri=apidata/api/gkv3/plan/school&school_id=67&local_province_id=51&local_type_id=2&year=2026&page=1&size=10",
          requestJson: JSON.stringify({
            uri: "apidata/api/gkv3/plan/school",
            school_id: "67",
            local_province_id: "51",
            local_type_id: "2",
            year: 2026,
            page: 1,
            size: 10
          }),
          responseJson: JSON.stringify({ code: "0000", message: "成功---success", data: { item: [], numFound: 0 } }),
          status: "success",
          error: null,
          fetchedAt: "2026-06-25T16:49:51.434Z"
        }
      ]),
      getMapping: vi.fn(() => ({
        sourceUrl: "https://www.gaokao.cn/school/67"
      }))
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({
        total: 1,
        candidateTotal: 1,
        offset: 0,
        nextOffset: 0,
        mapped: 1,
        planRows: 0,
        planSummaryRows: 0,
        majorPlanRows: 0,
        schoolScoreRows: 0,
        majorScoreRows: 0,
        sourceRows: 2,
        skipped: 0,
        errors: []
      })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["安徽大学"],
          province: "四川",
          subjectType: "理科",
          years: [2026],
          queryTypes: ["plan"]
        }))
        .mockResolvedValueOnce("掌上高考当前没有返回安徽大学四川理科 2026 招生计划。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const answerSources = {
      create: vi.fn(() => "admission-source")
    } as unknown as AnswerSourceStore;
    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn(() => university) } as unknown as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      answerSources,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "安徽大学今年在四川招多少理科",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据回答");
    expect(result.sourcePageUrl).toBe("https://bot.example.com/sources/admission-source");
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 17,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      planYears: [2026],
      includePlans: true,
      includeScores: false,
      includePlanDetails: true,
      useMnzyPlanDetails: true
    }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("实时获取结果：已请求掌上高考");
    expect(prompt).toContain("数据状态：本次掌上高考计划请求正常完成");
    expect(prompt).toContain("数据缺口：本次没有拿到足够匹配的招生数据");
    expect(prompt).toContain("查询条件：学校=安徽大学；省份=四川；科类=物理类");
    expect(prompt).toContain("缺少内容：招生计划（年份 2026）");
    expect(prompt).toContain("来源摘要 2");
    expect(prompt).toContain("招生来源快照：");
    expect(prompt).toContain("plan-major");
    expect(prompt).toContain("item_count=0");
    expect(prompt).not.toContain("分数年份提示");
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      topic: "招生数据",
      sourceUrl: "https://www.gaokao.cn/school/67",
      contextText: expect.stringContaining("本次实时来源摘要数：2")
    }));
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      contextText: expect.stringContaining("招生来源快照：")
    }));
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      contextText: expect.stringContaining("查询条件：学校=安徽大学；省份=四川；科类=物理类")
    }));
  });

  it("defaults empty admission score years to recent historical years", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        },
        sync: {
          gaokaoCnMaxRequestsPerRun: 4,
          gaokaoCnSkipExisting: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 21,
      name: "中国药科大学",
      slug: "zhong-guo-yao-ke-da-xue",
      file_path: "docs/universities/zhong-guo-yao-ke-da-xue.md",
      source_url: "https://example.com/cpu.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "中国药科大学",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn(() => []),
      queryScores: vi.fn(() => []),
      listSources: vi.fn(() => []),
      getMapping: vi.fn(() => null)
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({
        source: "gaokao_cn",
        total: 1,
        candidateTotal: 1,
        offset: 0,
        nextOffset: 0,
        mapped: 1,
        planRows: 0,
        planSummaryRows: 0,
        majorPlanRows: 0,
        schoolScoreRows: 0,
        majorScoreRows: 0,
        sourceRows: 0,
        sourceRequests: 0,
        sourceRequestBudget: 4,
        requestBudgetExhausted: false,
        skippedRequests: 0,
        skipped: 0,
        errors: []
      })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["中国药科大学"],
          province: "河南",
          subjectType: "理科",
          years: [],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce("中国药科大学河南近三年分数线可以参考 2023-2025 历史数据。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const processor = new MessageProcessor(
      settings,
      { getUniversity: vi.fn(() => university) } as unknown as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "中国药科大学河南近三年分数线",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据回答");
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 21,
      provinces: ["河南"],
      subjectTypes: ["物理类"],
      planYears: [2026],
      includePlans: true,
      includeScores: false
    }));
    expect(gaokaoCn.sync).toHaveBeenCalledTimes(1);
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({
      source: "xuefeng_agent",
      universityId: 21,
      provinceName: "河南",
      subjectType: "理科",
      subjectTypes: ["物理类", "理科"],
      years: [2025, 2024, 2023]
    }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("历史参考默认使用 2023-2025");
    expect(prompt).toContain("最低位次");
  });

  it("asks for subject type when an admission query province needs one", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 8,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南京航空航天大学",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const llm = {
      chat: vi.fn().mockResolvedValueOnce(routeJson("admission", {
        schoolNames: ["南京航空航天大学"],
        province: "四川",
        subjectType: null,
        years: [2025, 2024, 2023],
        queryTypes: ["score", "rank"]
      }))
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const gaokaoCn = {
      sync: vi.fn()
    };
    const admissions = {
      queryPlans: vi.fn(),
      queryScores: vi.fn()
    };
    const processor = new MessageProcessor(
      settings,
      {} as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "南航四川近三年分数线和位次",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生查询需要科类");
    expect(result.reply).toContain("哪个科类");
    expect(result.reply).toContain("物理类");
    expect(result.reply).toContain("2025 年按");
    expect(result.reply).toContain("2024、2023 年按");
    expect(result.reply).toContain("自动换算口径");
    expect(gaokaoCn.sync).not.toHaveBeenCalled();
    expect(admissions.queryScores).not.toHaveBeenCalled();
  });

  it("asks for physics/history directly when admission years are after a province transition", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 18,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南京航空航天大学",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const llm = {
      chat: vi.fn().mockResolvedValueOnce(routeJson("admission", {
        schoolNames: ["南京航空航天大学"],
        province: "四川",
        subjectType: null,
        years: [2026],
        queryTypes: ["plan"]
      }))
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const gaokaoCn = {
      sync: vi.fn()
    };
    const admissions = {
      queryPlans: vi.fn(),
      queryScores: vi.fn()
    };
    const processor = new MessageProcessor(
      settings,
      {} as UniversityRepository,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "南航今年四川招生计划",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生查询需要科类");
    expect(result.reply).toContain("四川 2025 年起");
    expect(result.reply).toContain("物理类");
    expect(result.reply).toContain("历史类");
    expect(result.reply).not.toContain("理科”或“文科");
    expect(gaokaoCn.sync).not.toHaveBeenCalled();
  });

  it("uses comprehensive reform automatically for admission queries in 3+3 provinces", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        },
        sync: {
          gaokaoCnRequestDelayMs: 9000,
          gaokaoCnSkipExisting: false
        }
      })
    } as SettingsStore;
    const university = {
      id: 9,
      name: "南京师范大学",
      slug: "nan-jing-shi-fan-da-xue",
      file_path: "docs/universities/nan-jing-shi-fan-da-xue.md",
      source_url: "https://example.com/njnu.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南京师范大学",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn(() => ({
        candidates: [university],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn(() => []),
      queryScores: vi.fn(() => [
        {
          id: 1,
          scoreType: "school",
          universityId: 9,
          universityName: "南京师范大学",
          sourceSchoolId: "358",
          year: 2025,
          provinceName: "浙江",
          subjectType: "综合改革",
          batch: "平行录取一段",
          planGroup: null,
          majorName: null,
          minScore: 642,
          minRank: 17000,
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: null,
          controlScore: null,
          diffScore: null,
          selectionRequirements: null,
          sourceUrl: "https://www.gaokao.cn/school/358/provinceline",
          sourceRecordId: "99",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      getMapping: vi.fn(() => null)
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({ mapped: 1, total: 1 })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["南京师范大学"],
          province: "浙江",
          subjectType: null,
          years: [2025, 2024, 2023],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce("南师大浙江录取位次可以参考综合改革数据。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const universities = {
      getUniversity: vi.fn(() => university)
    } as unknown as UniversityRepository;
    const processor = new MessageProcessor(
      settings,
      universities,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never,
      gaokaoCn as never
    );

    const result = await processor.process({
      platform: "debug",
      text: "南京师范大学在浙江录取位次",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("招生数据回答");
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      provinces: ["浙江"],
      subjectTypes: ["综合改革"],
      requestDelayMs: 0,
      skipExisting: false
    }));
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({
      provinceName: "浙江",
      subjectType: "综合改革"
    }));
  });

  it("continues an admission query after province and subject follow-up answers", async () => {
    const settings = {
      runtime: () => ({
        onebot: { accessToken: "", replyEnabled: true, replyAsImage: true },
        llm: {
          baseUrl: "https://llm.example/v1",
          apiKey: "test-key",
          model: "gpt-5.5",
          temperature: 0.2,
          maxTokens: 1600,
          timeoutMs: 45000
        },
        naturalLanguage: {
          groupNaturalEnabled: true,
          requireMentionInGroup: false,
          contextTtlMinutes: 10,
          cooldownSeconds: 5,
          admissionQaEnabled: true
        }
      })
    } as SettingsStore;
    const university = {
      id: 10,
      name: "南京航空航天大学",
      slug: "nan-jing-hang-kong-hang-tian-da-xue",
      file_path: "docs/universities/nan-jing-hang-kong-hang-tian-da-xue.md",
      source_url: "https://example.com/nuaa.md",
      updated_at: "2026-06-24T00:00:00.000Z",
      matchedBy: "南京航空航天大学",
      score: 0.95
    };
    const nlu = {
      analyze: vi.fn((text: string) => ({
        candidates: text.includes("南航") || text.includes("南京航空航天大学") ? [university] : [],
        reason: "本地学校候选，仅供模型路由参考"
      }))
    } as unknown as NaturalLanguageService;
    const admissions = {
      queryPlans: vi.fn(() => []),
      queryScores: vi.fn(() => [
        {
          id: 1,
          scoreType: "school",
          universityId: 10,
          universityName: "南京航空航天大学",
          sourceSchoolId: "452",
          year: 2025,
          provinceName: "四川",
          subjectType: "理科",
          batch: "本科一批",
          planGroup: null,
          majorName: null,
          minScore: 622,
          minRank: 14500,
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: 120,
          controlScore: null,
          diffScore: null,
          selectionRequirements: null,
          sourceUrl: "https://www.gaokao.cn/school/452/provinceline",
          sourceRecordId: "188",
          rawJson: "{}",
          fetchedAt: "2026-06-25T00:00:00.000Z"
        }
      ]),
      getMapping: vi.fn(() => null)
    };
    const gaokaoCn = {
      sync: vi.fn().mockResolvedValue({ mapped: 1, total: 1 })
    };
    const llm = {
      chat: vi.fn()
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: ["南京航空航天大学"],
          province: null,
          subjectType: null,
          years: [2025, 2024, 2023],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce(routeJson("casual"))
        .mockResolvedValueOnce(routeJson("casual"))
        .mockResolvedValueOnce("南航四川理科近三年分数线可以参考缓存数据。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const universities = {
      getUniversity: vi.fn(() => university)
    } as unknown as UniversityRepository;
    const processor = new MessageProcessor(
      settings,
      universities,
      nlu,
      llm,
      logs,
      undefined,
      undefined,
      admissions as never,
      gaokaoCn as never
    );
    const conversationKey = "private:u1";

    const first = await processor.process({
      platform: "debug",
      text: "南航近三年分数线和位次",
      messageType: "private",
      userId: "u1",
      conversationKey
    });
    const second = await processor.process({
      platform: "debug",
      text: "四川",
      messageType: "private",
      userId: "u1",
      conversationKey
    });
    const third = await processor.process({
      platform: "debug",
      text: "理科",
      messageType: "private",
      userId: "u1",
      conversationKey
    });

    expect(first.reason).toBe("招生查询需要省份");
    expect(second.reason).toBe("招生查询需要科类");
    expect(third.reason).toBe("招生数据回答");
    expect(gaokaoCn.sync).toHaveBeenCalledTimes(1);
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 10,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      planYears: [2026],
      includePlans: true,
      includeScores: false
    }));
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({
      source: "xuefeng_agent",
      universityId: 10,
      provinceName: "四川",
      subjectType: "理科",
      subjectTypes: ["物理类", "理科"],
      years: [2025, 2024, 2023]
    }));
  });
});

function routeJson(
  route: "admission" | "university_info" | "casual" | "ignore",
  overrides: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    route,
    shouldReply: route !== "ignore",
    confidence: 0.9,
    schoolNames: [],
    province: null,
    subjectType: null,
    years: [],
    planGroup: null,
    majorName: null,
    score: null,
    rank: null,
    queryTypes: [],
    topicKey: null,
    topicLabel: null,
    needsFollowUp: false,
    followUpQuestion: null,
    reason: "test route",
    ...overrides
  });
}
