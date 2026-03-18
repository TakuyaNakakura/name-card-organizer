import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";

import { getOptionalEnv, getRequiredEnv, getStorageDriver } from "@/lib/env";

export interface PutObjectInput {
  key: string;
  body: Buffer;
  contentType: string;
}

export interface StoredObject {
  body: Uint8Array;
  contentType: string;
}

export interface ObjectStorage {
  putObject(input: PutObjectInput): Promise<void>;
  getObject(key: string): Promise<StoredObject>;
  deleteObject(key: string): Promise<void>;
}

class LocalStorageDriver implements ObjectStorage {
  private rootDir = this.resolveRootDir();

  async putObject(input: PutObjectInput) {
    const targetPath = this.resolvePath(input.key);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, input.body);
  }

  async getObject(key: string): Promise<StoredObject> {
    const filePath = this.resolvePath(key);
    const body = await readFile(filePath);
    return {
      body,
      contentType: guessContentType(filePath)
    };
  }

  async deleteObject(key: string) {
    const filePath = this.resolvePath(key);

    try {
      await unlink(filePath);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
  }

  private resolveRootDir() {
    const configured = getOptionalEnv("LOCAL_UPLOAD_DIR", "var/uploads");
    return path.isAbsolute(configured)
      ? configured
      : path.join(process.cwd(), configured);
  }

  private resolvePath(key: string) {
    const safeKey = key.replace(/\.\./g, "");
    return path.join(this.rootDir, safeKey);
  }
}

class S3StorageDriver implements ObjectStorage {
  private client = new S3Client({
    endpoint: getOptionalEnv("S3_ENDPOINT") || undefined,
    region: getOptionalEnv("S3_REGION", "auto"),
    forcePathStyle: Boolean(getOptionalEnv("S3_ENDPOINT")),
    credentials: {
      accessKeyId: getRequiredEnv("S3_ACCESS_KEY_ID"),
      secretAccessKey: getRequiredEnv("S3_SECRET_ACCESS_KEY")
    }
  });

  private bucket = getRequiredEnv("S3_BUCKET");

  async putObject(input: PutObjectInput) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType
      })
    );
  }

  async getObject(key: string): Promise<StoredObject> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
    );

    const body = await response.Body?.transformToByteArray();
    if (!body) {
      throw new Error("Stored object is empty");
    }

    return {
      body,
      contentType: response.ContentType ?? "application/octet-stream"
    };
  }

  async deleteObject(key: string) {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key
      })
    );
  }
}

let storageInstance: ObjectStorage | null = null;

function guessContentType(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    default:
      return "image/jpeg";
  }
}

export function getStorage(): ObjectStorage {
  if (!storageInstance) {
    storageInstance =
      getStorageDriver() === "s3"
        ? new S3StorageDriver()
        : new LocalStorageDriver();
  }

  return storageInstance;
}

export function buildAssetUrl(key: string) {
  return `/api/assets/${key}`;
}

export function extractStorageKeyFromAssetUrl(assetUrl: string | null | undefined) {
  if (!assetUrl) {
    return null;
  }

  const prefix = "/api/assets/";

  if (assetUrl.startsWith(prefix)) {
    return decodeURIComponent(assetUrl.slice(prefix.length));
  }

  try {
    const parsed = new URL(assetUrl);
    if (parsed.pathname.startsWith(prefix)) {
      return decodeURIComponent(parsed.pathname.slice(prefix.length));
    }
  } catch {
    return null;
  }

  return null;
}
