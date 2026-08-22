// Vitest setup: load .env.test (or .env) so the test DB is isolated from dev.db.
import fs from "node:fs";
import path from "node:path";

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/i);
    if (!m) continue;
    const [, key, value] = m;
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const cwd = process.cwd();
loadEnv(path.resolve(cwd, ".env.test"));
loadEnv(path.resolve(cwd, ".env"));

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./prisma/test.db";
process.env.CURRENT_LEARNER_ID = process.env.CURRENT_LEARNER_ID ?? "test-learner";
process.env.NODE_ENV = "test";