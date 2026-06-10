import fs from "node:fs";

const indexPath = "src/routes/index.ts";
let src = fs.readFileSync(indexPath, "utf8");

const startRec = src.indexOf('app.post("/api/goals/recommend-executor"');
const endGoals = src.indexOf("/* Internal executor callbacks");
const goalsBlock = src.slice(startRec, endGoals).replace(/^app\./gm, "goalsRoutes.");

const goalsHeader = `import { Hono } from "hono";
import { nanoid } from "nanoid";
import { refineGoal } from "@openx/coach";
import {
  CreateGoalSchema,
  AddSubGoalsSchema,
  UpdateGoalSchema,
  ReworkSchema,
  BatchGoalsSchema,
  RecommendExecutorInputSchema,
  canTransition,
  type Goal,
} from "@openx/shared";
import {
  listGoals,
  getGoalById,
  insertGoal,
  updateGoal,
  appendLog,
  listLogs,
  buildGoalFeedback,
  listChildGoals,
  areDependenciesMet,
  deleteGoals,
} from "../db.js";
import { loadSettings } from "../settings-store.js";
import { broadcast } from "../sse.js";
import { buildRunStateFromDb } from "../run-service.js";
import { autoDraftNextSubGoals, createSubGoalsUnderParent } from "../sub-goals.js";
import {
  dispatchGoal,
  detectExecutors,
  cancelRunning,
  steerReworkGoal,
  tryDispatchDependents,
} from "../orchestrator.js";
import { narrateGoalChange } from "../narration.js";
import { recommendExecutorForGoal, resolveGoalExecutorId } from "../executor-recommend-service.js";
import { cancelGoalStatus } from "../goal-lifecycle.js";

export const goalsRoutes = new Hono();

`;

fs.writeFileSync("src/routes/goals.ts", goalsHeader + goalsBlock);

let newSrc = src.slice(0, startRec);
const internalEnd = src.indexOf('app.route("/internal", internal);') + 'app.route("/internal", internal);'.length;
newSrc += src.slice(internalEnd);

newSrc = newSrc.replace(
  "export const app = new Hono();",
  `import { goalsRoutes } from "./goals.js";
import { internalRoutes } from "./internal.js";

export const app = new Hono();`,
);

newSrc += `\napp.route("/api/goals", goalsRoutes);\napp.route("/internal", internalRoutes);\n`;

// Clean unused imports from index (goal-lifecycle only used in goals now)
newSrc = newSrc.replace(
  /import \{\n  appendGoalLog,\n  cancelGoalStatus,\n  markGoalComplete,\n  markGoalFailed,\n  updateGoalProgress,\n\} from "\.\/goal-lifecycle\.js";\n/,
  "",
);
newSrc = newSrc.replace(
  /import \{ getOrCreateInternalToken, internalOnly \} from "\.\/internal-auth\.js";\n/,
  'import { getOrCreateInternalToken } from "../internal-auth.js";\n',
);
newSrc = newSrc.replace(/from "\.\//g, 'from "../');

fs.writeFileSync(indexPath, newSrc);
console.log("split complete");
