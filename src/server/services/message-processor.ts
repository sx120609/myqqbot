import { TOPICS, topicLabel } from "../domain/topics.js";
import type { SettingsStore } from "../settings.js";
import { ADMISSION_SOURCE, normalizePlanGroup, normalizeProvinceName } from "./admission-repository.js";
import type { AdmissionPlanRow, AdmissionRepository, AdmissionScoreRow, AdmissionSourceRow } from "./admission-repository.js";
import {
  currentAdmissionDate,
  currentAdmissionYear,
  defaultAdmissionPlanYears,
  defaultAdmissionScoreYearRange,
  defaultAdmissionScoreYears
} from "./admission-calendar.js";
import { gaokaoProvinceNames } from "./admission-regions.js";
import type { LlmClient } from "./llm-client.js";
import type { LogStore } from "./log-store.js";
import type { AnswerSourceInput, AnswerSourceStore } from "./answer-source-store.js";
import { isGaokaoCnRateLimitError, type GaokaoCnAdapter, type GaokaoCnSyncResult } from "./gaokao-cn-adapter.js";
import type { MessageAnalysis, NaturalLanguageService } from "./nlu.js";
import type { SrgaoxiaoSyncService } from "./srgaoxiao-sync.js";
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
  progressNotice?: (text: string) => Promise<{ close: () => Promise<void> } | null>;
}

export interface ProcessedMessage {
  handled: boolean;
  reply?: string;
  sourcePageUrl?: string;
  reason: string;
  analysis?: unknown;
}

interface ConversationContext {
  universityId: number;
  universityName: string;
  expiresAt: number;
  pendingAdmission?: AdmissionFollowUpContext;
}

interface ImageSchoolContext {
  universityId: number;
  universityName: string;
  topic: string;
  sourceUrl: string;
  contextText: string;
  schoolProfileText: string | null;
}

interface ComparisonSchoolContext extends ImageSchoolContext {
  srgaoxiaoReviewsText: string | null;
}

interface AdmissionIntent {
  isAdmissionQuery: boolean;
  confidence: number;
  schoolNames: string[];
  province: string | null;
  subjectType: string | null;
  years: number[];
  planGroup: string | null;
  majorName: string | null;
  queryTypes: Array<"plan" | "score" | "rank" | "major_score" | "trend" | "compare">;
  needsFollowUp: boolean;
  followUpQuestion: string | null;
  reason: string;
}

interface AdmissionFollowUpContext {
  province: string | null;
  subjectType: string | null;
  years: number[];
  planGroup: string | null;
  majorName: string | null;
  queryTypes: AdmissionIntent["queryTypes"];
}

interface MessageRouteIntent extends AdmissionIntent {
  route: "admission" | "university_info" | "casual" | "ignore";
  shouldReply: boolean;
  topicKey: string | null;
  topicLabel: string | null;
}

interface AdmissionSyncSummary {
  total: number;
  candidateTotal: number;
  offset: number;
  nextOffset: number;
  mapped: number;
  planRows: number;
  schoolScoreRows: number;
  majorScoreRows: number;
  sourceRows: number;
  sourceRequests: number;
  sourceRequestBudget: number | null;
  requestBudgetExhausted: boolean;
  skippedRequests: number;
  skipped: number;
  errorCount: number;
}

type ResolvedUniversity = NonNullable<ReturnType<UniversityRepository["getUniversity"]>>;

interface AdmissionSchoolData {
  university: ResolvedUniversity;
  sourceUrl: string | null;
  plans: AdmissionPlanRow[];
  scores: AdmissionScoreRow[];
  sourceSnapshots: AdmissionSourceRow[];
  schoolProfileText: string | null;
  syncSummary: AdmissionSyncSummary | null;
  syncError: string | null;
  contextText: string;
}

interface AdmissionRealtimeSyncBudget {
  initial: number | null;
  remaining: number | null;
}

export class MessageProcessor {
  private readonly contexts = new Map<string, ConversationContext>();
  private readonly cooldown = new Map<string, number>();

