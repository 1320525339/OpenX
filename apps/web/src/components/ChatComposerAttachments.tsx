import type { ComposerImageAttachment } from "../lib/chat-composer-attachments";

type Props = {
  attachments: ComposerImageAttachment[];
  onRemove: (id: string) => void;
};

export function ChatComposerAttachments({ attachments, onRemove }: Props) {
  if (attachments.length === 0) return null;

  return (
    <div className="chat-composer-attachments" aria-label="已粘贴的图片">
      {attachments.map((item) => (
        <div key={item.id} className="chat-composer-attachment">
          <img
            className="chat-composer-attachment-thumb"
            src={item.previewUrl}
            alt={item.name}
            title={item.name}
          />
          <button
            type="button"
            className="chat-composer-attachment-remove"
            aria-label={`移除图片 ${item.name}`}
            onClick={() => onRemove(item.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

type BubbleProps = {
  imageUrls: string[];
};

export function ChatBubbleImageStrip({ imageUrls }: BubbleProps) {
  if (imageUrls.length === 0) return null;

  return (
    <div className="chat-bubble-images" aria-label="消息图片">
      {imageUrls.map((url, index) => (
        <a
          key={`${url.slice(0, 32)}-${index}`}
          className="chat-bubble-image-link"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          <img className="chat-bubble-image-thumb" src={url} alt={`图片 ${index + 1}`} />
        </a>
      ))}
    </div>
  );
}
