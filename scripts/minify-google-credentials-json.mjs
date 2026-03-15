import { readFile } from "node:fs/promises";

const filePath = process.argv[2];

if (!filePath) {
  console.error("Usage: npm run google-creds:minify -- ./path/to/service-account.json");
  process.exit(1);
}

const contents = await readFile(filePath, "utf8");
const parsed = JSON.parse(contents);
console.log(JSON.stringify(parsed));
