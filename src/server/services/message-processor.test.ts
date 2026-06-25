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
          cooldownSeconds: 5
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

  it("does not use local school candidates when the LLM route omits school names", async () => {
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
          cooldownSeconds: 5
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
      chat: vi.fn().mockResolvedValueOnce(routeJson("university_info", {
        topicKey: "general",
        topicLabel: "整体评价"
      }))
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;
    const universities = {
      getUniversity: vi.fn(() => localCandidate)
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
    expect(result.reason).toBe("需要学校名");
    expect(result.reply).toContain("你想查哪所学校");
    expect(nlu.analyze).not.toHaveBeenCalled();
    expect(vi.mocked(llm.chat)).toHaveBeenCalledTimes(1);
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
          cooldownSeconds: 5
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
          cooldownSeconds: 5
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

  it("does not answer university info from local candidates when the LLM omits school names", async () => {
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
          cooldownSeconds: 5
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
      chat: vi.fn().mockResolvedValueOnce(routeJson("university_info", {
        schoolNames: [],
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
      text: "南航怎么样",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("需要学校名");
    expect(result.reply).toContain("哪所学校");
    expect(universities.getTopicQuestions).not.toHaveBeenCalled();
    expect(llm.chat).toHaveBeenCalledTimes(1);
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
          cooldownSeconds: 5
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
          cooldownSeconds: 5
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
          cooldownSeconds: 5
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
          cooldownSeconds: 5
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
          cooldownSeconds: 0
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
          cooldownSeconds: 5
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

  it("syncs school and major score data for admission score queries", async () => {
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
          cooldownSeconds: 5
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
      queryPlans: vi.fn(() => []),
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
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: 120,
          controlScore: null,
          diffScore: null,
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
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: 118,
          controlScore: null,
          diffScore: null,
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
          avgScore: null,
          avgRank: null,
          maxScore: null,
          planCount: 116,
          controlScore: null,
          diffScore: null,
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
          years: [2025, 2024, 2023],
          queryTypes: ["score", "rank"]
        }))
        .mockResolvedValueOnce("南航四川近三年分数线可以参考缓存数据。")
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
    expect(result.reason).toBe("招生数据回答");
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 7,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      scoreYears: [2025],
      includePlans: false,
      includeScores: true,
      includeSpecialScores: true
    }));
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 7,
      provinces: ["四川"],
      subjectTypes: ["理科"],
      scoreYears: [2024, 2023],
      includePlans: false,
      includeScores: true,
      includeSpecialScores: true
    }));
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 7,
      provinceName: "四川",
      subjectType: "理科",
      subjectTypes: ["物理类", "理科"],
      years: [2025, 2024, 2023]
    }));
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("科类口径提示");
    expect(prompt).toContain("分数趋势摘要");
    expect(prompt).toContain("最低位次区间：14500-17000");
    expect(prompt).toContain("2025 相比 2024 位次前移");
    expect(prompt).toContain("掌上高考来源快照：");
    expect(prompt).toContain("score-school");
    expect(prompt).toContain("item_count=1");
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
          cooldownSeconds: 5
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
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 18,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      scoreYears: [2025],
      includePlans: false,
      includeScores: true
    }));
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 18,
      provinces: ["四川"],
      subjectTypes: ["理科"],
      scoreYears: [2024, 2023],
      includePlans: false,
      includeScores: true
    }));
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({
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
          cooldownSeconds: 5
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
          cooldownSeconds: 5
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
    expect(gaokaoCn.sync).toHaveBeenCalledTimes(4);
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({ universityId: 31, provinces: ["山东"], includePlans: true, includeScores: false }));
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({ universityId: 31, provinces: ["山东"], includePlans: false, includeScores: true }));
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({ universityId: 32, provinces: ["山东"], includePlans: true, includeScores: false }));
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({ universityId: 32, provinces: ["山东"], includePlans: false, includeScores: true }));
    expect(vi.mocked(llm.chat).mock.calls[1][1]).toBe("admission-comparison");
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
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
          cooldownSeconds: 5
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
    const prompt = JSON.stringify(vi.mocked(llm.chat).mock.calls[1][0]);
    expect(prompt).toContain("实时同步结果：已请求掌上高考");
    expect(prompt).toContain("数据状态：本次同步正常完成");
    expect(prompt).toContain("来源快照 2");
    expect(prompt).toContain("掌上高考来源快照：");
    expect(prompt).toContain("plan-major");
    expect(prompt).toContain("item_count=0");
    expect(prompt).not.toContain("分数年份提示");
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      topic: "招生数据",
      sourceUrl: "https://www.gaokao.cn/school/67",
      contextText: expect.stringContaining("本次同步来源快照数：2")
    }));
    expect(answerSources.create).toHaveBeenCalledWith(expect.objectContaining({
      contextText: expect.stringContaining("掌上高考来源快照：")
    }));
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
          cooldownSeconds: 5
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
    expect(gaokaoCn.sync).not.toHaveBeenCalled();
    expect(admissions.queryScores).not.toHaveBeenCalled();
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
          cooldownSeconds: 5
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
      subjectTypes: ["综合改革"]
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
          cooldownSeconds: 5
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
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: [],
          province: "四川",
          subjectType: null,
          years: [],
          queryTypes: []
        }))
        .mockResolvedValueOnce(routeJson("admission", {
          schoolNames: [],
          province: null,
          subjectType: "理科",
          years: [],
          queryTypes: []
        }))
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
    expect(gaokaoCn.sync).toHaveBeenCalledTimes(2);
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 10,
      provinces: ["四川"],
      subjectTypes: ["物理类"],
      scoreYears: [2025],
      includeScores: true
    }));
    expect(gaokaoCn.sync).toHaveBeenCalledWith(expect.objectContaining({
      universityId: 10,
      provinces: ["四川"],
      subjectTypes: ["理科"],
      scoreYears: [2024, 2023],
      includeScores: true
    }));
    expect(admissions.queryScores).toHaveBeenCalledWith(expect.objectContaining({
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
    majorName: null,
    queryTypes: [],
    topicKey: null,
    topicLabel: null,
    needsFollowUp: false,
    followUpQuestion: null,
    reason: "test route",
    ...overrides
  });
}
