export type CardStatus = "confirmed";

export interface CardRecord {
  id: string;
  fullName: string | null;
  email: string;
  originalImageUrl: string;
  correctedImageUrl: string;
  rawOcrText: string;
  extractionConfidence: number;
  status: CardStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CardDraft {
  draftToken: string;
  tempImageUrl: string;
  originalImageUrl: string;
  correctedImageUrl: string;
  fullName: string | null;
  email: string | null;
  confidence: number;
  warnings: string[];
  rawOcrText: string;
}

export interface CardDraftTokenPayload {
  originalImageUrl: string;
  correctedImageUrl: string;
  rawOcrText: string;
  confidence: number;
  suggestedFullName: string | null;
  suggestedEmail: string | null;
}

export interface OcrBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrBlock {
  text: string;
  confidence: number;
  bounds: OcrBounds;
}

export interface OcrResult {
  rawText: string;
  blocks: OcrBlock[];
  overallConfidence: number;
}

export interface ContactExtractionResult {
  fullName: string | null;
  email: string | null;
  confidence: number;
  warnings: string[];
}
