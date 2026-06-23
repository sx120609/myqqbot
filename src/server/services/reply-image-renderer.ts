import { Resvg } from "@resvg/resvg-js";

export interface RenderedReplyImage {
  mimeType: "image/png";
  dataBase64: string;
  bytes: number;
}

export interface ReplyImageOptions {
  headerTitle?: string;
  headerBadge?: string;
}

interface InlineSegment {
  text: string;
  bold?: boolean;
  code?: boolean;
}

interface VisualLine {
  kind?: "text" | "rule";
  segments: InlineSegment[];
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  color: string;
  weight: number;
  marginTop: number;
}

interface LineStyle {
  fontSize: number;
  lineHeight: number;
  color: string;
  weight: number;
  marginTop: number;
  indent?: number;
  hangingIndent?: number;
  prefix?: string;
}

const WIDTH = 900;
const CARD_X = 22;
const CONTENT_X = 58;
const CONTENT_WIDTH = WIDTH - CONTENT_X * 2;
const HEADER_Y = 54;
const BODY_TOP = 116;
const BOTTOM = 52;
const FONT_FAMILY = "Noto Sans CJK SC, Microsoft YaHei, PingFang SC, SimHei, Arial, sans-serif";

export function renderReplyImage(markdown: string, options: ReplyImageOptions = {}): RenderedReplyImage {
  const clean = normalizeMarkdown(markdown);
  const lines = layoutMarkdown(clean || " ");
  const lastLine = lines.at(-1);
  const contentBottom = lastLine ? lastLine.y + (lastLine.kind === "rule" ? lastLine.lineHeight : 0) : BODY_TOP;
  const height = Math.max(220, Math.ceil(contentBottom + BOTTOM));
  const svg = renderSvg(lines, height, options);
  const png = new Resvg(svg, {
    fitTo: { mode: "original" },
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "Noto Sans CJK SC"
    }
  })
    .render()
    .asPng();
  const buffer = Buffer.from(png);
  return {
    mimeType: "image/png",
    dataBase64: buffer.toString("base64"),
    bytes: buffer.byteLength
  };
}

export function markdownToPlainText(markdown: string): string {
  return normalizeMarkdown(markdown)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "")
    .replace(/(^|\s)\*\*([^*]+)\*\*/g, "$1$2")
    .replace(/(^|\s)__([^_]+)__/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}>\s?/gm, "")
    .trim();
}

