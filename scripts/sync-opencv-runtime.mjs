import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtimeSourcePath = require.resolve("@techstark/opencv-js/dist/opencv.js");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const targetDir = path.join(projectRoot, "public", "vendor");
const targetPath = path.join(targetDir, "opencv.js");

await mkdir(targetDir, { recursive: true });
await copyFile(runtimeSourcePath, targetPath);

console.log(`Synced OpenCV runtime to ${targetPath}`);
