import { topicLabel } from "../domain/topics.js";
import type { SettingsStore } from "../settings.js";
import type { LlmClient } from "./llm-client.js";
import type { LogStore } from "./log-store.js";
import type { NaturalLanguageService } from "./nlu.js";
import type { UniversityRepository } from "./university-repository.js";

export interface IncomingMessage {
  platform: "onebot" | "debug";
  text: string;
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
      text: input.text
    });

    const runtime = this.settings.runtime();
    if (!runtime.onebot.replyEnabled && input.platform === "onebot") {
      return this.finish(input, { handled: false, reason: "机器人回复已关闭" });
    }

    const now = Date.now();
    const context = this.getContext(input.conversationKey, now);
    const analysis = this.nlu.analyze(input.text, context?.universityId);
    const threshold = runtime.naturalLanguage.confidenceThreshold;

    if (input.messageType === "group") {
      if (!runtime.naturalLanguage.groupNaturalEnabled) {
        return this.finish(input, { handled: false, reason: "群聊自然触发已关闭", analysis });
      }
      if (runtime.naturalLanguage.requireMentionInGroup && !input.mentionedBot && !context) {
        return this.finish(input, { handled: false, reason: "群聊需要 @ 机器人", analysis });
      }
    }

    if (!analysis.isUniversityQuery || analysis.confidence < threshold) {
      return this.finish(input, { handled: false, reason: `置信度不足：${analysis.confidence.toFixed(2)}`, analysis });
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
    if (!questions.length) {
      return this.finish(input, {
        handled: true,
        reason: "没有检索到资料",
        reply: `${university.name} 目前没有检索到“${analysis.topicLabel ?? "这个方向"}”相关问卷资料。数据来自 CollegesChat 问卷库，可能还没人补充。`,
        analysis
      });
    }

    const contextText = this.nlu.buildRetrievalContext(university.name, questions);
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
              "你是高校生活资料问答助手。你只能基于用户给出的 CollegesChat 问卷资料回答，不要编造。资料存在分歧时要明确说存在差异。回答要适合 QQ 阅读，优先 3 到 6 句，避免长篇。不要说这是官方信息。结尾必须包含“数据来自 CollegesChat 问卷，仅供参考。”"
          },
          {
            role: "user",
            content: `用户问题：${input.userMessage}\n学校：${input.universityName}\n主题：${input.topic}\n资料来源：${input.sourceUrl}\n\n可用问卷资料：\n${input.contextText}`
          }
        ],
        "university-answer"
      );
      if (answer.includes("数据来自 CollegesChat 问卷")) return answer;
      return `${answer}\n\n数据来自 CollegesChat 问卷，仅供参考。`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `我检索到了 ${input.universityName} 的相关问卷资料，但调用模型总结失败：${message}\n\n数据来自 CollegesChat 问卷，仅供参考。`;
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

