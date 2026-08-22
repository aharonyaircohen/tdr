// Legacy upgrade backfill for issue #21. Runs *before* `prisma db push` so
// `db push` can tighten the `Message.learnerId` column to match the schema
// without having to invent a default for existing rows.
//
// Behavior:
//  - If the `Message` table does not exist, nothing to do — `db push` will
//    create it with the right shape.
//  - If `learnerId` is missing, add it as NOT NULL with a one-shot default
//    so every legacy row is owned by `demo-learner`. `db push` will then
//    drop the default to match the schema (NOT NULL, no default), so
//    future silent writes can't happen.
//  - If `learnerId` already exists (fresh or already-upgraded DB), backfill
//    any NULL rows just in case, and leave the column alone.
//
// Idempotent: each step probes the schema first.

import { PrismaClient } from "@prisma/client";

const legacyLearner = "demo-learner";

const prisma = new PrismaClient();

try {
  const tables = await prisma.$queryRawUnsafe(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'Message'",
  );
  if (tables.length === 0) {
    console.log(
      `[backfill] no Message table in ${process.env.DATABASE_URL}; nothing to backfill.`,
    );
    process.exit(0);
  }

  const columns = await prisma.$queryRawUnsafe(
    "PRAGMA table_info(Message)",
  );
  const learnerCol = columns.find((c) => c.name === "learnerId");

  if (!learnerCol) {
    console.log(
      `[backfill] adding Message.learnerId NOT NULL DEFAULT '${legacyLearner}' (legacy upgrade)`,
    );
    await prisma.$executeRawUnsafe(
      `ALTER TABLE Message ADD COLUMN learnerId TEXT NOT NULL DEFAULT '${legacyLearner}'`,
    );
  } else {
    const nulls = await prisma.$queryRawUnsafe(
      "SELECT COUNT(*) as n FROM Message WHERE learnerId IS NULL OR learnerId = ''",
    );
    if (nulls[0].n > 0) {
      console.log(
        `[backfill] backfilling ${nulls[0].n} NULL/empty learnerId rows to '${legacyLearner}'`,
      );
      await prisma.$executeRawUnsafe(
        `UPDATE Message SET learnerId = '${legacyLearner}' WHERE learnerId IS NULL OR learnerId = ''`,
      );
    } else {
      console.log(
        `[backfill] Message.learnerId already present and populated; no-op.`,
      );
    }
  }
} finally {
  await prisma.$disconnect();
}
