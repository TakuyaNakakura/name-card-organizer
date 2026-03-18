import type { ContactExtractionResult, OcrBlock, OcrResult } from "@/lib/types";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EMAIL_TEST_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_PATTERN = /(https?:\/\/|www\.)/i;
const COMPANY_PATTERN =
  /(inc\.?|corp\.?|co\.?,?|llc|ltd\.?|gmbh|group|company|株式会社|有限会社|合同会社|学校法人|医療法人|財団法人|社団法人|グループ|研究所|センター|大学|病院|銀行|機構|協会)/i;
const TITLE_PATTERN =
  /(engineer|manager|director|officer|president|sales|marketing|head|lead|manager|ceo|cto|coo|cfo|vp|部長|課長|営業|取締役|代表|主任|執行役員|マネージャー|リーダー|教授|准教授|所長|室長|コーディネーター)/i;
const ORG_UNIT_PATTERN =
  /(division|department|studio|office|team|group|本部|事業部|開発部|営業部|部署|支社|支店|営業所|研究室|研究部|管理部|総務部|企画部|課|係|室|局)/i;
const PHONE_PATTERN = /(\+?\d[\d()\-\s]{7,}\d)/;
const JAPANESE_NAME_PATTERN =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,8}(?:\s*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,8}){1,2}$/u;
const LATIN_NAME_PATTERN =
  /^[A-Za-z][A-Za-z.'-]{0,30}(?:\s+[A-Za-z][A-Za-z.'-]{0,30}){1,3}$/;

interface ScoredCandidate {
  text: string;
  score: number;
}

interface OcrLine extends OcrBlock {
  text: string;
}

function normalizeText(text: string) {
  return text.trim().replace(/\s+/g, " ");
}

function extractLines(blocks: OcrBlock[]): OcrLine[] {
  return blocks.flatMap((block) => {
    const lines = block.text
      .split(/\n+/)
      .map((line) => normalizeText(line))
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return [];
    }

    const lineHeight = Math.max(block.bounds.height / lines.length, 1);
    return lines.map((text, index) => ({
      text,
      confidence: block.confidence,
      bounds: {
        x: block.bounds.x,
        y: block.bounds.y + lineHeight * index,
        width: block.bounds.width,
        height: lineHeight
      }
    }));
  });
}

function getDocumentHeight(lines: OcrLine[]) {
  return lines.reduce(
    (max, line) => Math.max(max, line.bounds.y + line.bounds.height),
    0
  );
}

function looksLikeName(text: string) {
  return JAPANESE_NAME_PATTERN.test(text) || LATIN_NAME_PATTERN.test(text);
}

function hasContactNoise(text: string) {
  return EMAIL_TEST_REGEX.test(text) || URL_PATTERN.test(text) || PHONE_PATTERN.test(text);
}

function isOrganizationText(text: string) {
  return COMPANY_PATTERN.test(text) || ORG_UNIT_PATTERN.test(text);
}

function isTitleText(text: string) {
  return TITLE_PATTERN.test(text);
}

function getBaseLineScore(line: OcrLine, documentHeight: number) {
  const centerY = line.bounds.y + line.bounds.height / 2;
  const sizeScore = Math.min(line.bounds.height / 48, 1) * 0.3;
  const verticalScore =
    documentHeight > 0 ? Math.max(0, 1 - centerY / documentHeight) * 0.2 : 0;
  const confidenceScore = Math.min(line.confidence, 1) * 0.2;

  return {
    sizeScore,
    verticalScore,
    confidenceScore
  };
}

function scoreNameCandidate(
  text: string,
  line: OcrLine,
  documentHeight: number
): ScoredCandidate {
  const compact = normalizeText(text);
  const { sizeScore, verticalScore, confidenceScore } = getBaseLineScore(
    line,
    documentHeight
  );
  const nameShapeScore = looksLikeName(compact) ? 0.35 : 0;
  let penalty = 0;

  if (compact.length < 2 || compact.length > 48) {
    penalty += 0.4;
  }

  if (EMAIL_TEST_REGEX.test(compact) || URL_PATTERN.test(compact)) {
    penalty += 0.8;
  }

  if (PHONE_PATTERN.test(compact)) {
    penalty += 0.55;
  }

  if (COMPANY_PATTERN.test(compact)) {
    penalty += 0.55;
  }

  if (TITLE_PATTERN.test(compact)) {
    penalty += 0.25;
  }

  if (ORG_UNIT_PATTERN.test(compact)) {
    penalty += 0.45;
  }

  if (!looksLikeName(compact)) {
    penalty += 0.12;
  }

  const digitCount = (compact.match(/\d/g) ?? []).length;
  if (digitCount >= 3) {
    penalty += 0.35;
  }

  return {
    text: compact,
    score: Number(
      Math.max(
        0,
        sizeScore + verticalScore + confidenceScore + nameShapeScore - penalty
      ).toFixed(2)
    )
  };
}

function scoreOrganizationCandidate(
  text: string,
  line: OcrLine,
  documentHeight: number
): ScoredCandidate {
  const compact = normalizeText(text);
  const { sizeScore, verticalScore, confidenceScore } = getBaseLineScore(
    line,
    documentHeight
  );
  let score =
    sizeScore +
    verticalScore +
    confidenceScore +
    (COMPANY_PATTERN.test(compact) ? 0.42 : 0) +
    (ORG_UNIT_PATTERN.test(compact) ? 0.24 : 0);
  let penalty = 0;

  if (compact.length < 2 || compact.length > 80) {
    penalty += 0.4;
  }

  if (hasContactNoise(compact)) {
    penalty += 0.85;
  }

  if (looksLikeName(compact)) {
    penalty += 0.3;
  }

  if (isTitleText(compact)) {
    penalty += 0.22;
  }

  if (!isOrganizationText(compact)) {
    penalty += 0.26;
  }

  return {
    text: compact,
    score: Number(Math.max(0, score - penalty).toFixed(2))
  };
}

