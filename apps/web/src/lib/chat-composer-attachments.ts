export type ComposerImageAttachment = {
  id: string;
  previewUrl: string;
  mimeType: string;
  name: string;
  size: number;
};

export const MAX_COMPOSER_IMAGE_ATTACHMENTS = 8;
export const MAX_COMPOSER_IMAGE_BYTES = 5 * 1024 * 1024;

function newAttachmentId(): string {
  return `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function isComposerImageFile(file: File): boolean {
  return file.type.startsWith("image/");
}

export function readImageFileAsAttachment(file: File): Promise<ComposerImageAttachment> {
  return new Promise((resolve, reject) => {
    if (!isComposerImageFile(file)) {
      reject(new Error("仅支持图片文件"));
      return;
    }
    if (file.size > MAX_COMPOSER_IMAGE_BYTES) {
      reject(new Error(`图片过大（上限 ${Math.round(MAX_COMPOSER_IMAGE_BYTES / 1024 / 1024)}MB）`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const previewUrl = typeof reader.result === "string" ? reader.result : "";
      if (!previewUrl) {
        reject(new Error("读取图片失败"));
        return;
      }
      resolve({
        id: newAttachmentId(),
        previewUrl,
        mimeType: file.type || "image/png",
        name: file.name || "粘贴的图片",
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

export function extractImageFilesFromClipboard(
  clipboardData: DataTransfer | null,
): File[] {
  if (!clipboardData) return [];
  const files: File[] = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && isComposerImageFile(file)) {
      files.push(file);
    }
  }
  return files;
}

export function extractImageFilesFromDataTransfer(
  dataTransfer: DataTransfer | null,
): File[] {
  if (!dataTransfer) return [];
  const files: File[] = [];
  for (const file of Array.from(dataTransfer.files)) {
    if (isComposerImageFile(file)) {
      files.push(file);
    }
  }
  return files;
}

export async function appendComposerImageFiles(
  current: ComposerImageAttachment[],
  files: File[],
): Promise<{ attachments: ComposerImageAttachment[]; error?: string }> {
  if (files.length === 0) {
    return { attachments: current };
  }
  const remaining = MAX_COMPOSER_IMAGE_ATTACHMENTS - current.length;
  if (remaining <= 0) {
    return { attachments: current, error: `最多添加 ${MAX_COMPOSER_IMAGE_ATTACHMENTS} 张图片` };
  }
  const nextFiles = files.slice(0, remaining);
  const added: ComposerImageAttachment[] = [];
  for (const file of nextFiles) {
    try {
      added.push(await readImageFileAsAttachment(file));
    } catch (e) {
      const message = e instanceof Error ? e.message : "添加图片失败";
      return {
        attachments: [...current, ...added],
        error: message,
      };
    }
  }
  let error: string | undefined;
  if (files.length > nextFiles.length) {
    error = `最多添加 ${MAX_COMPOSER_IMAGE_ATTACHMENTS} 张图片`;
  }
  return { attachments: [...current, ...added], error };
}

export function removeComposerAttachment(
  attachments: ComposerImageAttachment[],
  id: string,
): ComposerImageAttachment[] {
  return attachments.filter((item) => item.id !== id);
}

export function revokeComposerAttachments(attachments: ComposerImageAttachment[]): void {
  for (const item of attachments) {
    if (item.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(item.previewUrl);
    }
  }
}