  constructor(
    private readonly settings: SettingsStore,
    private readonly universities: UniversityRepository,
    private readonly nlu: NaturalLanguageService,
    private readonly llm: LlmClient,
    private readonly logs: LogStore,
    private readonly srgaoxiao?: SrgaoxiaoSyncService,
    private readonly answerSources?: AnswerSourceStore,
    private readonly admissions?: AdmissionRepository,
    private readonly gaokaoCn?: GaokaoCnAdapter
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

    if (input.messageType === "group") {
      if (runtime.naturalLanguage.requireMentionInGroup && !input.mentionedBot) {
        return this.finish(input, { handled: false, reason: "群聊需要 @ 机器人" });
      }
      if (!runtime.naturalLanguage.groupNaturalEnabled && !input.mentionedBot) {
        return this.finish(input, { handled: false, reason: "群聊自然触发已关闭" });
      }
    }

    let routeIntent = await this.analyzeMessageRouteWithLlm(input, context);
    routeIntent = this.mergeAdmissionFollowUp(routeIntent, context, input.text);
    const shouldReply = routeIntent?.shouldReply || input.messageType === "private" || input.mentionedBot;
    const analysis =
      routeIntent && shouldReply && routeIntent.route !== "ignore" && shouldResolveUniversitiesLocally(routeIntent)
        ? this.nlu.analyze(routeIntent.schoolNames.join(" "), context?.universityId)
        : emptyMessageAnalysis();
    if (!routeIntent || routeIntent.route === "ignore" || !shouldReply) {
      return this.finish(input, { handled: false, reason: "模型判断无需回复", analysis: { routeIntent, schoolAnalysis: analysis } });
    }

    if (input.images?.length) {
      const cooldownKey = `${input.conversationKey}:${input.userId}:image`;
      const nextAllowed = this.cooldown.get(cooldownKey) ?? 0;
      if (input.platform === "onebot" && now < nextAllowed) {
        return this.finish(input, { handled: false, reason: "图片回复冷却中", analysis: { routeIntent, schoolAnalysis: analysis } });
      }
      this.cooldown.set(cooldownKey, now + runtime.naturalLanguage.cooldownSeconds * 1000);

      const schoolContext = this.buildImageSchoolContext(routeIntent, analysis, input.conversationKey, now, input.text);
      const reply = await this.answerImageWithLlm(input.text, input.images, analysis, schoolContext, routeIntent);
      const sourcePageUrl = schoolContext
        ? this.createAnswerSourcePage({
            question: input.text.trim() || "[图片消息]",
            universityId: schoolContext.universityId,
            universityName: schoolContext.universityName,
            topic: schoolContext.topic,
            sourceUrl: schoolContext.sourceUrl,
            contextText: schoolContext.contextText,
            schoolProfileText: schoolContext.schoolProfileText,
            srgaoxiaoReviewsText: null,
            answerText: reply
          })
        : undefined;
      if (schoolContext) {
        const ttlMs = runtime.naturalLanguage.contextTtlMinutes * 60 * 1000;
        this.contexts.set(input.conversationKey, {
          universityId: schoolContext.universityId,
          universityName: schoolContext.universityName,
          expiresAt: now + ttlMs
        });
      }
      return this.finish(input, {
        handled: true,
        reason: "模型判断为图片消息",
        reply,
        sourcePageUrl,
        analysis: { routeIntent, schoolAnalysis: analysis }
      });
    }

    if (routeIntent.route === "admission") {
      const admissionReply = await this.answerAdmissionQuery(input, routeIntent, analysis, now);
      return this.finish(input, admissionReply);
    }

    if (routeIntent.route === "casual") {
      const reply = await this.answerCasualWithLlm(input.text, context, "casual-message");
      return this.finish(input, {
        handled: true,
        reason: "模型判断为普通对话",
        reply,
        analysis: { routeIntent, schoolAnalysis: analysis }
      });
    }

    const cooldownKey = `${input.conversationKey}:${input.userId}`;
    const nextAllowed = this.cooldown.get(cooldownKey) ?? 0;
    if (input.platform === "onebot" && now < nextAllowed) {
      return this.finish(input, { handled: false, reason: "冷却中", analysis });
    }
    this.cooldown.set(cooldownKey, now + runtime.naturalLanguage.cooldownSeconds * 1000);

    const comparisonSchools = this.resolveComparisonUniversities(routeIntent, analysis);
    if (comparisonSchools.length > 1) {
      const topicKey = normalizeTopicKey(routeIntent.topicKey) ?? "general";
      const topic = routeIntent.topicLabel ?? topicLabel(topicKey);
      const schools = await this.buildComparisonSchoolContexts(comparisonSchools, topicKey, topic, input.text);
      const reply = await this.answerComparisonWithLlm({
        userMessage: input.text,
        topic,
        schools
      });
      const sourcePageUrl = this.createAnswerSourcePage({
        question: input.text,
        universityId: null,
        universityName: schools.map((school) => school.universityName).join(" / "),
        topic,
        sourceUrl: null,
        contextText: schools
          .map((school) => `## ${school.universityName}\nCollegesChat 资料来源：${school.sourceUrl}\n\n${school.contextText}`)
          .join("\n\n---\n\n"),
        schoolProfileText: schools
          .map((school) => `## ${school.universityName}\n${school.schoolProfileText ?? "本地没有外部院校画像补充资料。"}`)
          .join("\n\n---\n\n"),
        srgaoxiaoReviewsText: schools
          .map((school) => `## ${school.universityName}\n${school.srgaoxiaoReviewsText ?? "本次未调用实时评论，或没有可用评论资料。"}`)
          .join("\n\n---\n\n"),
        answerText: reply
      });

      return this.finish(input, {
        handled: true,
        reason: "多校对比回答",
        reply,
        sourcePageUrl,
        analysis: { routeIntent, schoolAnalysis: analysis }
      });
    }

    const ambiguousSchools = this.findAmbiguousRouteCandidates(routeIntent, analysis);
    if (ambiguousSchools.length > 1) {
      const options = ambiguousSchools
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

    const university = this.resolveRouteUniversity(routeIntent, analysis, input.conversationKey, now);

    if (!university) {
      return this.finish(input, {
        handled: true,
        reason: "需要学校名",
        reply: routeIntent.followUpQuestion || "你想查哪所学校？可以直接说完整学校名。"
      });
    }

    const topicKey = normalizeTopicKey(routeIntent.topicKey) ?? "general";
    const topic = routeIntent.topicLabel ?? topicLabel(topicKey);
    const questions = this.universities.getTopicQuestions(university.id, topicKey, input.text, 6);
    const contextText = questions.length
      ? this.nlu.buildRetrievalContext(university.name, questions)
      : `这次没有检索到 ${university.name} 在“${topic}”上的 CollegesChat 问卷片段。请先基于公开常识给出院校定位，再如实说明生活体验问卷资料缺口，然后可以结合常见大学生活经验、公开常识和理性推断给出建议，但不要把这些补充说成该校问卷事实。`;
    const schoolProfile = this.universities.getSchoolProfile?.(university.id, "srgaoxiao");
    const srgaoxiaoReviewsText = await this.maybeFetchSrgaoxiaoReviews(
      university.id,
      schoolProfile?.profileText ?? null
    );
    const reply = await this.answerWithLlm({
      userMessage: input.text,
      universityName: university.name,
      topic,
      contextText,
      schoolProfileText: schoolProfile?.profileText ?? null,
      srgaoxiaoReviewsText,
      sourceUrl: university.source_url
    });
    const sourcePageUrl = this.createAnswerSourcePage({
      question: input.text,
      universityId: university.id,
      universityName: university.name,
      topic,
      sourceUrl: university.source_url,
      contextText,
      schoolProfileText: schoolProfile?.profileText ?? null,
      srgaoxiaoReviewsText,
      answerText: reply
    });

    const ttlMs = runtime.naturalLanguage.contextTtlMinutes * 60 * 1000;
    this.contexts.set(input.conversationKey, {
      universityId: university.id,
      universityName: university.name,
      expiresAt: now + ttlMs
    });

    return this.finish(input, { handled: true, reason: "模型判断为高校资料回答", reply, sourcePageUrl, analysis: { routeIntent, schoolAnalysis: analysis } });
  }

  private async analyzeMessageRouteWithLlm(
    input: IncomingMessage,
    context: ConversationContext | null
  ): Promise<MessageRouteIntent | null> {
    const topicOptions = TOPICS.map((topic) => `${topic.key}:${topic.label}`).join("，");
    const contextLine = renderRouteContextLine(context);
    const today = currentAdmissionDate();
    const currentYear = currentAdmissionYear();

    try {
      const text = await this.llm.chat(
        [
          {
            role: "system",
            content:
              "你是 QQBot 的入口路由器。你的任务是理解用户自然语言，判断这条消息应该进入哪个处理分支。" +
              "这是唯一入口：程序不会再用关键词或低置信度模板抢先决定回复类型。" +
              "不要使用固定关键词思维；要根据整句语义、上下文、是否在群聊被提及、是否包含图片来判断。" +
              "route 只能是 admission、university_info、casual、ignore。" +
              "admission 表示高校招生数据查询，例如招生计划、招生人数、历年录取分、最低位次、专业录取分、报考趋势、录取对比。" +
              "university_info 表示高校资料/校园生活/院校评价/学校对比，例如宿舍、食堂、校园网、外卖、澡堂、管理、学校怎么样、两校怎么选。" +
              "casual 表示应该正常闲聊、看图闲聊、解释图片、或回答能力/模型/使用方式问题。ignore 表示群聊里没有必要回复的旁观消息。" +
              "私聊或明确 @ 机器人时，除非是明显垃圾内容，否则 shouldReply 通常为 true；未 @ 的群聊普通路人闲聊 shouldReply 可为 false。" +
              "如果消息含图片且需要回复，请仍然选择最接近的 route；后续图片理解会按你的 route 和学校/主题字段组织资料。" +
              "只输出一个 JSON 对象，不要 Markdown，不要解释。字段：" +
              "route:string, shouldReply:boolean, confidence:number, schoolNames:string[], province:string|null, subjectType:string|null, years:number[], planGroup:string|null, majorName:string|null, queryTypes:string[], topicKey:string|null, topicLabel:string|null, needsFollowUp:boolean, followUpQuestion:string|null, reason:string。" +
              "confidence 只用于调试记录，程序不会因为低置信度拒绝回复。" +
              "queryTypes 只能使用 plan, score, rank, major_score, trend, compare。subjectType 可用 物理类、历史类、理科、文科、综合改革 或 null。planGroup 用于院校专业组/专业组代码，例如 03组、第03专业组、9001-L005；没有则为 null。" +
              `topicKey 如果是高校生活资料，请从这些 key 中选一个或返回 general：${topicOptions}。`
          },
          {
            role: "user",
            content:
              `${contextLine}\n` +
              `消息场景：${input.messageType === "group" ? "群聊" : "私聊"}；是否 @ 机器人：${input.mentionedBot ? "是" : "否"}。\n` +
              `是否包含图片：${input.images?.length ? `是，${input.images.length} 张` : "否"}。\n` +
              "程序不会提供本地关键词候选。请你直接从用户原话和上下文中理解是否涉及学校、涉及哪些学校、属于哪类请求。\n" +
              `当前日期：${today}。${currentYear} 年招生计划通常可查；${currentYear} 录取分数线和位次要等各省录取后才陆续出现。\n\n` +
              `用户消息：${input.text}`
          }
        ],
        "message-route"
      );
      return normalizeMessageRouteIntent(parseJsonObject(text));
    } catch {
      if (input.messageType === "private" || input.mentionedBot) {
        return {
          route: "casual",
          shouldReply: true,
          isAdmissionQuery: false,
          confidence: 0.5,
          schoolNames: [],
          province: null,
          subjectType: null,
          years: [],
          planGroup: null,
          majorName: null,
          queryTypes: [],
          topicKey: null,
          topicLabel: null,
          needsFollowUp: false,
          followUpQuestion: null,
          reason: "模型路由失败，转普通回复"
        };
      }
      return null;
    }
  }

  private mergeAdmissionFollowUp(
    routeIntent: MessageRouteIntent | null,
    context: ConversationContext | null,
    messageText: string
  ): MessageRouteIntent | null {
    if (!context) return routeIntent;
    const pending = context.pendingAdmission;
    if (!pending) return routeIntent;
    const localSlots = extractAdmissionFollowUpSlots(messageText);
    const hasLocalSlots = Boolean(localSlots.province || localSlots.subjectType || localSlots.years.length);
    if (!routeIntent) {
      if (!hasLocalSlots) return null;
      return {
        route: "admission",
        shouldReply: true,
        isAdmissionQuery: true,
        confidence: 0.78,
        schoolNames: [context.universityName],
        province: localSlots.province ?? pending.province,
        subjectType: localSlots.subjectType ?? pending.subjectType,
        years: localSlots.years.length ? localSlots.years : pending.years,
        planGroup: pending.planGroup,
        majorName: pending.majorName,
        queryTypes: pending.queryTypes,
        topicKey: null,
        topicLabel: null,
        needsFollowUp: false,
        followUpQuestion: null,
        reason: "本地续接上一次招生追问"
      };
    }
    const hasAdmissionSlots = Boolean(
      routeIntent.route === "admission" ||
        routeIntent.province ||
        routeIntent.subjectType ||
        routeIntent.planGroup ||
        routeIntent.majorName ||
        routeIntent.years.length ||
        routeIntent.queryTypes.length
    );
    if (!hasAdmissionSlots && !hasLocalSlots) return routeIntent;
    return {
      ...routeIntent,
      route: "admission",
      shouldReply: true,
      isAdmissionQuery: true,
      schoolNames: routeIntent.schoolNames.length ? routeIntent.schoolNames : [context.universityName],
      province: routeIntent.province ?? localSlots.province ?? pending.province,
      subjectType: routeIntent.subjectType ?? localSlots.subjectType ?? pending.subjectType,
      years: routeIntent.years.length ? routeIntent.years : localSlots.years.length ? localSlots.years : pending.years,
      planGroup: routeIntent.planGroup ?? pending.planGroup,
      majorName: routeIntent.majorName ?? pending.majorName,
      queryTypes: routeIntent.queryTypes.length ? routeIntent.queryTypes : pending.queryTypes,
      reason: [routeIntent.reason, hasLocalSlots ? "本地续接上一次招生追问" : "续接上一次招生追问"].filter(Boolean).join("；")
    };
  }

  private async answerAdmissionQuery(
    input: IncomingMessage,
    intent: AdmissionIntent,
    analysis: MessageAnalysis,
    now: number
  ): Promise<ProcessedMessage> {
    if (!this.admissions) {
      return { handled: true, reason: "招生数据未启用", reply: "招生数据模块还没有启用，暂时不能查询分数线和招生计划。" };
    }

    const universities = this.resolveAdmissionUniversities(intent, analysis, input.conversationKey, now);
    const university = universities[0];
    if (!university) {
      return {
        handled: true,
        reason: "招生查询需要学校名",
        reply: intent.followUpQuestion || "你想查哪所学校的招生计划或分数线？可以直接说完整学校名。"
      };
    }

    if (!intent.province) {
      this.setAdmissionFollowUpContext(input.conversationKey, university, intent, now, {
        province: null,
        subjectType: intent.subjectType
      });
      return {
        handled: true,
        reason: "招生查询需要省份",
        reply: intent.followUpQuestion || `你想看 ${university.name} 在哪个省份的招生计划或分数线？`
      };
    }

    const years = buildAdmissionYears(intent);
    const province = normalizeAdmissionProvince(intent.province);
    const subjectType = intent.subjectType ?? inferAdmissionSubjectType(province);
    const syncKinds = pickAdmissionSyncKinds(intent);
    if (!subjectType) {
      this.setAdmissionFollowUpContext(input.conversationKey, university, intent, now, {
        province,
        subjectType: null
      });
      return {
        handled: true,
        reason: "招生查询需要科类",
        reply: renderAdmissionSubjectFollowUpQuestion(university.name, province, years, syncKinds)
      };
    }
    const realtimeSyncBudget = this.createAdmissionRealtimeSyncBudget();
    if (universities.length > 1) {
      const schoolData: AdmissionSchoolData[] = [];
      for (const school of universities.slice(0, 3)) {
        schoolData.push(await this.buildAdmissionSchoolData(school, intent, province, subjectType, years, syncKinds, realtimeSyncBudget));
      }
      const contextText = renderAdmissionComparisonContext({
        userMessage: input.text,
        province,
        subjectType,
        planGroup: intent.planGroup,
        majorName: intent.majorName,
        schools: schoolData
      });
      const reply = await this.answerAdmissionComparisonWithLlm({
        userMessage: input.text,
        province,
        subjectType,
        planGroup: intent.planGroup,
        majorName: intent.majorName,
        schools: schoolData,
        contextText
      });
      const sourcePageUrl = this.createAnswerSourcePage({
        question: input.text,
        universityId: null,
        universityName: schoolData.map((school) => school.university.name).join(" / "),
        topic: "招生数据",
        sourceUrl: null,
        contextText,
        schoolProfileText: schoolData
          .map((school) => `## ${school.university.name}\n${school.schoolProfileText ?? "本地没有掌上高考院校基础信息。"}`)
          .join("\n\n"),
        srgaoxiaoReviewsText: null,
        answerText: reply
      });

      const ttlMs = this.settings.runtime().naturalLanguage.contextTtlMinutes * 60 * 1000;
      this.contexts.set(input.conversationKey, {
        universityId: university.id,
        universityName: university.name,
        expiresAt: now + ttlMs
      });

      return {
        handled: true,
        reason: "招生数据对比回答",
        reply,
        sourcePageUrl,
        analysis: { admissionIntent: intent, schoolAnalysis: analysis }
      };
    }

    const data = await this.buildAdmissionSchoolData(university, intent, province, subjectType, years, syncKinds, realtimeSyncBudget);
    const reply = await this.answerAdmissionWithLlm({
      userMessage: input.text,
      universityName: university.name,
      province,
      subjectType,
      planGroup: intent.planGroup,
      majorName: intent.majorName,
      plans: data.plans,
      scores: data.scores,
      contextText: data.contextText,
      syncError: data.syncError
    });
    const sourcePageUrl = this.createAnswerSourcePage({
      question: input.text,
      universityId: university.id,
      universityName: university.name,
      topic: "招生数据",
      sourceUrl: data.sourceUrl,
      contextText: data.contextText,
      schoolProfileText: data.schoolProfileText,
      srgaoxiaoReviewsText: null,
      answerText: reply
    });

    const ttlMs = this.settings.runtime().naturalLanguage.contextTtlMinutes * 60 * 1000;
    this.contexts.set(input.conversationKey, {
      universityId: university.id,
      universityName: university.name,
      expiresAt: now + ttlMs
    });

    return {
      handled: true,
      reason: "招生数据回答",
      reply,
      sourcePageUrl,
      analysis: { admissionIntent: intent, schoolAnalysis: analysis }
    };
  }

  private setAdmissionFollowUpContext(
    conversationKey: string,
    university: NonNullable<ReturnType<UniversityRepository["getUniversity"]>>,
    intent: AdmissionIntent,
    now: number,
    values: Pick<AdmissionFollowUpContext, "province" | "subjectType">
  ): void {
    const ttlMs = this.settings.runtime().naturalLanguage.contextTtlMinutes * 60 * 1000;
    this.contexts.set(conversationKey, {
      universityId: university.id,
      universityName: university.name,
      expiresAt: now + ttlMs,
      pendingAdmission: {
        province: values.province,
        subjectType: values.subjectType,
        years: intent.years,
        planGroup: intent.planGroup,
        majorName: intent.majorName,
        queryTypes: intent.queryTypes
      }
    });
  }

  private resolveAdmissionUniversities(
    intent: AdmissionIntent,
    analysis: MessageAnalysis,
    conversationKey: string,
    now: number
  ): ResolvedUniversity[] {
    const schools: ResolvedUniversity[] = [];
    const seen = new Set<number>();
    for (const schoolName of intent.schoolNames) {
      const university = this.resolveUniversityName(schoolName, analysis);
      if (!university || seen.has(university.id)) continue;
      seen.add(university.id);
      schools.push(university);
    }
    if (schools.length) return schools;
    const context = this.getContext(conversationKey, now);
    const contextSchool = context ? this.universities.getUniversity(context.universityId) : null;
    return contextSchool ? [contextSchool] : [];
  }

  private createAdmissionRealtimeSyncBudget(): AdmissionRealtimeSyncBudget {
    const runtime = this.settings.runtime() as { sync?: { gaokaoCnMaxRequestsPerRun?: number } };
    const value = runtime.sync?.gaokaoCnMaxRequestsPerRun;
    if (value === undefined || !Number.isFinite(value) || value <= 0) {
      return { initial: null, remaining: null };
    }
    const max = Math.floor(value);
    return { initial: max, remaining: max };
  }

  private async buildAdmissionSchoolData(
    university: ResolvedUniversity,
    intent: AdmissionIntent,
    province: string,
    subjectType: string,
    years: ReturnType<typeof buildAdmissionYears>,
    syncKinds: ReturnType<typeof pickAdmissionSyncKinds>,
    realtimeSyncBudget?: AdmissionRealtimeSyncBudget
  ): Promise<AdmissionSchoolData> {
    let syncError: string | null = null;
    let syncSummary: AdmissionSyncSummary | null = null;
    const subjectTypes = compatibleAdmissionSubjectTypes(subjectType, province);
    if (this.gaokaoCn) {
      try {
        const syncResults: GaokaoCnSyncResult[] = [];
        const syncSettings = this.settings.runtime().sync;
        const requestDelayMs = syncSettings?.gaokaoCnRequestDelayMs;
        const rateLimitCooldownMinutes = syncSettings?.gaokaoCnRateLimitCooldownMinutes;
        const maxSourceRequests = syncSettings?.gaokaoCnMaxRequestsPerRun;
        const skipExisting = syncSettings?.gaokaoCnSkipExisting ?? true;
        const rateLimitStatus = (this.gaokaoCn as GaokaoCnAdapter & {
          rateLimitStatus?: () => { active?: boolean; until?: string | null };
        }).rateLimitStatus?.();
        if (rateLimitStatus?.active) {
          syncError = `掌上高考当前处于限流冷却中，预计 ${rateLimitStatus.until ?? "稍后"} 后再恢复实时补数；本次优先使用本地缓存资料回答。`;
        } else {
          const includePlanDetails = shouldSyncPlanDetails(intent);
          const includeSpecialScores = shouldSyncMajorScores(intent);
          let stopRealtimeSync = false;
          if (syncKinds.includePlans) {
            for (const group of groupYearsByAdmissionSubjectTypes(province, subjectType, years.planYears)) {
              if (!hasAdmissionRealtimeSyncBudget(realtimeSyncBudget)) {
                stopRealtimeSync = true;
                break;
              }
              const result = await this.gaokaoCn.sync({
                universityId: university.id,
                provinces: [province],
                subjectTypes: group.subjectTypes,
                planYears: group.years,
                includePlans: true,
                includeScores: false,
                includeSpecialScores: false,
                includePlanDetails,
                requestDelayMs,
                rateLimitCooldownMinutes,
                maxSourceRequests: admissionRealtimeMaxSourceRequests(realtimeSyncBudget, maxSourceRequests),
                skipExisting
              });
              syncResults.push(result);
              consumeAdmissionRealtimeSyncBudget(realtimeSyncBudget, result);
              if (hasGaokaoRateLimitSyncResult(result)) {
                syncError = "掌上高考当前触发限流，本次已停止继续实时补数；下面会优先使用本地缓存资料回答。";
                stopRealtimeSync = true;
                break;
              }
              if (result.requestBudgetExhausted || !hasAdmissionRealtimeSyncBudget(realtimeSyncBudget)) {
                stopRealtimeSync = true;
                break;
              }
            }
          }
          if (syncKinds.includeScores && !stopRealtimeSync) {
            for (const group of groupYearsByAdmissionSubjectTypes(province, subjectType, years.scoreYears)) {
              if (!hasAdmissionRealtimeSyncBudget(realtimeSyncBudget)) break;
              const result = await this.gaokaoCn.sync({
                universityId: university.id,
                provinces: [province],
                subjectTypes: group.subjectTypes,
                scoreYears: group.years,
                includePlans: false,
                includeScores: true,
                includeSpecialScores,
                requestDelayMs,
                rateLimitCooldownMinutes,
                maxSourceRequests: admissionRealtimeMaxSourceRequests(realtimeSyncBudget, maxSourceRequests),
                skipExisting
              });
              syncResults.push(result);
              consumeAdmissionRealtimeSyncBudget(realtimeSyncBudget, result);
              if (hasGaokaoRateLimitSyncResult(result)) {
                syncError = "掌上高考当前触发限流，本次已停止继续实时补数；下面会优先使用本地缓存资料回答。";
                break;
              }
              if (result.requestBudgetExhausted || !hasAdmissionRealtimeSyncBudget(realtimeSyncBudget)) break;
            }
          }
          syncSummary = summarizeAdmissionSyncResults(syncResults);
        }
      } catch (error) {
        syncError = error instanceof Error ? error.message : String(error);
      }
    }

    let planMajorFallback = false;
    let scoreMajorFallback = false;
    let plans = this.admissions!.queryPlans({
      universityId: university.id,
      provinceName: province,
      subjectType,
      subjectTypes,
      years: years.planYears,
      planGroup: intent.planGroup,
      majorName: intent.majorName,
      limit: 80
    });
    let scores = this.admissions!.queryScores({
      universityId: university.id,
      provinceName: province,
      subjectType,
      subjectTypes,
      years: years.scoreYears,
      planGroup: intent.planGroup,
      majorName: intent.majorName,
      limit: 120
    });
    if (intent.majorName && !scores.length) {
      scores = this.admissions!.queryScores({
        universityId: university.id,
        provinceName: province,
        subjectType,
        subjectTypes,
        years: years.scoreYears,
        planGroup: intent.planGroup,
        limit: 80
      });
      scoreMajorFallback = scores.length > 0;
    }
    if (intent.majorName && !plans.length) {
      plans = this.admissions!.queryPlans({
        universityId: university.id,
        provinceName: province,
        subjectType,
        subjectTypes,
        years: years.planYears,
        planGroup: intent.planGroup,
        limit: 40
      });
      planMajorFallback = plans.length > 0;
    }

    const sourceSnapshots = this.collectAdmissionSourceSnapshots(university.id, plans, scores, syncSummary);
    const schoolProfile = this.universities.getSchoolProfile?.(university.id, ADMISSION_SOURCE);
    const schoolProfileText = schoolProfile?.profileText ?? null;
    const contextText = renderAdmissionContext({
      universityName: university.name,
      province,
      subjectType,
      subjectTypes,
      planGroup: intent.planGroup,
      majorName: intent.majorName,
      planMajorFallback,
      scoreMajorFallback,
      plans,
      scores,
      schoolProfileText,
      sourceSnapshots,
      unavailableScoreYears: syncKinds.includeScores ? years.unavailableScoreYears : [],
      syncSummary,
      syncError
    });
    const mapping = this.admissions!.getMapping(university.id);
    return {
      university,
      sourceUrl: mapping?.sourceUrl ?? university.source_url,
      plans,
      scores,
      sourceSnapshots,
      schoolProfileText,
      syncSummary,
      syncError,
      contextText
    };
  }

  private collectAdmissionSourceSnapshots(
    universityId: number,
    plans: AdmissionPlanRow[],
    scores: AdmissionScoreRow[],
    syncSummary: AdmissionSyncSummary | null
  ): AdmissionSourceRow[] {
    if (!this.admissions) return [];
    const repository = this.admissions as AdmissionRepository & {
      getSource?: (id: number) => AdmissionSourceRow | null;
      listSources?: (query: { universityId?: number; limit?: number }) => AdmissionSourceRow[];
    };
    const sourceIds = Array.from(
      new Set(
        [...plans, ...scores]
          .map((row) => Number(row.sourceRecordId))
          .filter((value) => Number.isFinite(value) && value > 0)
      )
    );
    const snapshots = sourceIds
      .slice(0, 12)
      .map((id) => repository.getSource?.(id) ?? null)
      .filter((row): row is AdmissionSourceRow => Boolean(row));
    if (syncSummary?.sourceRows && snapshots.length < Math.min(12, syncSummary.sourceRows)) {
      const seen = new Set(snapshots.map((row) => row.id));
      const recentSnapshots = repository.listSources?.({ universityId, limit: Math.min(12, syncSummary.sourceRows) }) ?? [];
      for (const row of recentSnapshots) {
        if (seen.has(row.id)) continue;
        snapshots.push(row);
        seen.add(row.id);
        if (snapshots.length >= 12) break;
      }
    }
    return snapshots;
  }

  private resolveAdmissionUniversity(
    intent: AdmissionIntent,
    analysis: MessageAnalysis,
    conversationKey: string,
    now: number
  ): ReturnType<UniversityRepository["getUniversity"]> | null {
    for (const schoolName of intent.schoolNames) {
      const resolved = this.resolveUniversityName(schoolName, analysis);
      if (resolved) return resolved;
    }
    const context = this.getContext(conversationKey, now);
    if (context) return this.universities.getUniversity(context.universityId) ?? null;
    return null;
  }

  private resolveRouteUniversity(
    intent: Pick<MessageRouteIntent, "schoolNames">,
    analysis: MessageAnalysis,
    conversationKey: string,
    now: number
  ): ReturnType<UniversityRepository["getUniversity"]> | null {
    return this.resolveAdmissionUniversity(
      {
        isAdmissionQuery: false,
        confidence: 0,
        schoolNames: intent.schoolNames,
        province: null,
        subjectType: null,
        years: [],
        planGroup: null,
        majorName: null,
        queryTypes: [],
        needsFollowUp: false,
        followUpQuestion: null,
        reason: ""
      },
      analysis,
      conversationKey,
      now
    );
  }

  private resolveComparisonUniversities(
    intent: MessageRouteIntent,
    analysis: MessageAnalysis
  ): Array<NonNullable<ReturnType<UniversityRepository["getUniversity"]>>> {
    if (intent.schoolNames.length < 2) return [];
    const schools: Array<NonNullable<ReturnType<UniversityRepository["getUniversity"]>>> = [];
    const seen = new Set<number>();
    for (const schoolName of intent.schoolNames) {
      const university = this.resolveUniversityName(schoolName, analysis);
      if (!university || seen.has(university.id)) continue;
      seen.add(university.id);
      schools.push(university);
    }
    return schools.slice(0, 3);
  }

  private resolveUniversityName(
    schoolName: string,
    analysis: MessageAnalysis
  ): NonNullable<ReturnType<UniversityRepository["getUniversity"]>> | null {
    const normalizedSchoolName = normalizeSchoolName(schoolName);
    if (!normalizedSchoolName) return null;

    const localCandidate = analysis.candidates.find((row) => candidateMatchesSchoolName(row, normalizedSchoolName));
    if (localCandidate) return localCandidate;

    const repository = this.universities as UniversityRepository & {
      listUniversities?: (query?: string, limit?: number) => ReturnType<UniversityRepository["listUniversities"]>;
      findSchoolCandidates?: (message: string, limit?: number) => MessageAnalysis["candidates"];
    };
    const exact = repository
      .listUniversities?.(schoolName, 8)
      .find((row) => normalizeSchoolName(row.name) === normalizedSchoolName || normalizeSchoolName(row.slug) === normalizedSchoolName);
    if (exact) return exact;

    const candidate = repository.findSchoolCandidates?.(schoolName, 1)[0];
    return candidate ?? null;
  }

  private findAmbiguousRouteCandidates(
    intent: MessageRouteIntent,
    analysis: MessageAnalysis
  ): MessageAnalysis["candidates"] {
    if (intent.schoolNames.length !== 1 || analysis.candidates.length < 2) return [];
    const normalizedSchoolName = normalizeSchoolName(intent.schoolNames[0]);
    if (!normalizedSchoolName) return [];
    return dedupeCandidates(
      analysis.candidates.filter((candidate) => candidateMatchesSchoolName(candidate, normalizedSchoolName))
    ).slice(0, 5);
  }

  private async answerAdmissionWithLlm(input: {
    userMessage: string;
    universityName: string;
    province: string;
    subjectType: string | null;
    planGroup: string | null;
    majorName: string | null;
    plans: AdmissionPlanRow[];
    scores: AdmissionScoreRow[];
    contextText: string;
    syncError: string | null;
  }): Promise<string> {
    try {
      return await this.llm.chat(
        [
          {
            role: "system",
            content:
              "你是专业但口语化的高考招生数据顾问。请基于给定的掌上高考缓存数据回答，不要编造不存在的分数、位次、计划数。" +
              `当前日期是 ${currentAdmissionDate()}：${currentAdmissionYear()} 招生计划可以优先参考；${currentAdmissionYear()} 录取分数线和最低位次通常要等各省录取后才陆续出现，因此涉及分数/位次时优先使用 ${defaultAdmissionScoreYearRange()} 历史数据。` +
              "回答要先给结论，再给表格或分点数据，然后给报考提醒。若数据为空或同步失败，要直说缺口，并建议补充省份/科类/专业或稍后同步。" +
              "掌上高考是第三方聚合数据，结尾必须提醒最终以省考试院和学校招生网为准。适合 QQ 阅读，可以用 Markdown 表格和加粗。"
          },
          {
            role: "user",
            content: `用户问题：${input.userMessage}\n学校：${input.universityName}\n省份：${input.province}\n科类：${input.subjectType ?? "未指定"}\n专业组：${input.planGroup ?? "未指定"}\n专业：${input.majorName ?? "未指定"}\n\n可用招生数据：\n${input.contextText}`
          }
        ],
        "admission-answer"
      );
    } catch (error) {
      const message = normalizeLlmFailureMessage(error, this.settings.runtime().llm.timeoutMs);
      return `我查到了 ${input.universityName} 在${input.province}的招生数据缓存，但模型总结失败：${message}\n\n${input.contextText.slice(0, 1200)}\n\n掌上高考为第三方聚合数据，最终请以省考试院和学校招生网为准。`;
    }
  }

  private async answerAdmissionComparisonWithLlm(input: {
    userMessage: string;
    province: string;
    subjectType: string;
    planGroup: string | null;
    majorName: string | null;
    schools: AdmissionSchoolData[];
    contextText: string;
  }): Promise<string> {
    const names = input.schools.map((school) => school.university.name).join("、");
    try {
      return await this.llm.chat(
        [
          {
            role: "system",
            content:
              "你是专业但口语化的高考志愿招生数据对比顾问。用户正在比较多所明确提到的学校，请基于给定掌上高考缓存数据回答。" +
              "不要编造不存在的分数、位次、计划数或专业线；某所学校缺数据时要单独说明缺口，不能用另一所学校的数据代替。" +
              `当前日期是 ${currentAdmissionDate()}：${currentAdmissionYear()} 招生计划可以优先参考；${currentAdmissionYear()} 录取分数线和最低位次通常要等各省录取后才陆续出现，因此分数/位次优先看 ${defaultAdmissionScoreYearRange()} 历史数据。` +
              "回答要先给可执行结论，再用表格比较最低分、最低位次、计划数、专业口径或趋势；如果用户问专业，优先比较该专业，资料不足再回到院校线。" +
              "结尾必须提醒：掌上高考是第三方聚合数据，最终以省考试院和学校招生网为准。适合 QQ 阅读，可以用 Markdown 表格和加粗。"
          },
          {
            role: "user",
            content:
              `用户问题：${input.userMessage}\n比较学校：${names}\n省份：${input.province}\n科类：${input.subjectType}\n专业组：${input.planGroup ?? "未指定"}\n专业：${input.majorName ?? "未指定"}\n\n可用招生数据：\n${input.contextText}`
          }
        ],
        "admission-comparison"
      );
    } catch (error) {
      const message = normalizeLlmFailureMessage(error, this.settings.runtime().llm.timeoutMs);
      return `我查到了 ${names} 在${input.province}${input.subjectType}的招生数据缓存，但模型对比总结失败：${message}\n\n${input.contextText.slice(0, 1600)}\n\n掌上高考为第三方聚合数据，最终请以省考试院和学校招生网为准。`;
    }
  }

  private createAnswerSourcePage(input: AnswerSourceInput): string | undefined {
    const baseUrl = getPublicBaseUrl(this.settings.runtime());
    if (!this.answerSources || !baseUrl) return undefined;
    const token = this.answerSources.create(input);
    return `${baseUrl}/sources/${encodeURIComponent(token)}`;
  }

  private async answerWithLlm(input: {
    userMessage: string;
    universityName: string;
    topic: string;
    contextText: string;
    schoolProfileText: string | null;
    srgaoxiaoReviewsText: string | null;
    sourceUrl: string;
  }): Promise<string> {
    try {
      const answer = await this.llm.chat(
        [
          {
            role: "system",
            content:
              "你是专业但口语化的高校资料顾问。回答高校问题时，先给用户一个“院校定位”，再结合 CollegesChat 问卷资料讲生活体验，最后给适合人群、风险点或追问建议。" +
              "如果给出了“外部院校画像补充资料”，院校定位要优先参考它，包括所在城市/校区、办学层次、211/双一流/行业特色、优势学科、占地、建校年份、官网和综合评分等。神人高校网评分属于公开站点聚合评价，不是官方评价，必须用“参考”语气。" +
              "如果给出了“神人高校评论资料”，它只代表该站用户评论和当时体验，不是官方信息；请提炼共性、分歧和风险点，不要大段照抄原评论。" +
              "院校定位也可以补充公开常识和模型知识，包括学校规模、优势方向或就业方向等。只有在很有把握或资料明确给出时才写占地面积、具体校区数量等数字；不确定就不要写具体数字，也不要硬编。" +
              "生活体验部分请优先基于用户给出的 CollegesChat 问卷资料回答；具体到该校的宿舍、管理、食堂、校园网、外卖、早晚自习等事实只能来自问卷资料。资料存在分歧时要明确说存在差异。" +
              "如果没有检索到相关问卷片段，要直接说明资料缺口，然后再用“一般来说”“通常建议”“如果按常见情况看”等表达给出公开常识或理性建议，不要把常识包装成该校确定事实。" +
              "用户问评价、能不能、适不适合、体验怎么样时，可以展开分析：先概括学校定位，再讲生活条件，再讲适合哪些学生和需要注意什么。回答要适合 QQ 阅读，可用 Markdown 标题、加粗和列表；简单问题简洁，复杂问题可以更详细。" +
              "不要说这是官方信息。结尾必须包含“院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。”"
          },
          {
            role: "user",
            content: `用户问题：${input.userMessage}\n学校：${input.universityName}\n主题：${input.topic}\nCollegesChat 资料来源：${input.sourceUrl}\n\n外部院校画像补充资料：\n${input.schoolProfileText ?? "本地没有外部院校画像补充资料。"}\n\n神人高校评论资料：\n${input.srgaoxiaoReviewsText ?? "本次未调用实时评论，或没有可用评论资料。"}\n\n可用问卷资料：\n${input.contextText}`
          }
        ],
        "university-answer"
      );
      if (answer.includes("生活体验数据来自 CollegesChat 问卷")) return answer;
      return `${answer}\n\n院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。`;
    } catch (error) {
      const message = normalizeLlmFailureMessage(error, this.settings.runtime().llm.timeoutMs);
      return `我检索到了 ${input.universityName} 的相关资料，但调用模型总结失败：${message}\n\n院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。`;
    }
  }

  private async maybeFetchSrgaoxiaoReviews(
    universityId: number,
    schoolProfileText: string | null
  ): Promise<string | null> {
    if (!this.srgaoxiao || !schoolProfileText) return null;
    return this.srgaoxiao.fetchLiveReviewContext(universityId, 6);
  }

  private async buildComparisonSchoolContexts(
    candidates: Array<NonNullable<ReturnType<UniversityRepository["getUniversity"]>>>,
    topicKey: string,
    topic: string,
    userMessage: string
  ): Promise<ComparisonSchoolContext[]> {
    const schools: ComparisonSchoolContext[] = [];
    for (const university of candidates.slice(0, 3)) {
      const questions = this.universities.getTopicQuestions(university.id, topicKey, userMessage, 4);
      const contextText = questions.length
        ? this.nlu.buildRetrievalContext(university.name, questions)
        : `这次没有检索到 ${university.name} 在“${topic}”上的 CollegesChat 问卷片段。请如实说明资料缺口，可以结合公开常识、院校画像和理性推断比较，但不要把推断说成该校问卷事实。`;
      const schoolProfile = this.universities.getSchoolProfile?.(university.id, "srgaoxiao");
      const srgaoxiaoReviewsText = await this.maybeFetchSrgaoxiaoReviews(
        university.id,
        schoolProfile?.profileText ?? null
      );
      schools.push({
        universityId: university.id,
        universityName: university.name,
        topic,
        sourceUrl: university.source_url,
        contextText,
        schoolProfileText: schoolProfile?.profileText ?? null,
        srgaoxiaoReviewsText
      });
    }
    return schools;
  }

  private async answerComparisonWithLlm(input: {
    userMessage: string;
    topic: string;
    schools: ComparisonSchoolContext[];
  }): Promise<string> {
    try {
      const answer = await this.llm.chat(
        [
          {
            role: "system",
            content:
              "你是专业但口语化的高校选择顾问。用户正在比较多所明确提到的学校，不要把它当成学校名歧义，也不要要求用户重新补学校名。" +
              "回答时先给一个清晰结论：如果必须二选一，按什么前提推荐哪所；如果取决于专业、城市、升学/就业目标，要直接列出分叉条件。" +
              "再分学校说明院校定位、优势方向、风险点和生活体验。院校定位优先参考外部院校画像补充资料，也可以补充公开常识和模型知识；只有有把握或资料明确给出时才写具体数字。" +
              "生活体验事实必须来自对应学校的 CollegesChat 问卷或神人高校评论；如果某校缺资料，要说清楚资料缺口，不要把另一所学校的体验套过去。" +
              "神人高校网评论只代表该站用户评论和当时体验，不是官方信息；请提炼共性、分歧和风险点，不要照抄。" +
              "适合 QQ 阅读，可用 Markdown 标题、加粗和列表。结尾必须包含“院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。”"
          },
          {
            role: "user",
            content: `用户问题：${input.userMessage}\n比较主题：${input.topic}\n\n${input.schools
              .map((school) => renderComparisonSchoolForPrompt(school))
              .join("\n\n---\n\n")}`
          }
        ],
        "university-comparison"
      );
      if (answer.includes("生活体验数据来自 CollegesChat 问卷")) return answer;
      return `${answer}\n\n院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。`;
    } catch (error) {
      const message = normalizeLlmFailureMessage(error, this.settings.runtime().llm.timeoutMs);
      const names = input.schools.map((school) => school.universityName).join("、");
      return `我识别到了 ${names}，但调用模型做对比总结失败：${message}\n\n院校画像参考公开资料和神人高校网补充数据，生活体验数据来自 CollegesChat 问卷和神人高校评论，常识建议仅供参考。`;
    }
  }

  private async answerCasualWithLlm(
    userMessage: string,
    context: ConversationContext | null,
    purpose: "greeting" | "casual-message"
  ): Promise<string> {
    const model = this.settings.runtime().llm.model;
    const contextLine = context
      ? `当前对话前文正在查询的学校是：${context.universityName}。`
      : "当前没有已确认的学校上下文。";

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
            content: `${contextLine}\n入口判断已由上一步模型完成；这一步只负责自然回复，不要再基于关键词重新猜测学校或处理分支。\n\n用户消息：${userMessage}`
          }
        ],
        purpose
      );
    } catch {
      if (purpose === "greeting") return renderGreetingReply();
      return renderCasualFallback(Boolean(context));
    }
  }

  private buildImageSchoolContext(
    routeIntent: MessageRouteIntent,
    analysis: MessageAnalysis,
    conversationKey: string,
    now: number,
    userMessage: string
  ): ImageSchoolContext | null {
    const university = this.resolveRouteUniversity(routeIntent, analysis, conversationKey, now);
    if (!university) return null;

    const topicKey = normalizeTopicKey(routeIntent.topicKey) ?? "general";
    const topic = routeIntent.route === "admission" ? "招生数据" : (routeIntent.topicLabel ?? topicLabel(topicKey));
    const questions = this.universities.getTopicQuestions(university.id, topicKey, userMessage, 4);
    const contextText = questions.length
      ? this.nlu.buildRetrievalContext(university.name, questions)
      : `这条图片消息没有检索到 ${university.name} 在“${topic}”上的 CollegesChat 问卷片段。请先结合公开常识和用户文字确认学校语境，再基于图片可见内容分析，不要把常识说成问卷事实。`;
    const schoolProfile = this.universities.getSchoolProfile?.(university.id, "srgaoxiao");

    return {
      universityId: university.id,
      universityName: university.name,
      topic,
      sourceUrl: university.source_url,
      contextText,
      schoolProfileText: schoolProfile?.profileText ?? null
    };
  }

  private async answerImageWithLlm(
    userMessage: string,
    images: IncomingImage[],
    analysis: MessageAnalysis,
    schoolContext: ImageSchoolContext | null,
    routeIntent: MessageRouteIntent
  ): Promise<string> {
    const usableUrls = images.map((image) => image.url || image.file || "").filter(isImageUrl);
    if (!usableUrls.length) {
      return "我收到图片了，但这条图片消息里没有可传给模型的图片 URL。请确认 NapCat 的图片段包含 url，或者换一种图片发送方式。";
    }

    const detectedLine = [
      `入口模型判断：${routeIntent.route}`,
      `本地实体解析提示：${analysis.candidates.length ? "有可用于解析模型学校名的候选" : "无本地学校候选"}`,
      `模型主题：${routeIntent.topicLabel ?? topicLabel(normalizeTopicKey(routeIntent.topicKey) ?? "general")}`,
      `候选学校（仅用于实体解析，不作为入口判断）：${analysis.candidates
        .slice(0, 3)
        .map((candidate) => candidate.name)
        .join("、") || "无"}`
    ].join("；");
    const schoolLine = schoolContext
      ? `已识别学校：${schoolContext.universityName}；主题：${schoolContext.topic}；CollegesChat 资料来源：${schoolContext.sourceUrl}\n外部院校画像补充资料：\n${schoolContext.schoolProfileText ?? "本地没有外部院校画像补充资料。"}\n\n可用问卷语境：\n${schoolContext.contextText}`
      : "没有可靠识别到具体学校。若图片或用户文字里出现学校简称，请先说明你的判断依据；不确定时要追问。";
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
              "你是 QQ 里的高校生活资料助手。用户发送了图片，可能是学校相关截图、环境照片、通知、聊天截图、梗图或普通图片。" +
              "如果用户文字、对话上下文或本地识别结果提到学校简称/学校名，你必须先把图片放回这个学校语境里解读；例如用户说“南航的同学这样说”，应结合南京航空航天大学的院校定位和可能的食堂/校园生活语境，不要只解释图片梗本身。" +
              "涉及具体学校时，先用 1 到 2 句给院校定位，优先参考外部院校画像补充资料，可以提城市、办学层次、行业特色或优势方向；再解释图片内容和它可能反映的生活体验/情绪/吐槽点。" +
              "图片里看得见的内容可以直接分析；问卷语境里有的生活事实可以引用；公开常识或推断要说成“可能”“一般来说”“从吐槽语境看”。看不清或无法判断时要直接说明，不要编造图片中没有的信息。"
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `${detectedLine}\n${schoolLine}\n\n用户文字：${text}`
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

function emptyMessageAnalysis(): MessageAnalysis {
  return {
    candidates: [],
    reason: "入口由大模型判断，未运行本地学校关键词候选"
  };
}

function shouldResolveUniversitiesLocally(intent: MessageRouteIntent): boolean {
  if (intent.route !== "admission" && intent.route !== "university_info") return false;
  return intent.schoolNames.length > 0;
}

function renderRouteContextLine(context: ConversationContext | null): string {
  if (!context) return "当前没有已确认学校上下文。";
  const pending = context.pendingAdmission
    ? [
        `当前有待补充的招生查询：学校=${context.universityName}`,
        `省份=${context.pendingAdmission.province ?? "待补充"}`,
        `科类=${context.pendingAdmission.subjectType ?? "待补充"}`,
        `年份=${context.pendingAdmission.years.length ? context.pendingAdmission.years.join(",") : "默认"}`,
        `专业组=${context.pendingAdmission.planGroup ?? "未指定"}`,
        `专业=${context.pendingAdmission.majorName ?? "未指定"}`,
        `查询类型=${context.pendingAdmission.queryTypes.length ? context.pendingAdmission.queryTypes.join(",") : "默认"}`
      ].join("；")
    : null;
  return [`当前对话学校上下文：${context.universityName}`, pending].filter(Boolean).join("\n");
}

function renderComparisonSchoolForPrompt(school: ComparisonSchoolContext): string {
  return [
    `学校：${school.universityName}`,
    `CollegesChat 资料来源：${school.sourceUrl}`,
    `外部院校画像补充资料：\n${school.schoolProfileText ?? "本地没有外部院校画像补充资料。"}`,
    `神人高校评论资料：\n${school.srgaoxiaoReviewsText ?? "本次未调用实时评论，或没有可用评论资料。"}`,
    `可用问卷资料：\n${school.contextText}`
  ].join("\n\n");
}

function dedupeCandidates(candidates: MessageAnalysis["candidates"]): MessageAnalysis["candidates"] {
  const seen = new Set<number>();
  return candidates.filter((candidate) => {
    if (seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function candidateMatchesSchoolName(candidate: MessageAnalysis["candidates"][number], normalizedSchoolName: string): boolean {
  return [candidate.name, candidate.matchedBy, candidate.slug].some((value) => {
    const normalized = normalizeSchoolName(value);
    return normalized === normalizedSchoolName || normalized.includes(normalizedSchoolName) || normalizedSchoolName.includes(normalized);
  });
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("LLM JSON not found");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function normalizeMessageRouteIntent(raw: Record<string, unknown>): MessageRouteIntent {
  const route = normalizeRoute(raw.route);
  const admission = normalizeAdmissionIntent({ ...raw, isAdmissionQuery: route === "admission" });
  return {
    ...admission,
    route,
    shouldReply: typeof raw.shouldReply === "boolean" ? raw.shouldReply : route !== "ignore",
    topicKey: normalizeTopicKey(toCleanString(raw.topicKey)),
    topicLabel: toCleanString(raw.topicLabel)
  };
}

function extractAdmissionFollowUpSlots(text: string): { province: string | null; subjectType: string | null; years: number[] } {
  const compact = text.replace(/\s+/gu, "");
  const province = extractAdmissionProvinceFromText(compact);
  const subjectType = extractKnownAdmissionSubjectType(compact);
  const currentYear = currentAdmissionYear();
  const years = Array.from(
    new Set(
      Array.from(compact.matchAll(/\b(20\d{2})\b/gu))
        .map((match) => Number(match[1]))
        .filter((year) => Number.isFinite(year) && year >= 2020 && year <= currentYear)
    )
  ).sort((left, right) => right - left);
  return { province, subjectType, years };
}

function extractAdmissionProvinceFromText(text: string): string | null {
  if (!text) return null;
  const normalized = normalizeAdmissionProvince(text);
  const provinces = gaokaoProvinceNames().slice().sort((left, right) => right.length - left.length);
  return provinces.find((province) => normalized.includes(province)) ?? null;
}

function extractKnownAdmissionSubjectType(text: string): string | null {
  const normalized = normalizeSubjectFromLlm(text);
  return normalized === "物理类" || normalized === "历史类" || normalized === "理科" || normalized === "文科" || normalized === "综合改革"
    ? normalized
    : null;
}

function normalizeAdmissionIntent(raw: Record<string, unknown>): AdmissionIntent {
  const queryTypes = toStringArray(raw.queryTypes).filter((value): value is AdmissionIntent["queryTypes"][number] =>
    ["plan", "score", "rank", "major_score", "trend", "compare"].includes(value)
  );
  const isAdmissionQuery = Boolean(raw.isAdmissionQuery);
  return {
    isAdmissionQuery,
    confidence: clamp01(Number(raw.confidence ?? (isAdmissionQuery ? 0.7 : 0))),
    schoolNames: toStringArray(raw.schoolNames),
    province: toCleanString(raw.province),
    subjectType: normalizeSubjectFromLlm(raw.subjectType),
    years: toNumberArray(raw.years),
    planGroup: normalizePlanGroup(toCleanString(raw.planGroup)),
    majorName: toCleanString(raw.majorName),
    queryTypes,
    needsFollowUp: Boolean(raw.needsFollowUp),
    followUpQuestion: toCleanString(raw.followUpQuestion),
    reason: toCleanString(raw.reason) ?? ""
  };
}

function normalizeRoute(value: unknown): MessageRouteIntent["route"] {
  const text = toCleanString(value)?.toLowerCase();
  if (text === "admission" || text === "university_info" || text === "casual" || text === "ignore") return text;
  return "casual";
}

function normalizeTopicKey(value: string | null): string | null {
  if (!value) return null;
  if (value === "general") return "general";
  return TOPICS.some((topic) => topic.key === value) ? value : null;
}

function normalizeSubjectFromLlm(value: unknown): string | null {
  const text = toCleanString(value);
  if (!text) return null;
  if (/物理/u.test(text)) return "物理类";
  if (/历史/u.test(text)) return "历史类";
  if (/理科/u.test(text)) return "理科";
  if (/文科/u.test(text)) return "文科";
  if (/综合|不分|不限/u.test(text)) return "综合改革";
  return text;
}

function buildAdmissionYears(intent: AdmissionIntent): { scoreYears: number[]; planYears: number[]; unavailableScoreYears: number[] } {
  const currentYear = currentAdmissionYear();
  const requested = intent.years.filter((year) => year >= 2020 && year <= currentYear);
  const queryTypes = new Set(intent.queryTypes);
  const explicitlyNeedsHistoricalPlans = queryTypes.has("plan") || queryTypes.has("compare");
  const planYears = requested.length && explicitlyNeedsHistoricalPlans
    ? requested
    : defaultAdmissionPlanYears();
  const scoreYears = requested.filter((year) => year <= currentYear - 1);
  const unavailableScoreYears = requested.filter((year) => year >= currentYear);
  return {
    planYears: planYears.length ? Array.from(new Set(planYears)).sort((a, b) => b - a) : defaultAdmissionPlanYears(),
    scoreYears: scoreYears.length ? Array.from(new Set(scoreYears)).sort((a, b) => b - a) : defaultAdmissionScoreYears(),
    unavailableScoreYears: Array.from(new Set(unavailableScoreYears)).sort((a, b) => b - a)
  };
}

function pickAdmissionSyncKinds(intent: AdmissionIntent): { includePlans: boolean; includeScores: boolean } {
  const types = new Set(intent.queryTypes);
  if (!types.size) return { includePlans: true, includeScores: true };
  const includePlans =
    types.has("plan") ||
    types.has("score") ||
    types.has("rank") ||
    types.has("major_score") ||
    types.has("trend") ||
    types.has("compare");
  const includeScores =
    types.has("score") ||
    types.has("rank") ||
    types.has("major_score") ||
    types.has("trend") ||
    types.has("compare");
  return {
    includePlans: includePlans || !includeScores,
    includeScores: includeScores || !includePlans
  };
}

function shouldSyncPlanDetails(intent: AdmissionIntent): boolean {
  const types = new Set(intent.queryTypes);
  return Boolean(intent.majorName) || types.has("plan");
}

function shouldSyncMajorScores(intent: AdmissionIntent): boolean {
  const types = new Set(intent.queryTypes);
  return Boolean(intent.majorName) || types.has("major_score");
}

function normalizeAdmissionProvince(value: string): string {
  return normalizeProvinceName(value);
}

function inferAdmissionSubjectType(province: string): string | null {
  const normalized = normalizeAdmissionProvince(province);
  const comprehensiveReform = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
  return comprehensiveReform.has(normalized) ? "综合改革" : null;
}

const COMPREHENSIVE_REFORM_ADMISSION_PROVINCES = new Set(["北京", "天津", "上海", "浙江", "山东", "海南"]);
const THIRD_BATCH_3_1_2_ADMISSION_PROVINCES = new Set(["河北", "辽宁", "江苏", "福建", "湖北", "湖南", "广东", "重庆"]);
const FOURTH_BATCH_3_1_2_ADMISSION_PROVINCES = new Set(["吉林", "黑龙江", "安徽", "江西", "广西", "贵州", "甘肃"]);
const FIFTH_BATCH_3_1_2_ADMISSION_PROVINCES = new Set(["山西", "内蒙古", "河南", "四川", "云南", "陕西", "青海", "宁夏"]);

function renderAdmissionSubjectFollowUpQuestion(
  universityName: string,
  province: string,
  years: ReturnType<typeof buildAdmissionYears>,
  syncKinds: ReturnType<typeof pickAdmissionSyncKinds>
): string {
  const provinceName = normalizeAdmissionProvince(province);
  const relevantYears = Array.from(
    new Set([
      ...(syncKinds.includePlans ? years.planYears : []),
      ...(syncKinds.includeScores ? years.scoreYears : [])
    ])
  ).sort((left, right) => right - left);
  const transitionYear = admissionTransitionYear(provinceName);
  if (transitionYear) {
    const newGaokaoYears = relevantYears.filter((year) => year >= transitionYear);
    const oldGaokaoYears = relevantYears.filter((year) => year < transitionYear);
    if (newGaokaoYears.length && oldGaokaoYears.length) {
      return `你想看 ${universityName} 在${provinceName}的哪个科类？${newGaokaoYears.join("、")} 年按“物理类/历史类”查，${oldGaokaoYears.join("、")} 年按“理科/文科”查。你可以直接说“物理类”或“历史类”，也可以说“理科”或“文科”，我会按年份自动换算口径。`;
    }
    if (newGaokaoYears.length) {
      return `你想看 ${universityName} 在${provinceName}的哪个科类？${provinceName} ${transitionYear} 年起按新高考口径查询，请直接说“物理类”或“历史类”。`;
    }
    return `你想看 ${universityName} 在${provinceName}的哪个科类？这些年份仍按旧高考口径查询，请直接说“理科”或“文科”。`;
  }
  return `你想看 ${universityName} 在${provinceName}的哪个科类？可以说“物理类”“历史类”“理科”或“文科”。`;
}

function compatibleAdmissionSubjectTypes(subjectType: string | null, province?: string): string[] {
  if (province && COMPREHENSIVE_REFORM_ADMISSION_PROVINCES.has(normalizeAdmissionProvince(province))) return ["综合改革"];
  const normalized = normalizeSubjectFromLlm(subjectType);
  if (!normalized) return [];
  if (normalized === "物理类" || normalized === "理科") return ["物理类", "理科"];
  if (normalized === "历史类" || normalized === "文科") return ["历史类", "文科"];
  return [normalized];
}

function groupYearsByAdmissionSubjectTypes(
  province: string,
  subjectType: string | null,
  years: number[]
): Array<{ subjectTypes: string[]; years: number[] }> {
  const groups = new Map<string, { subjectTypes: string[]; years: number[] }>();
  for (const year of years) {
    const subjectTypes = admissionSubjectTypesForYear(province, subjectType, year);
    if (!subjectTypes.length) continue;
    const key = subjectTypes.join("|");
    const group = groups.get(key) ?? { subjectTypes, years: [] };
    group.years.push(year);
    groups.set(key, group);
  }
  return Array.from(groups.values()).map((group) => ({
    subjectTypes: group.subjectTypes,
    years: Array.from(new Set(group.years)).sort((left, right) => right - left)
  }));
}

function admissionSubjectTypesForYear(province: string, subjectType: string | null, year: number): string[] {
  const normalized = normalizeSubjectFromLlm(subjectType);
  if (!normalized) return [];
  const provinceName = normalizeAdmissionProvince(province);
  if (COMPREHENSIVE_REFORM_ADMISSION_PROVINCES.has(provinceName)) return ["综合改革"];
  if (normalized === "综合改革") return ["综合改革"];
  if (normalized !== "物理类" && normalized !== "理科" && normalized !== "历史类" && normalized !== "文科") return [normalized];

  const isPhysicsTrack = normalized === "物理类" || normalized === "理科";
  const transitionYear = admissionTransitionYear(provinceName);
  if (transitionYear && year >= transitionYear) return [isPhysicsTrack ? "物理类" : "历史类"];
  return [isPhysicsTrack ? "理科" : "文科"];
}

function admissionTransitionYear(provinceName: string): number | null {
  if (THIRD_BATCH_3_1_2_ADMISSION_PROVINCES.has(provinceName)) return 2021;
  if (FOURTH_BATCH_3_1_2_ADMISSION_PROVINCES.has(provinceName)) return 2024;
  if (FIFTH_BATCH_3_1_2_ADMISSION_PROVINCES.has(provinceName)) return 2025;
  return null;
}

function renderSubjectCompatibilityNote(subjectType: string | null, subjectTypes: string[]): string | null {
  if (!subjectType || subjectTypes.length <= 1) return null;
  return `科类口径提示：用户选择的是“${subjectType}”。为兼容新旧高考过渡年份，本次同时检索 ${subjectTypes.join(" / ")}；回答时要按表格里的年份和科类说明，不要把旧高考“理科/文科”和新高考“物理类/历史类”混成同一原始字段。`;
}

function renderAdmissionComparisonContext(input: {
  userMessage: string;
  province: string;
  subjectType: string;
  planGroup: string | null;
  majorName: string | null;
  schools: AdmissionSchoolData[];
}): string {
  const lines = [
    `多校招生对比查询：${input.schools.map((school) => school.university.name).join(" / ")}`,
    `用户问题：${input.userMessage}`,
    `省份：${input.province}；科类：${input.subjectType}；专业组：${input.planGroup ?? "未指定"}；专业：${input.majorName ?? "未指定"}`,
    "使用的数据表：admission_plans、admission_scores、admission_sources。",
    ""
  ];
  for (const school of input.schools) {
    lines.push(`===== ${school.university.name} =====`);
    lines.push(school.contextText);
    lines.push("");
  }
  lines.push("多校对比说明：以上每所学校均单独同步、查询和保留来源快照；掌上高考为第三方聚合数据，最终请以省考试院和学校招生网为准。");
  return lines.join("\n");
}

function renderAdmissionContext(input: {
  universityName: string;
  province: string;
  subjectType: string | null;
  subjectTypes: string[];
  planGroup: string | null;
  majorName: string | null;
  planMajorFallback: boolean;
  scoreMajorFallback: boolean;
  plans: AdmissionPlanRow[];
  scores: AdmissionScoreRow[];
  schoolProfileText: string | null;
  sourceSnapshots: AdmissionSourceRow[];
  unavailableScoreYears: number[];
  syncSummary: AdmissionSyncSummary | null;
  syncError: string | null;
}): string {
  const lines = [
    `查询条件：${input.universityName}；省份：${input.province}；科类：${input.subjectType ?? "未指定"}${renderAdmissionSubjectQuerySuffix(input.subjectType, input.subjectTypes)}；专业组：${input.planGroup ?? "未指定"}；专业：${input.majorName ?? "未指定"}`,
    `当前日期：${currentAdmissionDate()}。${currentAdmissionYear()} 录取分数线/位次通常要等各省录取后陆续出现，历史分数默认使用 ${defaultAdmissionScoreYearRange()}。`
  ];
  const compatibilityNote = renderSubjectCompatibilityNote(input.subjectType, input.subjectTypes);
  if (compatibilityNote) lines.push(compatibilityNote);
  if (input.schoolProfileText) {
    lines.push(`掌上高考院校基础信息：\n${input.schoolProfileText}`);
  }
  if (input.majorName && (input.planMajorFallback || input.scoreMajorFallback)) {
    lines.push(renderMajorFallbackNotice(input.majorName, input.planMajorFallback, input.scoreMajorFallback));
  }
  if (input.syncError) lines.push(`实时同步提示：${input.syncError}`);
  if (input.unavailableScoreYears.length) {
    lines.push(
      `分数年份提示：用户请求了 ${input.unavailableScoreYears.join("、")} 年录取分数/位次，但当前日期 ${currentAdmissionDate()} 通常尚未能完整获取当年录取结果；本次优先使用 ${defaultAdmissionScoreYearRange()} 历史分数作为参考。`
    );
  }
  if (input.syncSummary) {
    lines.push(
      `实时同步结果：已请求掌上高考；本批 ${input.syncSummary.total}/${input.syncSummary.candidateTotal || input.syncSummary.total} 所，offset ${input.syncSummary.offset} → ${input.syncSummary.nextOffset}，映射 ${input.syncSummary.mapped}，计划 ${input.syncSummary.planRows}，院校线 ${input.syncSummary.schoolScoreRows}，专业线 ${input.syncSummary.majorScoreRows}，来源快照 ${input.syncSummary.sourceRows}，跳过学校 ${input.syncSummary.skipped}，跳过已有接口 ${input.syncSummary.skippedRequests}，错误 ${input.syncSummary.errorCount}。`
    );
    if (input.syncSummary.requestBudgetExhausted) {
      lines.push(`实时同步节流：本批已用 ${input.syncSummary.sourceRequests}/${input.syncSummary.sourceRequestBudget ?? "不限"} 次源站请求预算，已主动暂停继续补数；后续定时同步会从当前 offset 继续。`);
    }
  }
  if (!input.plans.length && !input.scores.length && !input.syncError) {
    lines.push(
      input.syncSummary
        ? "数据状态：本次同步正常完成，但当前学校/省份/科类/年份/专业条件没有返回可入库的计划或分数。常见原因是掌上高考暂未开放该年份数据、该校当年未在该省该科类招生，或源站字段与当前条件不完全一致。"
        : "数据状态：本地暂未检索到当前条件的招生计划或录取分数。"
    );
  }

  const referenceTable = renderAdmissionReferenceTable(input.plans, input.scores);
  if (referenceTable) {
    lines.push("\n报考参考表：");
    lines.push("年份 | 数据类型 | 科类 | 批次/专业组 | 专业/口径 | 最低分 | 最低位次 | 平均分 | 平均位次 | 最高分 | 省控线 | 线差 | 计划数 | 抓取时间");
    lines.push(...referenceTable);
  }

  lines.push("\n招生计划：");
  if (input.plans.length) {
    lines.push("年份 | 科类 | 批次/专业组 | 专业 | 计划数 | 专业数 | 学费 | 学制 | 校区 | 选科要求 | 抓取时间");
    for (const row of input.plans.slice(0, 30)) {
      lines.push(
        [
          row.year,
          row.subjectType ?? "-",
          [row.batch, row.planGroup].filter(Boolean).join(" ") || "-",
          row.majorName ?? "院校计划汇总",
          row.planCount ?? row.schoolPlanCount ?? "-",
          row.majorCount ?? "-",
          row.tuition ?? "-",
          row.duration ?? "-",
          row.campus ?? "-",
          row.selectionRequirements ?? "-",
          formatDateTimeShort(row.fetchedAt)
        ].join(" | ")
      );
    }
  } else {
    lines.push("暂无匹配的招生计划缓存。");
  }

  const scoreTrendSummary = renderScoreTrendSummary(input.scores);
  if (scoreTrendSummary) lines.push(`\n分数趋势摘要：\n${scoreTrendSummary}`);

  lines.push("\n录取分数/位次：");
  if (input.scores.length) {
    lines.push("年份 | 类型 | 科类 | 批次/专业组 | 专业 | 最低分 | 最低位次 | 平均分 | 平均位次 | 最高分 | 省控线 | 线差 | 计划数 | 抓取时间");
    for (const row of input.scores.slice(0, 50)) {
      lines.push(
        [
          row.year,
          row.scoreType === "major" ? "专业线" : "院校线",
          row.subjectType ?? "-",
          [row.batch, row.planGroup].filter(Boolean).join(" ") || "-",
          row.majorName ?? "-",
          row.minScore ?? "-",
          row.minRank ?? "-",
          row.avgScore ?? "-",
          row.avgRank ?? "-",
          row.maxScore ?? "-",
          row.controlScore ?? "-",
          row.diffScore ?? "-",
          row.planCount ?? "-",
          formatDateTimeShort(row.fetchedAt)
        ].join(" | ")
      );
    }
  } else {
    lines.push("暂无匹配的录取分数/位次缓存。");
  }

  const sourceIds = Array.from(
    new Set(
      [...input.plans, ...input.scores]
        .map((row) => row.sourceRecordId)
        .filter((value): value is string => Boolean(value))
    )
  );
  const fetchedTimes = Array.from(new Set([...input.plans, ...input.scores].map((row) => formatDateTimeShort(row.fetchedAt))));
  lines.push("\n资料页追溯：");
  lines.push("使用的数据表：admission_plans、admission_scores、admission_sources。");
  if (input.schoolProfileText) lines.push("院校基础信息补充表：school_profiles。");
  lines.push(`掌上高考来源记录：${sourceIds.length ? sourceIds.slice(0, 24).join("、") : "本次没有匹配到来源记录"}`);
  if (input.sourceSnapshots.length) {
    lines.push("掌上高考来源快照：");
    for (const snapshot of input.sourceSnapshots.slice(0, 8)) {
      lines.push(renderAdmissionSourceSnapshotLine(snapshot));
    }
  }
  if (input.syncSummary && !sourceIds.length) {
    lines.push(`本次同步来源快照数：${input.syncSummary.sourceRows}；没有入库行时，说明源站响应未包含当前查询条件可用的数据行。`);
  }
  lines.push(`抓取时间：${fetchedTimes.length ? fetchedTimes.slice(0, 12).join("、") : "暂无"}`);
  lines.push(`原始数据行摘要：${renderRawSnapshotSummary(input.plans, input.scores)}`);
  lines.push("\n来源：掌上高考公开聚合数据；最终请以省考试院和学校招生网为准。");
  return lines.join("\n");
}

function renderAdmissionSubjectQuerySuffix(subjectType: string | null, subjectTypes: string[]): string {
  if (!subjectTypes.length) return "";
  if (subjectTypes.length === 1 && subjectTypes[0] === subjectType) return "";
  return `；实际检索科类：${subjectTypes.join(" / ")}`;
}

function renderMajorFallbackNotice(majorName: string, planMajorFallback: boolean, scoreMajorFallback: boolean): string {
  const tables = [
    planMajorFallback ? "招生计划" : null,
    scoreMajorFallback ? "录取分数/位次" : null
  ].filter(Boolean);
  return `专业匹配提示：用户请求了“${majorName}”，但${tables.join("、")}没有检索到完全匹配的专业记录；下方对应表格已回退展示当前学校/省份/科类/年份的通用记录。回答时必须明确这些不是“${majorName}”的精确专业数据，不能把院校线或其他专业计划当成该专业结论。`;
}

function renderAdmissionReferenceTable(plans: AdmissionPlanRow[], scores: AdmissionScoreRow[]): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  const pushLine = (
    keyParts: Array<string | number | null | undefined>,
    values: Array<string | number | null | undefined>
  ) => {
    const key = keyParts.map((value) => String(value ?? "")).join("|");
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(values.map((value) => value ?? "-").join(" | "));
  };

  const scoreRows = scores
    .slice()
    .sort((left, right) => right.year - left.year || scoreTrendPriority(left) - scoreTrendPriority(right))
    .slice(0, 16);
  for (const row of scoreRows) {
    const planCount = row.planCount ?? findMatchingPlanCount(row, plans) ?? "-";
    pushLine(
      ["score", row.year, row.scoreType, row.subjectType, row.batch, row.planGroup, row.majorName],
      [
        row.year,
        row.scoreType === "major" ? "专业线" : "院校线",
        row.subjectType ?? "-",
        [row.batch, row.planGroup].filter(Boolean).join(" ") || "-",
        row.majorName ?? "院校线",
        row.minScore ?? "-",
        row.minRank ?? "-",
        row.avgScore ?? "-",
        row.avgRank ?? "-",
        row.maxScore ?? "-",
        row.controlScore ?? "-",
        row.diffScore ?? "-",
        planCount,
        formatDateTimeShort(row.fetchedAt)
      ]
    );
  }

  const scoreYears = new Set(scores.map((row) => row.year));
  const planRows = plans
    .filter((row) => !scoreYears.has(row.year))
    .slice()
    .sort((left, right) => right.year - left.year || String(left.majorName ?? "").localeCompare(String(right.majorName ?? ""), "zh-CN"))
    .slice(0, 16);
  for (const row of planRows) {
    pushLine(
      ["plan", row.year, row.subjectType, row.batch, row.planGroup, row.majorName],
      [
        row.year,
        "招生计划",
        row.subjectType ?? "-",
        [row.batch, row.planGroup].filter(Boolean).join(" ") || "-",
        row.majorName ?? "院校计划汇总",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        "-",
        row.planCount ?? row.schoolPlanCount ?? "-",
        formatDateTimeShort(row.fetchedAt)
      ]
    );
  }

  return lines.slice(0, 24);
}

function findMatchingPlanCount(score: AdmissionScoreRow, plans: AdmissionPlanRow[]): number | null {
  const sameYear = plans.filter((plan) => plan.year === score.year && admissionRowsSameBucket(score, plan));
  const majorName = normalizeComparableMajor(score.majorName);
  if (majorName) {
    const exactMajor = sameYear.find((plan) => normalizeComparableMajor(plan.majorName) === majorName && typeof plan.planCount === "number");
    if (exactMajor?.planCount !== null && exactMajor?.planCount !== undefined) return exactMajor.planCount;
  }
  const summary = sameYear.find((plan) => !plan.majorName && typeof plan.schoolPlanCount === "number");
  if (summary?.schoolPlanCount !== null && summary?.schoolPlanCount !== undefined) return summary.schoolPlanCount;
  const anyPlan = sameYear.find((plan) => typeof plan.planCount === "number");
  return anyPlan?.planCount ?? null;
}

function admissionRowsSameBucket(score: AdmissionScoreRow, plan: AdmissionPlanRow): boolean {
  if (score.subjectType && plan.subjectType && score.subjectType !== plan.subjectType) return false;
  if (score.batch && plan.batch && score.batch !== plan.batch) return false;
  if (score.planGroup && plan.planGroup && score.planGroup !== plan.planGroup) return false;
  return true;
}

function normalizeComparableMajor(value: string | null): string | null {
  if (!value) return null;
  return value.replace(/[（）()\s]/gu, "").toLowerCase();
}

function renderScoreTrendSummary(scores: AdmissionScoreRow[]): string | null {
  const rankedRows = scores
    .filter((row) => row.minRank !== null || row.minScore !== null)
    .slice()
    .sort((left, right) => right.year - left.year || scoreTrendPriority(left) - scoreTrendPriority(right));
  if (!rankedRows.length) return null;

  const bestByYear = new Map<number, AdmissionScoreRow>();
  for (const row of rankedRows) {
    const existing = bestByYear.get(row.year);
    if (!existing || scoreTrendPriority(row) < scoreTrendPriority(existing)) {
      bestByYear.set(row.year, row);
    }
  }
  const yearly = Array.from(bestByYear.values()).sort((left, right) => right.year - left.year);
  const ranks = yearly.map((row) => row.minRank).filter((value): value is number => typeof value === "number");
  const scoresOnly = yearly.map((row) => row.minScore).filter((value): value is number => typeof value === "number");
  const avgScores = yearly.map((row) => row.avgScore).filter((value): value is number => typeof value === "number");
  const maxScores = yearly.map((row) => row.maxScore).filter((value): value is number => typeof value === "number");
  const controlScores = yearly.map((row) => row.controlScore).filter((value): value is number => typeof value === "number");
  const diffScores = yearly.map((row) => row.diffScore).filter((value): value is number => typeof value === "number");
  const plans = yearly.map((row) => row.planCount).filter((value): value is number => typeof value === "number");
  const lines = [
    `代表记录：${yearly.map((row) => renderScoreTrendRecord(row)).join("；")}`
  ];
  if (ranks.length) lines.push(`最低位次区间：${Math.min(...ranks)}-${Math.max(...ranks)}，位次数字越小通常代表录取门槛越高。`);
  if (scoresOnly.length) lines.push(`最低分区间：${Math.min(...scoresOnly)}-${Math.max(...scoresOnly)}。`);
  if (avgScores.length) lines.push(`平均分区间：${Math.min(...avgScores)}-${Math.max(...avgScores)}。`);
  if (maxScores.length) lines.push(`最高分区间：${Math.min(...maxScores)}-${Math.max(...maxScores)}。`);
  if (controlScores.length) lines.push(`省控线区间：${Math.min(...controlScores)}-${Math.max(...controlScores)}。`);
  if (diffScores.length) lines.push(`线差区间：${Math.min(...diffScores)}-${Math.max(...diffScores)}。`);
  if (plans.length) lines.push(`计划数范围：${Math.min(...plans)}-${Math.max(...plans)}。`);
  const latest = yearly[0];
  const previous = yearly[1];
  if (latest && previous && latest.minRank !== null && previous.minRank !== null) {
    const delta = latest.minRank - previous.minRank;
    const direction = delta < 0 ? "位次前移，门槛抬高" : delta > 0 ? "位次后移，门槛降低" : "位次基本持平";
    lines.push(`最近变化：${latest.year} 相比 ${previous.year} ${direction}（变化 ${Math.abs(delta)} 位）。`);
  }
  return lines.join("\n");
}

function scoreTrendPriority(row: AdmissionScoreRow): number {
  const rankPenalty = row.minRank === null ? 1_000_000_000 : row.minRank;
  const typePenalty = row.scoreType === "school" ? 0 : 100_000_000;
  return typePenalty + rankPenalty;
}

function renderScoreTrendRecord(row: AdmissionScoreRow): string {
  const parts = [
    `${row.year}${row.scoreType === "major" ? "专业线" : "院校线"}${row.majorName ? `/${row.majorName}` : ""}`,
    row.minScore !== null ? `最低${row.minScore}分` : null,
    row.minRank !== null ? `位次${row.minRank}` : null,
    row.avgScore !== null ? `平均${row.avgScore}分` : null,
    row.maxScore !== null ? `最高${row.maxScore}分` : null,
    row.controlScore !== null ? `省控线${row.controlScore}` : null,
    row.diffScore !== null ? `线差${row.diffScore}` : null
  ].filter(Boolean);
  return parts.join(" ");
}

function summarizeAdmissionSync(result: Partial<GaokaoCnSyncResult>): AdmissionSyncSummary {
  return {
    total: toSafeCount(result.total),
    candidateTotal: toSafeCount(result.candidateTotal),
    offset: toSafeCount(result.offset),
    nextOffset: toSafeCount(result.nextOffset),
    mapped: toSafeCount(result.mapped),
    planRows: toSafeCount(result.planRows),
    schoolScoreRows: toSafeCount(result.schoolScoreRows),
    majorScoreRows: toSafeCount(result.majorScoreRows),
    sourceRows: toSafeCount(result.sourceRows),
    sourceRequests: toSafeCount(result.sourceRequests),
    sourceRequestBudget: typeof result.sourceRequestBudget === "number" ? result.sourceRequestBudget : null,
    requestBudgetExhausted: Boolean(result.requestBudgetExhausted),
    skippedRequests: toSafeCount(result.skippedRequests),
    skipped: toSafeCount(result.skipped),
    errorCount: Array.isArray(result.errors) ? result.errors.length : 0
  };
}

function summarizeAdmissionSyncResults(results: GaokaoCnSyncResult[]): AdmissionSyncSummary | null {
  if (!results.length) return null;
  const summaries = results.map((result) => summarizeAdmissionSync(result));
  return {
    total: Math.max(...summaries.map((item) => item.total)),
    candidateTotal: Math.max(...summaries.map((item) => item.candidateTotal)),
    offset: Math.min(...summaries.map((item) => item.offset)),
    nextOffset: Math.max(...summaries.map((item) => item.nextOffset)),
    mapped: Math.max(...summaries.map((item) => item.mapped)),
    planRows: summaries.reduce((sum, item) => sum + item.planRows, 0),
    schoolScoreRows: summaries.reduce((sum, item) => sum + item.schoolScoreRows, 0),
    majorScoreRows: summaries.reduce((sum, item) => sum + item.majorScoreRows, 0),
    sourceRows: summaries.reduce((sum, item) => sum + item.sourceRows, 0),
    sourceRequests: summaries.reduce((sum, item) => sum + item.sourceRequests, 0),
    sourceRequestBudget: summaries.find((item) => item.sourceRequestBudget !== null)?.sourceRequestBudget ?? null,
    requestBudgetExhausted: summaries.some((item) => item.requestBudgetExhausted),
    skippedRequests: summaries.reduce((sum, item) => sum + item.skippedRequests, 0),
    skipped: summaries.reduce((sum, item) => sum + item.skipped, 0),
    errorCount: summaries.reduce((sum, item) => sum + item.errorCount, 0)
  };
}

function hasGaokaoRateLimitSyncResult(result: GaokaoCnSyncResult): boolean {
  return Array.isArray(result.errors) && result.errors.some((error) => isGaokaoCnRateLimitError(error.message));
}

function hasAdmissionRealtimeSyncBudget(budget?: AdmissionRealtimeSyncBudget): boolean {
  return !budget || budget.remaining === null || budget.remaining > 0;
}

function admissionRealtimeMaxSourceRequests(budget: AdmissionRealtimeSyncBudget | undefined, fallback?: number): number | undefined {
  if (!budget || budget.remaining === null) return fallback;
  return Math.max(0, budget.remaining);
}

function consumeAdmissionRealtimeSyncBudget(budget: AdmissionRealtimeSyncBudget | undefined, result: GaokaoCnSyncResult): void {
  if (!budget || budget.remaining === null) return;
  budget.remaining = Math.max(0, budget.remaining - toSafeCount(result.sourceRequests));
}

function renderRawSnapshotSummary(plans: AdmissionPlanRow[], scores: AdmissionScoreRow[]): string {
  const snippets = [...plans.slice(0, 2), ...scores.slice(0, 2)]
    .map((row) => summarizeRawJson(row.rawJson))
    .filter(Boolean);
  return snippets.length ? snippets.join("；") : "暂无可展示的原始 JSON 摘要";
}

function renderAdmissionSourceSnapshotLine(snapshot: AdmissionSourceRow): string {
  const request = summarizeSourceRequest(snapshot.requestJson);
  const response = summarizeSourceResponse(snapshot.responseJson, snapshot.error);
  return [
    `#${snapshot.id}`,
    snapshot.sourceKind,
    snapshot.status,
    `抓取=${formatDateTimeShort(snapshot.fetchedAt)}`,
    `URL=${snapshot.sourceUrl}`,
    `请求=${request}`,
    `响应=${response}`
  ].join("；");
}

function summarizeSourceRequest(requestJson: string): string {
  try {
    const data = JSON.parse(requestJson) as Record<string, unknown>;
    return pickObjectEntries(data, ["uri", "school_id", "local_province_id", "local_type_id", "year", "page", "size"]).join(", ") || requestJson.slice(0, 180);
  } catch {
    return requestJson.slice(0, 180);
  }
}

function summarizeSourceResponse(responseJson: string | null, error: string | null): string {
  if (error) return error;
  if (!responseJson) return "无响应正文";
  try {
    const data = JSON.parse(responseJson) as Record<string, unknown>;
    const summary = pickObjectEntries(data, ["code", "message", "location"]);
    const itemCount = countResponseItems(data);
    if (itemCount !== null) summary.push(`item_count=${itemCount}`);
    return summary.join(", ") || responseJson.slice(0, 220);
  } catch {
    return responseJson.slice(0, 220);
  }
}

function pickObjectEntries(data: Record<string, unknown>, keys: string[]): string[] {
  return keys
    .filter((key) => data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== "")
    .map((key) => `${key}=${String(data[key])}`);
}

function countResponseItems(data: Record<string, unknown>): number | null {
  const body = data.data;
  if (!body || typeof body !== "object") return null;
  const item = (body as Record<string, unknown>).item;
  if (Array.isArray(item)) return item.length;
  return null;
}

function summarizeRawJson(rawJson: string): string {
  try {
    const data = JSON.parse(rawJson) as Record<string, unknown>;
    const picked = Object.entries(data)
      .filter(([key]) =>
        [
          "year",
          "local_province_name",
          "local_type_name",
          "local_batch_name",
          "sg_name",
          "spname",
          "sp_name",
          "num",
          "tuition",
          "length",
          "campus",
          "campus_name",
          "min",
          "min_section"
        ].includes(key)
      )
      .slice(0, 8);
    return picked.map(([key, value]) => `${key}=${String(value ?? "-")}`).join(", ");
  } catch {
    return rawJson.slice(0, 180);
  }
}

function normalizeSchoolName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[·.\s（）()]/g, "")
    .trim();
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(toCleanString).filter((item): item is string => Boolean(item));
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.floor(item));
}

function toSafeCount(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function toCleanString(value: unknown): string | null {
  const text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return text && text !== "null" && text !== "undefined" ? text : null;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatDateTimeShort(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function normalizeLlmFailureMessage(error: unknown, timeoutMs: number): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/aborted|aborterror|timeout|timed out/i.test(raw)) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    return `模型响应超时或连接被中断，已等待约 ${seconds} 秒。可以稍后重试，或在后台把“模型超时毫秒”继续调大。`;
  }
  if (/fetch failed|econnreset|etimedout|socket|network/i.test(raw)) {
    return "模型接口网络连接失败，可以稍后重试，或检查 API 源站、反代和服务器网络。";
  }
  return raw || "未知错误";
}

function getPublicBaseUrl(runtime: ReturnType<SettingsStore["runtime"]>): string {
  const site = (runtime as typeof runtime & { site?: { publicBaseUrl?: string } }).site;
  return (site?.publicBaseUrl ?? "").trim().replace(/\/+$/g, "");
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

function renderGreetingReply(): string {
  return [
    "你好，我可以帮你查高校生活资料。",
    "不用命令，直接像聊天一样问就行，例如：",
    "安大宿舍怎么样",
    "西电能点外卖吗",
    "南航校园网咋样"
  ].join("\n");
}

function renderCasualFallback(hasContext: boolean): string {
  if (hasContext) {
    return "我没太理解你想继续查哪个方面。可以直接说想查的学校和具体方面，比如宿舍、食堂、校园网、外卖或澡堂。";
  }

  return "模型回复暂时失败了。你可以直接用自然语言问学校资料、招生计划、分数线，或者普通聊天也可以。";
}
