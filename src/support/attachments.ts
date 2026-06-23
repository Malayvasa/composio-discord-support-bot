import type { Attachment, Message } from "discord.js";
import { config } from "../config.js";

export interface SupportAttachment {
  name: string;
  url: string;
  contentType?: string;
  size: number;
  text?: string;
  textStatus: "not_text" | "too_large" | "loaded" | "truncated" | "failed";
}

const textExtensions = new Set([
  ".csv",
  ".json",
  ".log",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
]);

const isTextLike = (attachment: Attachment) => {
  const contentType = attachment.contentType?.toLowerCase() ?? "";

  if (
    contentType.startsWith("text/") ||
    contentType.includes("json") ||
    contentType.includes("yaml") ||
    contentType.includes("csv")
  ) {
    return true;
  }

  const name = attachment.name.toLowerCase();
  return Array.from(textExtensions).some((extension) => name.endsWith(extension));
};

const loadAttachmentText = async (attachment: Attachment) => {
  if (!isTextLike(attachment)) {
    return { textStatus: "not_text" as const };
  }

  if (attachment.size > config.attachmentMaxBytes) {
    return { textStatus: "too_large" as const };
  }

  try {
    const response = await fetch(attachment.url);

    if (!response.ok) {
      return { textStatus: "failed" as const };
    }

    const text = await response.text();
    const truncated = text.length > config.attachmentTextMaxChars;

    return {
      text: truncated ? text.slice(0, config.attachmentTextMaxChars) : text,
      textStatus: truncated ? ("truncated" as const) : ("loaded" as const),
    };
  } catch (error) {
    console.error("[attachments] failed to load Discord attachment text", {
      name: attachment.name,
      size: attachment.size,
      contentType: attachment.contentType,
      error,
    });
    return { textStatus: "failed" as const };
  }
};

export const collectSupportAttachments = async (message: Message) => {
  const attachments = Array.from(message.attachments.values()).slice(
    0,
    config.attachmentMaxFiles
  );

  return Promise.all(
    attachments.map(async (attachment) => {
      const loaded = await loadAttachmentText(attachment);

      return {
        name: attachment.name,
        url: attachment.url,
        contentType: attachment.contentType ?? undefined,
        size: attachment.size,
        ...loaded,
      } satisfies SupportAttachment;
    })
  );
};

export const formatAttachmentMetadata = (attachments: SupportAttachment[]) => {
  if (attachments.length === 0) {
    return "No attachments provided.";
  }

  return attachments
    .map((attachment, index) => {
      const details = [
        `${index + 1}. ${attachment.name}`,
        `type: ${attachment.contentType ?? "unknown"}`,
        `size: ${attachment.size} bytes`,
        `text: ${attachment.textStatus}`,
        `url: ${attachment.url}`,
      ];

      return details.join("\n");
    })
    .join("\n\n");
};

export const formatAttachmentsForAgent = (
  attachments: SupportAttachment[]
) => {
  if (attachments.length === 0) {
    return "No attachments provided.";
  }

  return attachments
    .map((attachment, index) => {
      const header = [
        `Attachment ${index + 1}: ${attachment.name}`,
        `URL: ${attachment.url}`,
        `Content type: ${attachment.contentType ?? "unknown"}`,
        `Size: ${attachment.size} bytes`,
        `Text extraction: ${attachment.textStatus}`,
      ].join("\n");

      if (!attachment.text) {
        return header;
      }

      return `${header}\nExtracted text:\n${attachment.text}`;
    })
    .join("\n\n---\n\n");
};
