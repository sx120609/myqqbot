import { basename } from "node:path";

export interface ParsedAnswer {
  sourceId: string;
  respondent: string | null;
  answeredAt: string | null;
  text: string;
}

export interface ParsedQuestion {
  question: string;
  topic: string;
  position: number;
  answers: ParsedAnswer[];
}

export interface ParsedUniversity {
  name: string;
  slug: string;
  filePath: string;
  sourceUrl: string;
  rawMarkdown: string;
  questions: ParsedQuestion[];
}

interface SourceInfo {
  respondent: string | null;
  answeredAt: string | null;
}

export function parseUniversityMarkdown(filePath: string, sourceUrl: string, markdown: string): ParsedUniversity | null {
  const title = markdown.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  if (!title) return null;

  const slug = basename(filePath).replace(/\.md$/i, "");
  const sources = parseSourceInfo(markdown);
  const questionMatches = [...markdown.matchAll(/^##\s+Q:\s*(.+?)\s*$/gm)];
  const questions: ParsedQuestion[] = [];

  for (let index = 0; index < questionMatches.length; index += 1) {
    const match = questionMatches[index];
    const next = questionMatches[index + 1];
    const question = match[1].trim();
    const block = markdown.slice((match.index ?? 0) + match[0].length, next?.index ?? markdown.length);
    const answers = parseAnswers(block, sources);
    questions.push({
      question,
      topic: "general",
      position: index,
      answers
    });
  }

  return {
    name: title,
    slug,
    filePath,
    sourceUrl,
    rawMarkdown: markdown,
    questions
  };
}

function parseSourceInfo(markdown: string): Map<string, SourceInfo> {
  const sources = new Map<string, SourceInfo>();
  const pattern = /<li>(A\d+):\s*(.+?)\s*\((\d{4})\s*年\s*(\d{1,2})\s*月\)<\/li>/g;
  for (const match of markdown.matchAll(pattern)) {
    sources.set(match[1], {
      respondent: match[2].trim() || null,
      answeredAt: `${match[3]}-${match[4].padStart(2, "0")}`
    });
  }
  return sources;
}

function parseAnswers(block: string, sources: Map<string, SourceInfo>): ParsedAnswer[] {
  const answers: ParsedAnswer[] = [];
  let current: ParsedAnswer | null = null;

  for (const line of block.split(/\r?\n/)) {
    const answerStart = line.match(/^-\s*(A\d+):\s*(.*)$/);
    if (answerStart) {
      if (current && current.text.trim()) answers.push(current);
      const sourceId = answerStart[1];
      const source = sources.get(sourceId);
      current = {
        sourceId,
        respondent: source?.respondent ?? null,
        answeredAt: source?.answeredAt ?? null,
        text: answerStart[2].trim()
      };
      continue;
    }

    if (!current) continue;
    if (/^##\s+Q:/.test(line)) break;
    if (!line.trim()) continue;
    current.text = `${current.text}\n${line.trim()}`.trim();
  }

  if (current && current.text.trim()) answers.push(current);
  return answers;
}
