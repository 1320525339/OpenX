import type { CoachIntent } from "./coach.js";

/** 用户描述里是否像「要落成 Goal」的需求（即使没说「帮我做」） */
export function mayNeedGoalRefined(message: string): boolean {
  const m = message.trim();
  if (!m) return false;

  if (
    /功能|模块|需求|任务|目标|工单|子任务|feature|story|接口|api|页面|组件|表单|按钮|服务|微服务/i.test(
      m,
    )
  ) {
    return true;
  }
  if (/我想|我要|我需要|希望|打算|计划|麻烦|请.+做|给.+做/.test(m)) {
    return true;
  }
  if (
    /bug|修复|fix|缺陷|报错|异常|重构|优化(?!\s*提示词)|登录|注册|权限|数据库|迁移|部署|测试用例/i.test(
      m,
    )
  ) {
    return true;
  }
  if (/整理一下|拆成|拆分为|落成|转成|形成一个|做成/.test(m)) {
    return true;
  }
  return false;
}

/** 轻量意图分类：决定走流式纯文本还是结构化 generateObject */
export function classifyCoachIntent(message: string): CoachIntent {
  const m = message.trim();
  const lower = m.toLowerCase();

  if (
    /看.*(文件|目录|文件夹)|查看.*(文件|目录|文件夹)|列出|列举|目录结构|有哪些文件|有什么文件|当前目录|工作目录|文件夹下|目录下|\bls\b|\bdir\b|list\s+(files|dir)|read\s+(file|dir|folder)|show\s+(files|directory)|workspace/i.test(
      m,
    )
  ) {
    return "task";
  }

  if (/返工|重做|没通过|不满意|再来一次|rework/i.test(m)) {
    return "rework";
  }

  if (/状态|进展|情况|最近|怎么样|完成了吗|进度|汇总/.test(m) && !mayNeedGoalRefined(m)) {
    return "progress";
  }

  if (/怎么(做|实现|开发|搭建|弄)|如何(做|实现|开发|搭建|弄)/.test(m)) {
    return "task";
  }

  if (
    /帮我|做一个|做一|做个|实现|开发|写个|写一|创建|添加|修复|修改|部署|搭建|整理成|派给|派单|我想做|要做|需要做/.test(
      m,
    ) ||
    /^(fix|add|create|implement|build|deploy)\b/.test(lower)
  ) {
    return "task";
  }

  if (mayNeedGoalRefined(m)) {
    return "task";
  }

  if (/验收|标准|约束|边界|为什么|建议|可以吗/.test(m)) {
    return "consult";
  }

  if (/怎么|如何|能不能/.test(m)) {
    return "consult";
  }

  return "chitchat";
}

export function isStreamingCoachIntent(intent: CoachIntent): boolean {
  return intent === "chitchat" || intent === "consult" || intent === "progress";
}

/** 用户明确放弃当前任务单：只对话确认，禁止再出 refined */
export function isWorkOrderDismissMessage(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  return /先不创建|暂不创建|不用创建|不想创建|不创建.*任务单|取消.*任务单|不要.*任务单|先别派|不派这个|先不派|放弃.*任务单/.test(
    m,
  );
}

/** 任务味但语气更像提问/探讨：先回答并轻确认，不直接出任务单 */
export function isAmbiguousTaskMessage(message: string): boolean {
  const m = message.trim();
  if (!m) return false;
  if (
    /派单|派给|创建任务|建个任务|立项|整理成(任务|工单|目标)|帮我(做|实现|写|改|修|加)/.test(
      m,
    )
  ) {
    return false;
  }
  const taskFlavored = classifyCoachIntent(m) === "task" || mayNeedGoalRefined(m);
  if (!taskFlavored) return false;
  return (
    /[？?]\s*$/.test(m) ||
    /(吗|呢|么)\s*[？?。]?\s*$/.test(m) ||
    /^(怎么|如何|为什么|为啥|是否|能不能|可不可以|要不要|该不该|是不是|有没有)/.test(m)
  );
}

/** 是否走 streamText（任务/返工/像要出工单的需求一律走结构化） */
export function shouldUseCoachStreaming(
  message: string,
  intent: CoachIntent = classifyCoachIntent(message),
): boolean {
  if (intent === "task" || intent === "rework") return false;
  if (mayNeedGoalRefined(message)) return false;
  return isStreamingCoachIntent(intent);
}
