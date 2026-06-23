import { topicLabel } from "../domain/topics.js";
import type { SettingsStore } from "../settings.js";
import type { LlmClient } from "./llm-client.js";
import type { LogStore } from "./log-store.js";
import type { MessageAnalysis, NaturalLanguageService } from "./nlu.js";
import type { UniversityRepository } from "./university-repository.js";

export interface IncomingImage {
  url?: string;
  file?: string;
  summary?: string;
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export interface IncomingMessage {
  platform: "onebot" | "debug";
  text: string;
  images?: IncomingImage[];
  messageType: "private" | "group";
  userId: string;
  groupId?: string;
  conversationKey: string;
  mentionedBot?: boolean;
}

export interface ProcessedMessage {
  handled: boolean;
  reply?: string;
  reason: string;
  analysis?: unknown;
}

interface ConversationContext {
  universityId: number;
  universityName: string;
  expiresAt: number;
}

export class MessageProcessor {
  private readonly contexts = new Map<string, ConversationContext>();
  private readonly cooldown = new Map<string, number>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly universities: UniversityRepository,
    private readonly nlu: NaturalLanguageService,
    private readonly llm: LlmClient,
    private readonly logs: LogStore
  ) {}

  async process(input: IncomingMessage): Promise<ProcessedMessage> {
    this.logs.message({
      direction: "in",
      platform: input.platform,
      conversationKey: input.conversationKey,
      userId: input.userId,
      groupId: input.groupId,
      text: renderLogText(input)
    });

    const runtime = this.settings.runtime();
    if (!runtime.onebot.replyEnabled && input.platform === "onebot") {
      return this.finish(input, { handled: false, reason: "机器人回复已关闭" });
    }

    const now = Date.now();
    const context = this.getContext(input.conversationKey, now);
    const analysis = this.nlu.analyze(input.text, context?.universityId);
    const threshold = runtime.naturalLanguage.confidenceThreshold;
    const greeting = isGreeting(input.text);

    if (input.messageType === "group") {
      if (!runtime.naturalLanguage.groupNaturalEnabled) {
        return this.finish(input, { handled: false, reason: "群聊自然触发已关闭", analysis });
      }
      if (runtime.naturalLanguage.requireMentionInGroup && !input.mentionedBot && !context) {
        return this.finish(input, { handled: false, reason: "群聊需要 @ 机器人", analysis });
      }
    }

    if (input.images?.length) {
      const cooldownKey = `${input.conversationKey}:${input.userId}:image`;
      const nextAllowed = this.cooldown.get(cooldownKey) ?? 0;
      if (input.platform === "onebot" && now < nextAllowed) {
        return this.finish(input, { handled: false, reason: "图片回复冷却中", analysis });
      }
      this.cooldown.set(cooldownKey, now + runtime.naturalLanguage.cooldownSeconds * 1000);

      const reply = await this.answerImageWithLlm(input.text, input.images);
      return this.finish(input, {
        handled: true,
        reason: "图片理解",
        reply,
        analysis
      });
    }

    if (greeting) {
      const reply = await this.answerCasualWithLlm(input.text, analysis, context, "greeting");
      return this.finish(input, {
        handled: true,
        reason: "问候引导",
        reply,
        analysis
      });
    }

    if (!analysis.isUniversityQuery || analysis.confidence < threshold) {
      if (shouldExplainLowConfidence(input, analysis, context)) {
        const reply = await this.answerCasualWithLlm(input.text, analysis, context, "casual-message");
        return this.finish(input, {
          handled: true,
          reason: `转交模型自然回复：${analysis.confidence.toFixed(2)}`,
          reply,
          analysis
        });
      }
      return this.finish(input, { handled: false, reason: `未触发回复：${analysis.confidence.toFixed(2)}`, analysis });
    }

    const cooldownKey = `${input.conversationKey}:${input.userId}`;
    const nextAllowed = this.cooldown.get(cooldownKey) ?? 0;
    if (input.platform === "onebot" && now < nextAllowed) {
      return this.finish(input, { handled: false, reason: "冷却中", analysis });
    }
    this.cooldown.set(cooldownKey, now + runtime.naturalLanguage.cooldownSeconds * 1000);

    let university = analysis.candidates[0] ?? null;
    if (!university && context) {
      university = this.universities.getUniversity(context.universityId) as typeof university;
    }

    if (!university) {
      return this.finish(input, {
        handled: true,
        reason: "需要学校名",
        reply: "我看起来像是在查高校生活资料，但没识别出具体学校。可以直接说“安徽大学宿舍怎么样”这种问法。"
      });
    }

    const similarTop = analysis.candidates.filter((item) => Math.abs(item.score - analysis.candidates[0].score) < 0.01);
    if (similarTop.length > 1) {
      const options = similarTop
        .slice(0, 5)
        .map((item, index) => `${index + 1}. ${item.name}`)
        .join("\n");
      return this.finish(input, {
        handled: true,
        reason: "学校存在歧义",
        reply: `我找到了几个可能的学校：\n${options}\n你可以补充完整学校名或校区名，我再帮你查。`,
        analysis
      });
    }

    const topicKey = analysis.topicKey ?? "general";
    const questions = this.universities.getTopicQuestions(university.id, topicKey, input.text, 6);
    const contextText = questions.length
      ? this.nlu.buildRetrievalContext(university.name, questions)
      : `这次没有检索到 ${university.name} 在“${analysis.topicLabel ?? "这个方向"}”上的 CollegesChat 问卷片段。请如实说明资料缺口，然后可以结合常见大学生活经验、公开常识和理性推断给出建议，但不要把这些补充说成该校问卷事实。`;
    const reply = await this.answerWithLlm({
      userMessage: input.text,
      universityName: university.name,
      topic: analysis.topicLabel ?? topicLabel(topicKey),
      contextText,
      sourceUrl: university.source_url
    });

    const ttlMs = runtime.naturalLanguage.contextTtlMinutes * 60 * 1000;
    this.contexts.set(input.conversationKey, {
      universityId: university.id,
      universityName: university.name,
      expiresAt: now + ttlMs
    });

    return this.finish(input, { handled: true, reason: "已回答", reply, analysis });
  }

