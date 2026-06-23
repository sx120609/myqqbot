import { detectTopics, topicLabel } from "../domain/topics.js";
import type { QuestionWithAnswers, UniversityRepository, UniversityRow } from "./university-repository.js";

export interface MessageAnalysis {
  isUniversityQuery: boolean;
  confidence: number;
  topicKey: string | null;
  topicLabel: string | null;
  candidates: Array<UniversityRow & { matchedBy: string; score: number }>;
  reason: string;
}

const SCHOOL_HINTS = ["大学", "学院", "学校", "校区", "高职", "专科", "职院"];
const QUERY_HINTS = [
  "宿舍",
  "寝室",
  "食堂",
  "外卖",
  "校园网",
  "空调",
  "澡堂",
  "独卫",
  "早自习",
  "晚自习",
  "晨跑",
  "跑操",
  "快递",
  "门禁",
  "查寝",
  "电瓶车",
  "交通",
  "怎么样",
  "咋样",
  "如何",
  "方便",
  "严不严",
  "能不能",
  "可以吗"
];

export class NaturalLanguageService {
  constructor(private readonly universities: UniversityRepository) {}

  analyze(message: string, contextUniversityId?: number): MessageAnalysis {
    const candidates = this.universities.findSchoolCandidates(message);
    const topics = detectTopics(message);
    const hasSchoolHint = SCHOOL_HINTS.some((hint) => message.includes(hint));
    const hasQueryHint = QUERY_HINTS.some((hint) => message.includes(hint));
    const topic = topics[0] ?? null;
    const hasContext = Boolean(contextUniversityId && hasQueryHint);
    const isUniversityQuery = Boolean(candidates.length || hasContext || (hasSchoolHint && hasQueryHint));
    const schoolConfidence = candidates[0]?.score ?? (hasContext ? 0.45 : 0);
    const topicConfidence = topic ? 0.25 : hasQueryHint ? 0.15 : 0;
    const confidence = Math.min(1, schoolConfidence + topicConfidence + (hasSchoolHint ? 0.1 : 0));

    return {
      isUniversityQuery,
      confidence,
      topicKey: topic?.key ?? null,
      topicLabel: topic ? topicLabel(topic.key) : null,
      candidates,
      reason: isUniversityQuery ? "命中学校或高校生活关键词" : "没有明显高校资料查询意图"
    };
  }

  buildRetrievalContext(universityName: string, questions: QuestionWithAnswers[]): string {
    const parts = [`学校：${universityName}`];
    for (const question of questions) {
      parts.push(`\n问题：${question.question}`);
      for (const answer of question.answers) {
        parts.push(`- ${answer.sourceId}${answer.answeredAt ? `(${answer.answeredAt})` : ""}: ${answer.text}`);
      }
    }
    return parts.join("\n").slice(0, 12000);
  }
}

