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
      const angle = (frame < 50 ? -22 : 22) * Math.PI / 180;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (let row = 0; row < height; row++) {
        for (let column = 0; column < width; column++) {
          const x = (column - 320) * cos + (row - 240) * sin;
          const localY = -(column - 320) * sin + (row - 240) * cos;
          if (Math.abs(x) < 190 && Math.abs(localY) < 110)
            y[row * width + column] = Math.abs(x) < 130 && localY > -40 && localY < -34 ? 50 : 235;
        }
      }
    }
    frames.push(Buffer.from("FRAME\n"), y, uv);
  }
  await writeFile("/tmp/name-card-team-camera.y4m", Buffer.concat(frames));
}
