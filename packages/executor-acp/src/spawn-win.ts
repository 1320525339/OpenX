import type { SpawnOptions } from "node:child_process";

function acpEnv(extra?: SpawnOptions["env"]): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  if (env.TERM === "dumb" || !env.TERM) {
    env.TERM = "xterm-256color";
  }
  return env;
}

/** Windows 上 .cmd shim 需要 shell，否则 spawn 报 ENOENT；Mock Agent 用 node 直启需关闭 shell */
export function acpSpawnOptions(extra?: SpawnOptions & { forceShell?: boolean }): SpawnOptions {
  const forceShell = extra?.forceShell;
  const useShell =
    forceShell === true
      ? true
      : forceShell === false
        ? false
        : process.platform === "win32";
  const { forceShell: _drop, ...rest } = extra ?? {};
  return {
    ...rest,
    shell: useShell,
    env: acpEnv(rest.env as NodeJS.ProcessEnv | undefined),
  };
}
