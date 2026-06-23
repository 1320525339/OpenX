import { describe, expect, it } from "vitest";
import {
  appendComposerImageFiles,
  extractImageFilesFromClipboard,
  isComposerImageFile,
  MAX_COMPOSER_IMAGE_ATTACHMENTS,
  readImageFileAsAttachment,
  removeComposerAttachment,
} from "./chat-composer-attachments";

describe("chat-composer-attachments", () => {
  it("detects image files", () => {
    expect(isComposerImageFile(new File(["x"], "a.png", { type: "image/png" }))).toBe(true);
    expect(isComposerImageFile(new File(["x"], "a.txt", { type: "text/plain" }))).toBe(false);
  });

  it("reads image file as data url attachment", async () => {
    const file = new File(["hello"], "shot.png", { type: "image/png" });
    const attachment = await readImageFileAsAttachment(file);
    expect(attachment.name).toBe("shot.png");
    expect(attachment.previewUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("extracts image files from clipboard items", () => {
    const image = new File(["x"], "paste.png", { type: "image/png" });
    const textItem = {
      kind: "string",
      type: "text/plain",
      getAsFile: () => null,
    };
    const imageItem = {
      kind: "file",
      type: "image/png",
      getAsFile: () => image,
    };
    const clipboard = {
      items: [textItem, imageItem],
      files: [image],
    } as unknown as DataTransfer;
    expect(extractImageFilesFromClipboard(clipboard)).toHaveLength(1);
  });

  it("caps attachment count", async () => {
    const current = Array.from({ length: MAX_COMPOSER_IMAGE_ATTACHMENTS }, (_, i) => ({
      id: `img-${i}`,
      previewUrl: `data:image/png;base64,${i}`,
      mimeType: "image/png",
      name: `img-${i}.png`,
      size: 10,
    }));
    const next = new File(["x"], "extra.png", { type: "image/png" });
    const result = await appendComposerImageFiles(current, [next]);
    expect(result.attachments).toHaveLength(MAX_COMPOSER_IMAGE_ATTACHMENTS);
    expect(result.error).toMatch(/最多添加/);
  });

  it("removes attachment by id", () => {
    const attachments = [
      {
        id: "a",
        previewUrl: "data:image/png;base64,1",
        mimeType: "image/png",
        name: "a.png",
        size: 1,
      },
      {
        id: "b",
        previewUrl: "data:image/png;base64,2",
        mimeType: "image/png",
        name: "b.png",
        size: 2,
      },
    ];
    expect(removeComposerAttachment(attachments, "a")).toEqual([attachments[1]]);
  });
});
