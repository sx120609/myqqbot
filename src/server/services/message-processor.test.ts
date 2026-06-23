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
  it("uses the LLM for private casual messages instead of the local low-confidence template", async () => {
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
          confidenceThreshold: 0.55,
          contextTtlMinutes: 10,
          cooldownSeconds: 5
        }
      })
    } as SettingsStore;
    const nlu = {
      analyze: vi.fn(() => ({
        isUniversityQuery: false,
        confidence: 0,
        topicKey: null,
        topicLabel: null,
        candidates: [],
        reason: "没有明显高校资料查询意图"
      }))
    } as unknown as NaturalLanguageService;
    const llm = {
      chat: vi.fn().mockResolvedValue("后台配置的模型是 gpt-5.5。")
    } as unknown as LlmClient;
    const logs = {
      message: vi.fn()
    } as unknown as LogStore;

    const processor = new MessageProcessor(
      settings,
      {} as UniversityRepository,
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
    expect(result.reason).toBe("转交模型自然回复：0.00");
    expect(llm.chat).toHaveBeenCalledWith(expect.any(Array), "casual-message");
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
          confidenceThreshold: 0.55,
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
        isUniversityQuery: true,
        confidence: 0.9,
        topicKey: "general",
        topicLabel: "整体评价",
        candidates: [university],
        reason: "命中学校或高校生活关键词"
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

    const processor = new MessageProcessor(settings, universities, nlu, llm, logs, srgaoxiao);

    const result = await processor.process({
      platform: "debug",
      text: "评价中国药科大学",
      messageType: "private",
      userId: "u1",
      conversationKey: "private:u1"
    });

    expect(result.handled).toBe(true);
    expect(result.reason).toBe("已回答");
    expect(llm.chat).toHaveBeenCalledWith(expect.any(Array), "university-answer");
    expect(JSON.stringify(vi.mocked(llm.chat).mock.calls[0][0])).toContain("这次没有检索到 中国药科大学");
    expect(JSON.stringify(vi.mocked(llm.chat).mock.calls[0][0])).toContain("外部院校画像补充资料");
    expect(JSON.stringify(vi.mocked(llm.chat).mock.calls[0][0])).toContain("占地约 2100 亩");
    expect(JSON.stringify(vi.mocked(llm.chat).mock.calls[0][0])).toContain("神人高校网实时评论");
    expect(srgaoxiao.fetchLiveReviewContext).toHaveBeenCalledWith(1, 6);
    expect(String(vi.mocked(llm.chat).mock.calls[0][0][0].content)).toContain("院校定位");
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
          confidenceThreshold: 0.55,
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
        isUniversityQuery: true,
        confidence: 0.85,
        topicKey: "dining",
        topicLabel: "食堂",
        candidates: [university],
        reason: "命中学校或高校生活关键词"
      })),
      buildRetrievalContext: vi.fn()
    } as unknown as NaturalLanguageService;
    const universities = {
      getTopicQuestions: vi.fn(() => [])
    } as unknown as UniversityRepository;
    const llm = {
      chat: vi.fn().mockResolvedValue("这张图可以放在南航食堂吐槽语境里看。")
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
    expect(result.reason).toBe("图片理解");
    expect(llm.chat).toHaveBeenCalledWith(expect.any(Array), "image-message");
    const messages = JSON.stringify(vi.mocked(llm.chat).mock.calls[0][0]);
    expect(messages).toContain("南京航空航天大学");
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
          confidenceThreshold: 0.55,
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
        isUniversityQuery: true,
        confidence: 0.9,
        topicKey: "general",
        topicLabel: "整体评价",
        candidates: [university],
        reason: "命中学校或高校生活关键词"
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
    expect(result.reason).toBe("已回答");
    expect(llm.chat).toHaveBeenCalledWith(expect.any(Array), "university-answer");
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
          confidenceThreshold: 0.55,
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
        isUniversityQuery: true,
        confidence: 0.9,
        topicKey: "general",
        topicLabel: "整体评价",
        candidates: [university],
        reason: "命中学校或高校生活关键词"
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
    expect(llm.chat).toHaveBeenCalledTimes(1);
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
          confidenceThreshold: 0.55,
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
        isUniversityQuery: true,
        confidence: 0.9,
        topicKey: "general",
        topicLabel: "整体评价",
        candidates: [university],
        reason: "命中学校或高校生活关键词"
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
});
