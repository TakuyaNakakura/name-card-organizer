import type { ContactExtractionResult, OcrBlock, OcrResult } from "@/lib/types";

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EMAIL_TEST_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const URL_PATTERN = /(https?:\/\/|www\.)/i;
const COMPANY_PATTERN =
  /(inc\.?|corp\.?|co\.?,?|llc|ltd\.?|gmbh|group|company|株式会社|有限会社|合同会社)/i;
const TITLE_PATTERN =
  /(engineer|manager|director|officer|president|sales|marketing|部長|課長|営業|取締役|代表|主任)/i;
const ORG_UNIT_PATTERN =
  /(division|department|studio|office|team|group|本部|事業部|開発部|営業部|部署)/i;
const PHONE_PATTERN = /(\+?\d[\d()\-\s]{7,}\d)/;
const JAPANESE_NAME_PATTERN =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,8}(?:\s*[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,8}){1,2}$/u;
const LATIN_NAME_PATTERN =
  /^[A-Za-z][A-Za-z.'-]{0,30}(?:\s+[A-Za-z][A-Za-z.'-]{0,30}){1,3}$/;

interface NameCandidate {
  text: string;
  score: number;
}

function getDocumentHeight(blocks: OcrBlock[]) {
  return blocks.reduce(
    (max, block) => Math.max(max, block.bounds.y + block.bounds.height),
    0
  );
}

function looksLikeName(text: string) {
  return JAPANESE_NAME_PATTERN.test(text) || LATIN_NAME_PATTERN.test(text);
}

function scoreCandidate(
  text: string,
  block: OcrBlock,
  documentHeight: number
): NameCandidate {
  const compact = text.trim().replace(/\s+/g, " ");
  const centerY = block.bounds.y + block.bounds.height / 2;
  const sizeScore = Math.min(block.bounds.height / 48, 1) * 0.35;
  const verticalScore =
    documentHeight > 0 ? Math.max(0, 1 - centerY / documentHeight) * 0.25 : 0;
  const confidenceScore = Math.min(block.confidence, 1) * 0.25;
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

function extractEmail(rawText: string) {
  const matches = Array.from(
    new Set((rawText.match(EMAIL_REGEX) ?? []).map((value) => value.trim()))
  );

  return {
    primary: matches[0] ?? null,
    all: matches
  };
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

  const documentHeight = getDocumentHeight(ocr.blocks);
  const candidates = ocr.blocks
    .flatMap((block) =>
      block.text
        .split(/\n+/)
        .map((line) => scoreCandidate(line, block, documentHeight))
    )
    .filter((candidate) => candidate.text.length > 0)
    .sort((left, right) => right.score - left.score);

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

  const confidence = Number(
    (
      (email ? 0.55 : 0.15) +
      Math.min(top?.score ?? 0.15, 1) * 0.45
    ).toFixed(2)
  );

  return {
    fullName,
    email,
    confidence: Math.max(confidence, ocr.overallConfidence * 0.4),
    warnings
  };
}
