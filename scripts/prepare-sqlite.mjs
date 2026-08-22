import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";

const databasePath = process.argv[2];
if (!databasePath) throw new Error("Usage: node scripts/prepare-sqlite.mjs <path>");

const absolutePath = resolve(databasePath);
mkdirSync(dirname(absolutePath), { recursive: true });
closeSync(openSync(absolutePath, "a"));
