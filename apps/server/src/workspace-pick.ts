import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkspacePickResult =
  | { ok: true; path: string }
  | { ok: false; reason: "unsupported" | "aborted" | "error"; message?: string };

const WIN_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择 OpenX 工作目录'
$dialog.ShowNewFolderButton = $true
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  Write-Output $dialog.SelectedPath
}
`.trim();

const MAC_SCRIPT =
  'POSIX path of (choose folder with prompt "选择 OpenX 工作目录" default location (path to home folder))';

async function pickOnWindows(): Promise<WorkspacePickResult> {
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-STA", "-NoProfile", "-Command", WIN_SCRIPT],
      { timeout: 120_000, windowsHide: false },
    );
    const picked = stdout.trim();
    if (!picked) return { ok: false, reason: "aborted" };
    return { ok: true, path: picked };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "error", message };
  }
}

async function pickOnMac(): Promise<WorkspacePickResult> {
  try {
    const { stdout } = await execFileAsync("osascript", ["-e", MAC_SCRIPT], {
      timeout: 120_000,
    });
    const picked = stdout.trim();
    if (!picked) return { ok: false, reason: "aborted" };
    return { ok: true, path: picked };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("User canceled") || message.includes("-128")) {
      return { ok: false, reason: "aborted" };
    }
    return { ok: false, reason: "error", message };
  }
}

async function pickOnLinux(): Promise<WorkspacePickResult> {
  for (const [command, args] of [
    ["zenity", ["--file-selection", "--directory", "--title=选择 OpenX 工作目录"]],
    ["kdialog", ["--getexistingdirectory", ".", "--title", "选择 OpenX 工作目录"]],
  ] as const) {
    try {
      const { stdout } = await execFileAsync(command, [...args], { timeout: 120_000 });
      const picked = stdout.trim();
      if (!picked) return { ok: false, reason: "aborted" };
      return { ok: true, path: picked };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("255") || message.includes("cancel")) {
        return { ok: false, reason: "aborted" };
      }
    }
  }
  return { ok: false, reason: "unsupported" };
}

export async function pickWorkspaceFolder(): Promise<WorkspacePickResult> {
  if (process.platform === "win32") return pickOnWindows();
  if (process.platform === "darwin") return pickOnMac();
  if (process.platform === "linux") return pickOnLinux();
  return { ok: false, reason: "unsupported" };
}
