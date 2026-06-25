import type { QuestionWithAnswers, UniversityRepository, UniversityRow } from "./university-repository.js";

export interface MessageAnalysis {
  candidates: Array<UniversityRow & { matchedBy: string; score: number }>;
  reason: string;
}

export class NaturalLanguageService {
  constructor(private readonly universities: UniversityRepository) {}

  analyze(message: string, contextUniversityId?: number): MessageAnalysis {
    const candidates = this.universities.findSchoolCandidates(message);
    const hasContext = Boolean(contextUniversityId);

    return {
      candidates,
      reason: candidates.length || hasContext ? "本地学校候选，仅供模型路由参考" : "没有本地学校候选"
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
