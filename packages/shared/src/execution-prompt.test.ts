import { describe, expect, it } from "vitest";

import type { Goal } from "./goal.js";

import { buildExecutionPrompt } from "./execution-prompt.js";



function minimalGoal(overrides: Partial<Goal> = {}): Goal {

  return {

    id: "g1",

    conversationId: "c1",

    title: "Test",

    executionPrompt: "Do the thing",

    status: "running",

    progress: 0,

    executorId: "pi",

    createdAt: new Date().toISOString(),

    updatedAt: new Date().toISOString(),

    ...overrides,

  } as Goal;

}



describe("buildExecutionPrompt", () => {

  it("includes workspace and acceptance blocks", () => {

    const prompt = buildExecutionPrompt(

      minimalGoal({ acceptance: "Must pass tests" }),

      [],

      undefined,

      { workspaceRoot: "/tmp/ws" },

    );

    expect(prompt).toContain("【工作目录】");

    expect(prompt).toContain("/tmp/ws");

    expect(prompt).toContain("【验收标准】");

    expect(prompt).toContain("Must pass tests");

    expect(prompt).toContain("Do the thing");

  });



  it("applies execution block overrides from llmContext", () => {

    const prompt = buildExecutionPrompt(

      minimalGoal({ acceptance: "x" }),

      [],

      undefined,

      {

        workspaceRoot: "/proj",

        llmContext: {

          executionBlocks: {

            workspace: "WORKDIR={{workspaceRoot}}",

            acceptance: "ACCEPT={{acceptance}}",

          },

        },

      },

    );

    expect(prompt).toContain("WORKDIR=/proj");

    expect(prompt).toContain("ACCEPT=x");

    expect(prompt).not.toContain("【工作目录】");

  });



  it("budgets long rework and review history", () => {

    const long = "x".repeat(20_000);

    const prompt = buildExecutionPrompt(

      minimalGoal({

        effectStatus: "rework",

        reworkReason: long,

        resultSummary: long,

      }),

      Array.from({ length: 20 }, (_, i) => ({

        level: "info",

        message: `log-${i}-${"y".repeat(500)}`,

      })),

      undefined,

      {

        priorReviewRounds: Array.from(

          { length: 8 },

          (_, i) => `round ${i} ${"z".repeat(800)}`,

        ),

        priorSummaries: ["summary-1", "summary-2"],

        isRework: true,

      },

    );

    expect(prompt).toContain("内容已按预算截断");

  });

});


