import { writeFile } from "node:fs/promises";
import postgres from "postgres";

if (
  !process.env.LEGACY_DATABASE_URL ||
  !process.env.LEGACY_EXPORT_FILE ||
  process.env.EXPORT_LEGACY_CARDS !== "YES"
)
  throw new Error(
    "Set a dedicated LEGACY_DATABASE_URL, LEGACY_EXPORT_FILE and EXPORT_LEGACY_CARDS=YES after checking the source database",
  );
const sql = postgres(process.env.LEGACY_DATABASE_URL, {
  max: 1,
  prepare: false,
});
try {
  // A fixed legacy schema and a read-only transaction: no schema inference, DDL, or repairs.
  const rows = await sql.begin(
    "read only",
    async (tx) => tx`
    select id,full_name as "fullName",organization,job_title as "jobTitle",email,
      original_image_url as "originalImageUrl",corrected_image_url as "correctedImageUrl",
      raw_ocr_text as "rawOcrText",extraction_confidence as "extractionConfidence",status,
      created_at as "createdAt",updated_at as "updatedAt"
    from public.cards where status='confirmed' order by created_at,id limit 10001`,
  );
  if (rows.length > 10000)
    throw new Error(
      "More than 10,000 legacy cards: use an operator-reviewed paginated export instead",
    );
  await writeFile(
    process.env.LEGACY_EXPORT_FILE,
    JSON.stringify(rows, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    `Exported ${rows.length} records. Review the private JSON before importing. Source data was not modified.`,
  );
} finally {
  await sql.end();
}