  private async answerWithLlm(input: {
    userMessage: string;
    universityName: string;
    topic: string;
    contextText: string;
    sourceUrl: string;
  }): Promise<string> {
    try {
      const answer = await this.llm.chat(
        [
          {
            role: "system",
            content:
              "你是高校生活资料问答助手。请优先基于用户给出的 CollegesChat 问卷资料回答；也可以加入常见大学生活经验、公开常识和理性建议，让回复更完整、更像正常聊天。" +
              "具体到该校的宿舍、管理、食堂、校园网等事实只能来自问卷资料；常识补充要用“一般来说”“通常建议”“如果按常见情况看”等表达，不要包装成该校确定事实。" +
              "资料存在分歧时要明确说存在差异；没有检索到相关问卷片段时也要直接说明资料缺口，然后再给常识性判断或追问建议。" +
              "用户问评价、能不能、适不适合、体验怎么样时，可以展开分析利弊、适用人群和注意事项。回答要适合 QQ 阅读，可分段或列点；简单问题简洁，复杂问题可以更详细，不要强行压缩到几句话。" +
              "不要说这是官方信息。结尾必须包含“数据来自 CollegesChat 问卷，常识建议仅供参考。”"
          },
          {
            role: "user",
            content: `用户问题：${input.userMessage}\n学校：${input.universityName}\n主题：${input.topic}\n资料来源：${input.sourceUrl}\n\n可用问卷资料：\n${input.contextText}`
          }
        ],
        "university-answer"
      );
      if (answer.includes("数据来自 CollegesChat 问卷")) return answer;
      return `${answer}\n\n数据来自 CollegesChat 问卷，常识建议仅供参考。`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `我检索到了 ${input.universityName} 的相关问卷资料，但调用模型总结失败：${message}\n\n数据来自 CollegesChat 问卷，常识建议仅供参考。`;
    }
  }

  private async answerCasualWithLlm(
    userMessage: string,
    analysis: MessageAnalysis,
    context: ConversationContext | null,
    purpose: "greeting" | "casual-message"
  ): Promise<string> {
    const model = this.settings.runtime().llm.model;
    const contextLine = context
      ? `当前对话前文正在查询的学校是：${context.universityName}。`
      : "当前没有已确认的学校上下文。";
    const analysisLine = [
      `本地识别结果：${analysis.isUniversityQuery ? "可能是高校资料问题" : "未确认是高校资料问题"}`,
      `置信度：${analysis.confidence.toFixed(2)}`,
      `主题：${analysis.topicLabel ?? "未识别"}`,
      `候选学校：${analysis.candidates
        .slice(0, 3)
        .map((candidate) => candidate.name)
        .join("、") || "无"}`
    ].join("；");

    try {
      return await this.llm.chat(
        [
          {
            role: "system",
            content:
              `你是 QQ 群/私聊里的高校生活资料助手，也可以自然回应用户的日常闲聊、能力询问和模型询问。` +
              `后台配置的模型 ID 是 ${model}，如果用户问你是什么模型，可以说明“后台配置的模型是 ${model}”，但不要编造供应商或你不知道的内部细节。` +
              "你主要能查高校宿舍、食堂、校园网、外卖、澡堂、早晚自习等生活资料，用户不用命令，直接自然提问即可。" +
              "如果用户的问题像是在问高校资料，但没有明确学校、简称不确定、或没有完成资料检索，不要编造学校资料；请简短追问完整学校名或具体方面。" +
              "请用中文回复，语气自然，适合 QQ 阅读。普通寒暄可以很短；能力介绍、解释类问题可以适当展开，不要固定限制在 120 字以内。"
          },
          {
            role: "user",
            content: `${contextLine}\n${analysisLine}\n\n用户消息：${userMessage}`
          }
        ],
        purpose
      );
    } catch {
      if (purpose === "greeting") return renderGreetingReply();
      return renderCasualFallback(analysis, Boolean(context));
    }
  }

