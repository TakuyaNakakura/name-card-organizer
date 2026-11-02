import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { testUrl } from "./support";
export default async function setup() {
  execFileSync(process.execPath, ["scripts/migrate.mjs"], {
    env: { ...process.env, DATABASE_MIGRATION_URL: testUrl },
    stdio: "pipe",
  });
  const width = 640,
    height = 480,
    frames = [
      Buffer.from(`YUV4MPEG2 W${width} H${height} F5:1 Ip A1:1 C420jpeg\n`),
    ];
  for (let frame = 0; frame < 100; frame++) {
    const y = Buffer.alloc(width * height, 30),
      uv = Buffer.alloc((width * height) / 2, 128);
    if (frame < 50 || frame > 60) {
      for (let row = 130; row < 350; row++)
        y.fill(235, row * width + 130, row * width + 510);
    }
    frames.push(Buffer.from("FRAME\n"), y, uv);
  }
  await writeFile("/tmp/name-card-team-camera.y4m", Buffer.concat(frames));
}
