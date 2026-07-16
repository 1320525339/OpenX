import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, join } from "node:path";
import { getDb, getDbIntegrityStatus, resetDb, vacuumDb } from "./db.js";
import {
  getBackupsRoot,
  getConfigPath,
  getDbPath,
  getDotEnvPath,
  getOpenxHome,
  getProvidersPath,
} from "./paths.js";
import { atomicWriteJson } from "./atomic-json.js";

export type BackupManifest = {
  id: string;
  createdAt: string;
  label?: string;
  openxHome: string;
  files: string[];
};

export type PersistenceHealth = {
  openxHome: string;
  dbPath: string;
  dbIntegrityOk: boolean | undefined;
  dbIntegrityMessage: string | undefined;
  configExists: boolean;
  providersExists: boolean;
  dotenvExists: boolean;
  schemaMigrationCount: number;
  backupCount: number;
};

const SKIP_BACKUP_NAMES = new Set(["backups", "pi-sessions"]);

function backupDirFor(id: string): string {
  return join(getBackupsRoot(), id);
}

function listTopLevelEntries(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => !SKIP_BACKUP_NAMES.has(name));
}

/** 创建本地备份（复制 OPENX_HOME，排除 backups/pi-sessions） */
export function createOpenxBackup(opts?: { label?: string }): BackupManifest {
  const dbPath = getDbPath();
  if (dbPath !== ":memory:") {
    try {
      getDb().pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      /* ignore */
    }
  }

  const createdAt = new Date().toISOString();
  const id = `backup-${createdAt.replace(/[:.]/g, "-")}`;
  const dest = backupDirFor(id);
  mkdirSync(dest, { recursive: true });

  const home = getOpenxHome();
  const files: string[] = [];
  for (const name of listTopLevelEntries(home)) {
    const src = join(home, name);
    const target = join(dest, name);
    cpSync(src, target, { recursive: true, force: true });
    files.push(name);
  }

  const manifest: BackupManifest = {
    id,
    createdAt,
    label: opts?.label,
    openxHome: home,
    files,
  };
  atomicWriteJson(join(dest, "backup-manifest.json"), manifest);
  return manifest;
}

export function listOpenxBackups(): BackupManifest[] {
  const root = getBackupsRoot();
  if (!existsSync(root)) return [];
  const out: BackupManifest[] = [];
  for (const name of readdirSync(root)) {
    const manifestPath = join(root, name, "backup-manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
      out.push(parsed);
    } catch {
      out.push({
        id: name,
        createdAt: statSync(join(root, name)).mtime.toISOString(),
        openxHome: getOpenxHome(),
        files: [],
      });
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 从备份恢复（覆盖 OPENX_HOME 内同名条目）。
 * 调用方应在恢复后重启进程；本函数会关闭 DB 连接。
 */
export function restoreOpenxBackup(backupId: string): BackupManifest {
  const safeId = basename(backupId);
  const src = backupDirFor(safeId);
  const manifestPath = join(src, "backup-manifest.json");
  if (!existsSync(src) || !existsSync(manifestPath)) {
    throw new Error(`备份不存在: ${safeId}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  resetDb();

  const home = getOpenxHome();
  mkdirSync(home, { recursive: true });
  for (const name of manifest.files.length > 0 ? manifest.files : listTopLevelEntries(src)) {
    if (name === "backup-manifest.json") continue;
    const from = join(src, name);
    if (!existsSync(from)) continue;
    const to = join(home, name);
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true, force: true });
  }
  return manifest;
}

/**
 * 工厂重置：清空 OPENX_HOME（可选保留 backups）。
 * 会关闭 DB；调用方应重启。
 */
export function factoryResetOpenx(opts?: { keepBackups?: boolean }): {
  openxHome: string;
  removed: string[];
} {
  const keepBackups = opts?.keepBackups !== false;
  resetDb();
  const home = getOpenxHome();
  const removed: string[] = [];
  if (!existsSync(home)) {
    return { openxHome: home, removed };
  }
  for (const name of readdirSync(home)) {
    if (keepBackups && name === "backups") continue;
    rmSync(join(home, name), { recursive: true, force: true });
    removed.push(name);
  }
  return { openxHome: home, removed };
}

/** 导出归档：创建备份并返回路径 */
export function exportOpenxData(opts?: { label?: string }): BackupManifest & {
  path: string;
} {
  const manifest = createOpenxBackup(opts);
  return { ...manifest, path: backupDirFor(manifest.id) };
}

/** 导入：等同 restore */
export function importOpenxData(backupId: string): BackupManifest {
  return restoreOpenxBackup(backupId);
}

export function getPersistenceHealth(): PersistenceHealth {
  const integrity = getDbIntegrityStatus();
  let schemaMigrationCount = 0;
  try {
    const row = getDb()
      .prepare("SELECT COUNT(*) AS c FROM schema_migrations")
      .get() as { c: number };
    schemaMigrationCount = row.c;
  } catch {
    schemaMigrationCount = 0;
  }
  return {
    openxHome: getOpenxHome(),
    dbPath: getDbPath(),
    dbIntegrityOk: integrity.ok,
    dbIntegrityMessage: integrity.message,
    configExists: existsSync(getConfigPath()),
    providersExists: existsSync(getProvidersPath()),
    dotenvExists: existsSync(getDotEnvPath()),
    schemaMigrationCount,
    backupCount: listOpenxBackups().length,
  };
}

export function runDbVacuum(): void {
  vacuumDb();
}

export { writePersistCommitMarker, readPersistCommitMarker } from "./persist-commit.js";