function scoreTitleCandidate(
  text: string,
  line: OcrLine,
  documentHeight: number
): ScoredCandidate {
  const compact = normalizeText(text);
  const { sizeScore, verticalScore, confidenceScore } = getBaseLineScore(
    line,
    documentHeight
  );
  let score =
    sizeScore +
    verticalScore +
    confidenceScore +
    (TITLE_PATTERN.test(compact) ? 0.55 : 0);
  let penalty = 0;

  if (compact.length < 2 || compact.length > 64) {
    penalty += 0.35;
  }

  if (hasContactNoise(compact)) {
    penalty += 0.85;
  }

  if (looksLikeName(compact)) {
    penalty += 0.3;
  }

  if (COMPANY_PATTERN.test(compact)) {
    penalty += 0.18;
  }

  if (!TITLE_PATTERN.test(compact)) {
    penalty += 0.28;
  }

  return {
    text: compact,
    score: Number(Math.max(0, score - penalty).toFixed(2))
  };
}

function extractEmail(rawText: string) {
  const matches = Array.from(
    new Set((rawText.match(EMAIL_REGEX) ?? []).map((value) => value.trim()))
  );

  return {
    primary: matches[0] ?? null,
    all: matches
  };
}

function dedupeCandidates(candidates: ScoredCandidate[]) {
  const bestByText = new Map<string, ScoredCandidate>();

  for (const candidate of candidates) {
    const existing = bestByText.get(candidate.text);
    if (!existing || candidate.score > existing.score) {
      bestByText.set(candidate.text, candidate);
    }
  }

  return Array.from(bestByText.values()).sort((left, right) => right.score - left.score);
}

function buildOrganizationCandidates(lines: OcrLine[], documentHeight: number) {
  const singleLineCandidates = lines.map((line) =>
    scoreOrganizationCandidate(line.text, line, documentHeight)
  );
  const pairedCandidates: ScoredCandidate[] = [];

  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index];
    const next = lines[index + 1];
    if (!current || !next) {
      continue;
    }

    const currentText = normalizeText(current.text);
    const nextText = normalizeText(next.text);
    const currentLooksLikeOrganization = isOrganizationText(currentText);
    const nextLooksLikeOrganization = isOrganizationText(nextText);
    const verticalGap = next.bounds.y - (current.bounds.y + current.bounds.height);

    if (
      currentLooksLikeOrganization &&
      nextLooksLikeOrganization &&
      verticalGap <= Math.max(current.bounds.height, next.bounds.height) * 1.4
    ) {
      const combined = `${currentText} ${nextText}`;
      const currentScore = scoreOrganizationCandidate(
        currentText,
        current,
        documentHeight
      ).score;
      const nextScore = scoreOrganizationCandidate(nextText, next, documentHeight).score;
      const companyAndUnitPair =
        COMPANY_PATTERN.test(currentText) && ORG_UNIT_PATTERN.test(nextText) ? 0.1 : 0;
      pairedCandidates.push({
        text: combined,
        score: Number(
          Math.min(1, (currentScore + nextScore) / 2 + 0.22 + companyAndUnitPair).toFixed(2)
        )
      });
    }
  }

  return dedupeCandidates([...singleLineCandidates, ...pairedCandidates]);
}

function pickBestCandidate(
  candidates: ScoredCandidate[],
  minimumScore: number,
  excludedTexts: Set<string>
) {
  return candidates.find(
    (candidate) =>
      candidate.score >= minimumScore && !excludedTexts.has(normalizeText(candidate.text))
  )?.text;
}

export function extractContactInfo(ocr: OcrResult): ContactExtractionResult {
  const warnings: string[] = [];
  const { primary: email, all: allEmails } = extractEmail(ocr.rawText);

  if (!email) {
    warnings.push("メールアドレスを検出できませんでした");
  }

  if (allEmails.length > 1) {
    warnings.push("複数のメールアドレス候補が見つかりました");
  }

  const lines = extractLines(ocr.blocks);
  const documentHeight = getDocumentHeight(lines);
  const candidates = dedupeCandidates(
    lines.map((line) => scoreNameCandidate(line.text, line, documentHeight))
  );

  const top = candidates[0];
  const second = candidates[1];

  let fullName: string | null = null;
  if (top && top.score >= 0.45) {
    fullName = top.text;
    if (second && top.score - second.score < 0.08) {
      warnings.push("名前候補の確度が近いため確認してください");
    }
  } else {
    warnings.push("名前候補の確度が低いため手入力が必要です");
  }

  const excludedTexts = new Set<string>();
  if (fullName) {
    excludedTexts.add(normalizeText(fullName));
  }

  const organizationCandidates = buildOrganizationCandidates(lines, documentHeight);
  const organization = pickBestCandidate(organizationCandidates, 0.45, excludedTexts) ?? null;
  if (organization) {
    excludedTexts.add(normalizeText(organization));
  }

  const jobTitle = pickBestCandidate(
    dedupeCandidates(lines.map((line) => scoreTitleCandidate(line.text, line, documentHeight))),
    0.42,
    excludedTexts
  ) ?? null;

  const confidence = Number(
    (
      (email ? 0.45 : 0.12) +
      Math.min(top?.score ?? 0.15, 1) * 0.33 +
      (organization ? 0.1 : 0) +
      (jobTitle ? 0.1 : 0)
    ).toFixed(2)
  );

  return {
    fullName,
    organization,
    jobTitle,
    email,
    confidence: Math.max(confidence, ocr.overallConfidence * 0.4),
    warnings
  };
}
