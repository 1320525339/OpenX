import type { OxspDockTemplate } from "./oxsp.js";

export type IntegrationHealthStatus = "ok" | "degraded" | "disabled" | "starting";

export type IntegrationRouteManifest = {
  method: string;
  path: string;
  summary?: string;
};

export type IntegrationSkillManifest = {
  id: string;
};

export type IntegrationToolsTabManifest = {
  id: string;
  label: string;
  componentKey: string;
};

/** 集成插件声明式清单（供 Web / OXSP / catalog 发现） */
export type IntegrationManifest = {
  id: string;
  version: string;
  displayName: string;
  icon: string;
  capabilities: string[];
  permissions: string[];
  routes?: IntegrationRouteManifest[];
  skills?: IntegrationSkillManifest[];
  oxspTemplates?: OxspDockTemplate[];
  toolsTab?: IntegrationToolsTabManifest;
  settingsSchema?: unknown;
};

export type IntegrationDirectoryEntry = IntegrationManifest & {
  installed: boolean;
  enabled: boolean;
  health: IntegrationHealthStatus;
  healthDetail?: string;
  /** 环境变量锁定启用态时的说明（UI 只读） */
  envLocked?: boolean;
  envLockReason?: string;
  migrationCompleted?: boolean;
};
