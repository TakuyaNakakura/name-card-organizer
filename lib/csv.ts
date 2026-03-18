import type { CardRecord } from "@/lib/types";

const UTF8_BOM = "\uFEFF";

function escapeCsv(value: string | null) {
  const normalized = value ?? "";
  return `"${normalized.replaceAll('"', '""')}"`;
}

interface CsvOptions {
  excelFriendly?: boolean;
}

export function cardsToCsv(cards: CardRecord[], options: CsvOptions = {}) {
  const header = [
    "id",
    "full_name",
    "organization",
    "job_title",
    "email",
    "corrected_image_url",
    "created_at"
  ];
  const rows = cards.map((card) =>
    [
      escapeCsv(card.id),
      escapeCsv(card.fullName),
      escapeCsv(card.organization),
      escapeCsv(card.jobTitle),
      escapeCsv(card.email),
      escapeCsv(card.correctedImageUrl),
      escapeCsv(card.createdAt)
    ].join(",")
  );

  const newline = options.excelFriendly ? "\r\n" : "\n";
  const content = [header.join(","), ...rows].join(newline);

  return options.excelFriendly ? `${UTF8_BOM}${content}` : content;
}