function layoutMarkdown(markdown: string): VisualLine[] {
  const lines = markdown.split("\n");
  const visual: VisualLine[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    addWrappedText(visual, paragraph.join(" "), bodyStyle(visual.length === 0 ? 0 : 18));
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const horizontalRule = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
    if (horizontalRule) {
      flushParagraph();
      addHorizontalRule(visual);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      addWrappedText(visual, heading[2].replace(/\s+#{1,}\s*$/, ""), headingStyle(heading[1].length, visual.length === 0 ? 0 : 22));
      continue;
    }

    const unordered = /^\s{0,6}[-*+]\s+(.+)$/.exec(line);
    if (unordered) {
      flushParagraph();
      addWrappedText(visual, unordered[1], {
        ...bodyStyle(visual.length === 0 ? 0 : 10),
        prefix: "• ",
        hangingIndent: 30
      });
      continue;
    }

    const ordered = /^\s{0,6}(\d+)[.)]\s+(.+)$/.exec(line);
    if (ordered) {
      flushParagraph();
      addWrappedText(visual, ordered[2], {
        ...bodyStyle(visual.length === 0 ? 0 : 10),
        prefix: `${ordered[1]}. `,
        hangingIndent: 40
      });
      continue;
    }

    const quote = /^\s{0,3}>\s?(.+)$/.exec(line);
    if (quote) {
      flushParagraph();
      addWrappedText(visual, quote[1], {
        fontSize: 27,
        lineHeight: 42,
        color: "#5f6b7a",
        weight: 500,
        marginTop: visual.length === 0 ? 0 : 14,
        indent: 24
      });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  return positionLines(visual);
}

function bodyStyle(marginTop: number): LineStyle {
  return {
    fontSize: 28,
    lineHeight: 45,
    color: "#1f2937",
    weight: 500,
    marginTop
  };
}

function headingStyle(level: number, marginTop: number): LineStyle {
  const sizes = [34, 31, 29, 28, 27, 26];
  const lineHeights = [48, 44, 42, 41, 39, 38];
  const index = Math.min(Math.max(level, 1), 6) - 1;
  return {
    fontSize: sizes[index],
    lineHeight: lineHeights[index],
    color: "#162033",
    weight: 800,
    marginTop
  };
}

function addHorizontalRule(target: VisualLine[]): void {
  target.push({
    kind: "rule",
    segments: [],
    x: CONTENT_X,
    y: 0,
    fontSize: 0,
    lineHeight: 28,
    color: "#eee6da",
    weight: 0,
    marginTop: target.length === 0 ? 0 : 18
  });
}

function addWrappedText(target: VisualLine[], text: string, style: LineStyle): void {
  const sourceText = text.includes("数据来自 CollegesChat")
    ? text
    : text.replace(/\s+/g, " ");
  const isFooter = sourceText.includes("数据来自 CollegesChat");
  const finalStyle = isFooter
    ? { ...style, fontSize: 23, lineHeight: 36, color: "#7a6f65", weight: 500, marginTop: Math.max(style.marginTop, 22) }
    : style;
  const x = CONTENT_X + (finalStyle.indent ?? 0);
  const prefix = finalStyle.prefix ? parseInline(finalStyle.prefix) : [];
  const prefixWidth = measureSegments(prefix, finalStyle.fontSize);
  const hangingIndent = finalStyle.hangingIndent ?? 0;
  const firstWidth = CONTENT_WIDTH - (finalStyle.indent ?? 0) - prefixWidth;
  const nextWidth = CONTENT_WIDTH - (finalStyle.indent ?? 0) - hangingIndent;
  const wrapped = wrapSegments(parseInline(sourceText), firstWidth, nextWidth, finalStyle.fontSize);

  wrapped.forEach((segments, index) => {
    target.push({
      segments: index === 0 ? [...prefix, ...segments] : segments,
      x: index === 0 ? x : x + hangingIndent,
      y: 0,
      fontSize: finalStyle.fontSize,
      lineHeight: finalStyle.lineHeight,
      color: finalStyle.color,
      weight: finalStyle.weight,
      marginTop: index === 0 ? finalStyle.marginTop : 0
    });
  });
}

function positionLines(lines: VisualLine[]): VisualLine[] {
  let cursor = BODY_TOP;
  return lines.map((line) => {
    cursor += line.marginTop;
    const positioned = { ...line, y: cursor + line.fontSize };
    cursor += line.lineHeight;
    return positioned;
  });
}

function wrapSegments(segments: InlineSegment[], firstWidth: number, nextWidth: number, fontSize: number): InlineSegment[][] {
  const lines: InlineSegment[][] = [];
  let current: InlineSegment[] = [];
  let width = 0;
  let limit = firstWidth;

  for (const segment of segments) {
    for (const char of Array.from(segment.text)) {
      const charWidth = estimateCharWidth(char, fontSize);
      if (width + charWidth > limit && current.length) {
        trimTrailingSpaces(current);
        lines.push(current);
        current = [];
        width = 0;
        limit = nextWidth;
        if (char === " ") continue;
      }
      pushSegmentChar(current, char, segment);
      width += charWidth;
    }
  }

  trimTrailingSpaces(current);
  if (current.length) lines.push(current);
  return lines.length ? lines : [[]];
}

function parseInline(text: string): InlineSegment[] {
  const normalized = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  const parts = normalized.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`)/g).filter(Boolean);
  return parts.map((part) => {
    if ((part.startsWith("**") && part.endsWith("**")) || (part.startsWith("__") && part.endsWith("__"))) {
      return { text: part.slice(2, -2), bold: true };
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return { text: part.slice(1, -1), code: true };
    }
    return { text: part };
  });
}

function pushSegmentChar(target: InlineSegment[], char: string, source: InlineSegment): void {
  const last = target.at(-1);
  if (last && last.bold === source.bold && last.code === source.code) {
    last.text += char;
  } else {
    target.push({ text: char, bold: source.bold, code: source.code });
  }
}

function trimTrailingSpaces(segments: InlineSegment[]): void {
  while (segments.length) {
    const last = segments.at(-1);
    if (!last) return;
    const trimmed = last.text.replace(/\s+$/g, "");
    if (trimmed) {
      last.text = trimmed;
      return;
    }
    segments.pop();
  }
}

function measureSegments(segments: InlineSegment[], fontSize: number): number {
  return segments.reduce((total, segment) => {
    return total + Array.from(segment.text).reduce((sum, char) => sum + estimateCharWidth(char, fontSize), 0);
  }, 0);
}

function estimateCharWidth(char: string, fontSize: number): number {
  if (char === " ") return fontSize * 0.34;
  const code = char.codePointAt(0) ?? 0;
  if (
    code >= 0x1100 &&
    (code <= 0x11ff ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe19) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff))
  ) {
    return fontSize;
  }
  if (/[A-Z]/.test(char)) return fontSize * 0.64;
  if (/[a-z0-9]/.test(char)) return fontSize * 0.55;
  if (/[,.;:!?'"()[\]{}<>/\\|]/.test(char)) return fontSize * 0.38;
  return fontSize * 0.58;
}

function renderSvg(lines: VisualLine[], height: number, options: ReplyImageOptions): string {
  const lineSvg = lines
    .map((line) => {
      if (line.kind === "rule") {
        const y = line.y + 11;
        return `<line x1="${CONTENT_X}" y1="${y}" x2="${WIDTH - CONTENT_X}" y2="${y}" stroke="${line.color}" stroke-width="2"/>`;
      }
      const segments = line.segments
        .map((segment) => {
          const weight = segment.bold ? 800 : line.weight;
          const fill = segment.code ? "#0f766e" : line.color;
          return `<tspan font-weight="${weight}" fill="${fill}">${escapeXml(segment.text)}</tspan>`;
        })
        .join("");
      return `<text x="${line.x}" y="${line.y}" font-family="${FONT_FAMILY}" font-size="${line.fontSize}" font-weight="${line.weight}" fill="${line.color}">${segments}</text>`;
    })
    .join("");

  const titleX = 84;
  const headerRight = WIDTH - CONTENT_X;
  const headerGap = 28;
  const rawHeaderTitle = options.headerTitle || "高校资料助手";
  const rawHeaderBadge = options.headerBadge || "AI 生成回复";
  const badgeMaxWidth = Math.min(470, headerRight - titleX - 160 - headerGap);
  const headerBadge = fitText(rawHeaderBadge, 20, badgeMaxWidth);
  const badgeWidth = measureText(headerBadge, 20);
  const badgeX = headerRight - badgeWidth;
  const titleMaxWidth = Math.max(120, badgeX - titleX - headerGap);
  const headerTitle = fitText(rawHeaderTitle, 26, titleMaxWidth);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}">
  <rect width="100%" height="100%" fill="#f4f1ea"/>
  <rect x="${CARD_X}" y="22" width="${WIDTH - CARD_X * 2}" height="${height - 44}" rx="26" fill="#fffdf9" stroke="#e5ded3" stroke-width="2"/>
  <circle cx="58" cy="${HEADER_Y}" r="14" fill="#16a34a"/>
  <text x="${titleX}" y="${HEADER_Y + 9}" font-family="${FONT_FAMILY}" font-size="26" font-weight="800" fill="#182235">${escapeXml(headerTitle)}</text>
  <text x="${badgeX}" y="${HEADER_Y + 7}" font-family="${FONT_FAMILY}" font-size="20" font-weight="500" fill="#8a8177">${escapeXml(headerBadge)}</text>
  <line x1="${CONTENT_X}" y1="88" x2="${WIDTH - CONTENT_X}" y2="88" stroke="#eee6da" stroke-width="2"/>
  ${lineSvg}
</svg>`;
}

function fitText(text: string, fontSize: number, maxWidth: number): string {
  const clean = text.trim() || " ";
  if (measureText(clean, fontSize) <= maxWidth) return clean;
  let result = "";
  for (const char of Array.from(clean)) {
    if (measureText(`${result}${char}...`, fontSize) > maxWidth) break;
    result += char;
  }
  return `${result || clean.slice(0, 1)}...`;
}

function measureText(text: string, fontSize: number): number {
  return Array.from(text).reduce((sum, char) => sum + estimateCharWidth(char, fontSize), 0);
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