  private async answerImageWithLlm(userMessage: string, images: IncomingImage[]): Promise<string> {
    const usableUrls = images.map((image) => image.url || image.file || "").filter(isImageUrl);
    if (!usableUrls.length) {
      return "我收到图片了，但这条图片消息里没有可传给模型的图片 URL。请确认 NapCat 的图片段包含 url，或者换一种图片发送方式。";
    }

    const text =
      userMessage.trim() ||
      "用户发送了一张图片。请先描述图片内容；如果图片和高校生活资料、学校环境、宿舍、食堂、校园网、通知截图等有关，请结合图片内容给出回应、判断依据和建议。不要编造看不见的信息。";
    const imageUrls = await Promise.all(usableUrls.slice(0, 4).map((url) => prepareImageUrlForLlm(url)));

    try {
      return await this.llm.chat(
        [
          {
            role: "system",
            content:
              "你是 QQ 里的高校生活资料助手。用户发送了图片，可能是学校相关截图、环境照片、通知、聊天截图或普通图片。请基于图片可见内容和用户文字回复；普通图片可以简洁，复杂截图或通知可以适当展开说明。看不清或无法判断时要直接说明。不要编造图片中没有的信息。"
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text
              },
              ...imageUrls.map((url) => ({
                type: "image_url" as const,
                image_url: { url }
              }))
            ]
          }
        ],
        "image-message"
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `我收到图片了，但调用模型识图失败：${message}`;
    }
  }

  private getContext(key: string, now: number): ConversationContext | null {
    const context = this.contexts.get(key);
    if (!context) return null;
    if (context.expiresAt <= now) {
      this.contexts.delete(key);
      return null;
    }
    return context;
  }

  private finish(input: IncomingMessage, result: ProcessedMessage): ProcessedMessage {
    this.logs.message({
      direction: "out",
      platform: input.platform,
      conversationKey: input.conversationKey,
      userId: input.userId,
      groupId: input.groupId,
      text: result.reply ?? "",
      responseText: result.reply ?? null,
      handled: result.handled,
      reason: result.reason
    });
    return result;
  }
}

function renderLogText(input: IncomingMessage): string {
  const imageCount = input.images?.length ?? 0;
  if (!imageCount) return input.text;
  const suffix = `[图片 x${imageCount}]`;
  return input.text.trim() ? `${input.text.trim()} ${suffix}` : suffix;
}

function isImageUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value);
}

async function prepareImageUrlForLlm(url: string): Promise<string> {
  if (url.startsWith("data:image/")) return url;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return url;

    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_IMAGE_BYTES) return url;

    const contentType = normalizeImageContentType(response.headers.get("content-type"), url);
    if (!contentType) return url;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return url;
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    return url;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeImageContentType(contentType: string | null, url: string): string | null {
  const clean = contentType?.split(";")[0]?.trim().toLowerCase();
  if (clean?.startsWith("image/")) return clean;
  if (/\.png(?:$|[?#])/i.test(url)) return "image/png";
  if (/\.jpe?g(?:$|[?#])/i.test(url)) return "image/jpeg";
  if (/\.webp(?:$|[?#])/i.test(url)) return "image/webp";
  if (/\.gif(?:$|[?#])/i.test(url)) return "image/gif";
  return null;
}

function isGreeting(text: string): boolean {
  const normalized = text
    .trim()
    .replace(/^[\s@]+/, "")
    .replace(/[!！?？。~～,.，、\s]+$/g, "")
    .toLowerCase();
  return /^(你好|您好|hello|hi|嗨|哈喽|哈啰|在吗|在不在|有人吗|help|帮助|菜单)$/.test(normalized);
}

function shouldExplainLowConfidence(
  input: IncomingMessage,
  analysis: { isUniversityQuery: boolean },
  context: ConversationContext | null
): boolean {
  if (input.messageType === "private") return true;
  if (input.mentionedBot) return true;
  if (context) return true;
  return analysis.isUniversityQuery;
}

function renderGreetingReply(): string {
  return [
    "你好，我可以帮你查高校生活资料。",
    "不用命令，直接像聊天一样问就行，例如：",
    "安大宿舍怎么样",
    "西电能点外卖吗",
    "南航校园网咋样"
  ].join("\n");
}

function renderCasualFallback(analysis: { isUniversityQuery: boolean }, hasContext: boolean): string {
  if (hasContext) {
    return "我没太理解你想继续查哪个方面。可以直接说“宿舍”“食堂”“校园网”“外卖”“澡堂”等关键词。";
  }

  if (analysis.isUniversityQuery) {
    return "我看起来像是在查高校资料，但没识别清楚学校或问题。可以说得更完整一点，例如“安徽大学宿舍怎么样”或“西电能点外卖吗”。";
  }

  return "我没识别出具体的高校资料问题。可以直接问“安徽大学宿舍怎么样”“西电校园网咋样”“南航能点外卖吗”。";
}
