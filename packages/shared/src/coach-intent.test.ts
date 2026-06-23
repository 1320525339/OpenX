import { describe, expect, it } from "vitest";
import {
  classifyCoachIntent,
  isAmbiguousTaskMessage,
  isProductMetaRequest,
  isWorkOrderDismissMessage,
  mayNeedGoalRefined,
  shouldTryLlmClarify,
  shouldUseCoachStreaming,
  shouldUseKnowledgeSaveTool,
} from "./coach-intent.js";

describe("isProductMetaRequest", () => {
  it("detects coach capability / settings feedback", () => {
    expect(isProductMetaRequest("我需要你能改这部分")).toBe(true);
    expect(isProductMetaRequest("你能改显示名吗")).toBe(true);
    expect(isProductMetaRequest("我希望你能自己改工头这个名字")).toBe(true);
  });

  it("does not treat real dev tasks as product meta", () => {
    expect(isProductMetaRequest("帮我实现一个登录接口")).toBe(false);
    expect(isProductMetaRequest("我需要做一个登录页")).toBe(false);
    expect(isProductMetaRequest("帮我改登录页面的样式")).toBe(false);
  });
});

describe("classifyCoachIntent", () => {
  it("treats product meta as consult with streaming", () => {
    expect(classifyCoachIntent("我需要你能改这部分")).toBe("consult");
    expect(shouldUseCoachStreaming("我需要你能改这部分")).toBe(true);
    expect(mayNeedGoalRefined("我需要你能改这部分")).toBe(false);
  });

  it("treats progress queries as progress", () => {
    expect(classifyCoachIntent("最近进展怎么样？")).toBe("progress");
    expect(shouldUseCoachStreaming("最近进展怎么样？")).toBe(true);
  });

  it("treats explicit task requests as task", () => {
    expect(classifyCoachIntent("帮我实现一个登录接口")).toBe("task");
    expect(shouldUseCoachStreaming("帮我实现一个登录接口")).toBe(false);
  });

  it("treats feature descriptions without 帮我 as task", () => {
    expect(classifyCoachIntent("用户登录模块，含注册和 JWT")).toBe("task");
    expect(shouldUseCoachStreaming("用户登录模块，含注册和 JWT")).toBe(false);
  });

  it("treats 怎么做 as task not consult", () => {
    expect(classifyCoachIntent("怎么做用户登录功能")).toBe("task");
  });

  it("treats workspace inspect as task", () => {
    expect(classifyCoachIntent("看一下当前目录有哪些文件")).toBe("task");
  });

  it("defaults to chitchat for greetings", () => {
    expect(classifyCoachIntent("你好")).toBe("chitchat");
    expect(shouldUseCoachStreaming("你好")).toBe(true);
  });

  it("treats design/game/finance discourse as consult with streaming", () => {
    expect(classifyCoachIntent("我们来讨论一下这个游戏的数值平衡")).toBe("consult");
    expect(shouldUseCoachStreaming("我们来讨论一下这个游戏的数值平衡")).toBe(true);
    expect(mayNeedGoalRefined("分析一下这只股票的基本面")).toBe(false);
  });
});

describe("mayNeedGoalRefined", () => {
  it("detects implicit goal descriptions", () => {
    expect(mayNeedGoalRefined("订单导出 Excel 功能")).toBe(true);
    expect(mayNeedGoalRefined("今天天气不错")).toBe(false);
  });
});

describe("shouldTryLlmClarify", () => {
  it("includes explicit task and bug reports", () => {
    expect(shouldTryLlmClarify("帮我实现登录接口")).toBe(true);
    expect(shouldTryLlmClarify("登录按钮点了没反应")).toBe(true);
    expect(shouldTryLlmClarify("帮我优化一下")).toBe(true);
  });

  it("excludes pure chitchat streaming", () => {
    expect(shouldTryLlmClarify("你好")).toBe(false);
    expect(shouldTryLlmClarify("最近进展怎么样？")).toBe(false);
  });
});

describe("isAmbiguousTaskMessage", () => {
  it("detects question-tone task messages", () => {
    expect(isAmbiguousTaskMessage("要不要优化一下登录页？")).toBe(true);
  });

  it("detects short vague help-me commands", () => {
    expect(isAmbiguousTaskMessage("帮我优化一下")).toBe(true);
    expect(isAmbiguousTaskMessage("帮我改进下")).toBe(true);
  });

  it("does not treat explicit task orders as ambiguous", () => {
    expect(isAmbiguousTaskMessage("帮我实现一个登录接口")).toBe(false);
    expect(isAmbiguousTaskMessage("帮我实现 JWT 登录")).toBe(false);
  });
});

describe("isWorkOrderDismissMessage", () => {
  it("detects cancel phrases", () => {
    expect(
      isWorkOrderDismissMessage("我先不创建「深色模式」这个任务单了"),
    ).toBe(true);
    expect(isWorkOrderDismissMessage("帮我做一个登录页")).toBe(false);
  });
});

describe("shouldUseKnowledgeSaveTool", () => {
  it("detects remember phrases", () => {
    expect(shouldUseKnowledgeSaveTool("请记住：后端端口 3921")).toBe(true);
    expect(shouldUseKnowledgeSaveTool("保存到知识库：使用 vitest")).toBe(true);
    expect(shouldUseKnowledgeSaveTool("帮我做一个登录页")).toBe(false);
  });
});
