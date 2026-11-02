import { randomUUID } from "node:crypto";
import { readFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { S3Client, CopyObjectCommand } from "@aws-sdk/client-s3";

// Input is an operator-reviewed JSON export, never a guess at a shared public.cards table.
if (
  !process.env.LEGACY_IMPORT_FILE ||
  !process.env.DATABASE_MIGRATION_URL ||
  !process.env.IMPORT_TEAM_ID ||
  (!process.env.IMPORT_OWNER_EMAIL && !process.env.IMPORT_OWNER_USERNAME)
)
  throw new Error(
    "Set LEGACY_IMPORT_FILE, DATABASE_MIGRATION_URL, IMPORT_TEAM_ID and either IMPORT_OWNER_EMAIL or IMPORT_OWNER_USERNAME",
  );
if (process.env.IMPORT_OWNER_EMAIL && process.env.IMPORT_OWNER_USERNAME)
  throw new Error("Select the import operator by email OR username, not both");
const rows = JSON.parse(await readFile(process.env.LEGACY_IMPORT_FILE, "utf8"));
if (!Array.isArray(rows))
  throw new Error("Expected a reviewed array of legacy CardRecord objects");
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const seen = new Set();
function imageKey(url) {
  if (!url) return null;
  if (
    typeof url !== "string" ||
    !/^\/api\/assets\/drafts\/[0-9a-f-]+\/(original|corrected)\.(jpg|jpeg|png|webp)$/i.test(
      url,
    )
  )
    throw new Error(
      "Unsupported legacy asset path; inspect the export before importing",
    );
  return url.slice("/api/assets/".length);
}
for (const row of rows) {
  if (
    !uuid.test(row.id) ||
    seen.has(row.id) ||
    row.status !== "confirmed" ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    !Number.isFinite(Date.parse(row.updatedAt))
  )
    throw new Error("Invalid ID, duplicate ID, status, or timestamp");
  for (const key of [
    "fullName",
    "organization",
    "jobTitle",
    "email",
    "rawOcrText",
  ])
    if (row[key] != null && typeof row[key] !== "string")
      throw new Error("Unexpected contact field type");
  if (
    !Number.isFinite(row.extractionConfidence) ||
    row.extractionConfidence < 0 ||
    row.extractionConfidence > 1
  )
    throw new Error("Invalid confidence");
  imageKey(row.originalImageUrl);
  imageKey(row.correctedImageUrl);
  seen.add(row.id);
}
const sql = postgres(process.env.DATABASE_MIGRATION_URL, {
  max: 1,
  prepare: false,
});
const s3 =
  process.env.STORAGE_DRIVER === "s3"
    ? new S3Client({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION || "auto",
        forcePathStyle: Boolean(process.env.S3_ENDPOINT),
        credentials: {
          accessKeyId: process.env.S3_ACCESS_KEY_ID || "",
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || "",
        },
      })
    : null;
const bucket = process.env.S3_BUCKET,
  root = path.resolve(process.env.LOCAL_UPLOAD_DIR || "var/uploads");
try {
  const operatorEmail =
    process.env.IMPORT_OWNER_EMAIL?.trim().toLowerCase() || "";
  const operatorUsername =
    process.env.IMPORT_OWNER_USERNAME?.trim().toLowerCase() || "";
  const [owner] =
    await sql`select m.user_id from name_card.memberships m join name_card_auth."user" u on u.id=m.user_id where m.team_id=${process.env.IMPORT_TEAM_ID}
      and ((${operatorEmail}<>'' and lower(u.email)=${operatorEmail}) or (${operatorUsername}<>'' and u.username=${operatorUsername}))
      and m.role='admin' and m.status='active'`;
  if (!owner)
    throw new Error(
      "The explicitly selected owner must be an active team administrator",
    );
  console.log(
    `Validated ${rows.length} records. Legacy database and source images will not be changed.`,
  );
  if (process.env.APPLY_LEGACY_IMPORT !== "YES") {
    console.log(
      "Dry run only. Set APPLY_LEGACY_IMPORT=YES after backup and review.",
    );
    process.exitCode = 0;
  } else {
    let imported = 0;
    for (const row of rows) {
      const [existing] =
        await sql`select id,team_id,imported from name_card.cards where id=${row.id}`;
      if (existing) {
        if (
          existing.team_id !== process.env.IMPORT_TEAM_ID ||
          !existing.imported
        )
          throw new Error(
            "Existing ID belongs to a different source or team. Import stopped without overwriting it.",
          );
        continue;
      }
      const copies = [];
      try {
        for (const [kind, url] of [
          ["original", row.originalImageUrl],
          ["corrected", row.correctedImageUrl],
        ]) {
          const source = imageKey(url);
          if (!source) continue;
          const ext = path.extname(source),
            id = randomUUID(),
            key = `teams/${process.env.IMPORT_TEAM_ID}/imports/${row.id}/${id}${ext}`;
          if (s3) {
            if (!bucket) throw new Error("S3_BUCKET required");
            const result = await s3.send(
              new CopyObjectCommand({
                Bucket: bucket,
                Key: key,
                CopySource: encodeURIComponent(
                  `${bucket}/${source}`,
                ).replaceAll("%2F", "/"),
              }),
            );
            if (!result.CopyObjectResult) throw new Error("Image copy failed");
          } else {
            await mkdir(path.dirname(path.join(root, key)), {
              recursive: true,
            });
            await copyFile(path.join(root, source), path.join(root, key));
          }
          copies.push({
            id,
            key,
            kind,
            type:
              ext === ".png"
                ? "image/png"
                : ext === ".webp"
                  ? "image/webp"
                  : "image/jpeg",
          });
        }
        await sql.begin(async (tx) => {
          await tx`insert into name_card.cards(id,team_id,created_by,updated_by,full_name,organization,job_title,email,raw_ocr_text,extraction_confidence,imported,created_at,updated_at)
            values(${row.id},${process.env.IMPORT_TEAM_ID},null,${owner.user_id},${row.fullName || null},${row.organization || null},${row.jobTitle || null},${row.email || null},${row.rawOcrText || ""},${row.extractionConfidence},true,${row.createdAt},${row.updatedAt})`;
          for (const asset of copies)
            await tx`insert into name_card.assets(id,team_id,card_id,kind,storage_key,content_type,byte_size) values(${asset.id},${process.env.IMPORT_TEAM_ID},${row.id},${asset.kind},${asset.key},${asset.type},0)`;
          await tx`insert into name_card.audit_events(team_id,actor_id,action,target_id) values(${process.env.IMPORT_TEAM_ID},${owner.user_id},'card.import',${row.id})`;
        });
        imported++;
      } catch (error) {
        // Retain copied objects on uncertain commit errors; never risk deleting a committed card's image.
        console.error(
          "Import stopped. Previously imported records remain valid; rerun skips their IDs. Inspect any orphan import images.",
        );
        throw error;
      }
    }
    console.log(
      `Imported ${imported} records. Original IDs/timestamps and original images are preserved.`,
    );
  }
} finally {
  await sql.end();
}
