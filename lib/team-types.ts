export interface TeamSession {
  userId: string;
  teamId: string;
  name: string;
  email: string;
  teamName: string;
  role: "admin" | "member";
  username?: string | null;
  passwordChangeRequired?: boolean;
}

export interface ContactFields {
  fullName: string;
  organization: string;
  jobTitle: string;
  email: string;
}

export interface TeamDraft extends ContactFields {
  id: string;
  clientScanId: string;
  status: "processing" | "ready" | "failed" | "confirmed" | "discarded";
  version: number;
  originalImageUrl: string;
  correctedImageUrl: string;
  rawOcrText: string;
  confidence: number;
  warnings: string[];
  errorMessage: string | null;
  createdAt: string;
  expiresAt: string;
  cardId: string | null;
}

export interface TeamCard extends ContactFields {
  id: string;
  createdBy: string | null;
  createdByName: string;
  originalImageUrl: string;
  correctedImageUrl: string;
  rawOcrText: string;
  extractionConfidence: number;
  status: "confirmed";
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  canEdit: boolean;
}
