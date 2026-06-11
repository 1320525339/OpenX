import { describe, expect, it } from "vitest";
import {
  classifyCoachIntent,
  isWorkOrderDismissMessage,
  mayNeedGoalRefined,
  shouldUseCoachStreaming,
} from "./coach-intent.js";

describe("classifyCoachIntent", () => {
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
});

describe("mayNeedGoalRefined", () => {
  it("detects implicit goal descriptions", () => {
    expect(mayNeedGoalRefined("订单导出 Excel 功能")).toBe(true);
    expect(mayNeedGoalRefined("今天天气不错")).toBe(false);
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
