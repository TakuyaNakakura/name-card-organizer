// Apply only to OCR suggestions, never to a user's edits or the diagnostic raw text.
export function normalizeOcrLine(text: string) {
  return text
    .replace(/[\u200b\u2060\ufeff]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(
      /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆]) +(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆])/gu,
      "",
    );
}
