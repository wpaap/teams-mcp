import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { extname, isAbsolute } from "node:path";
import type { ChatMessageAttachment } from "@microsoft/microsoft-graph-types";
import type { GraphService } from "../services/graph.js";
import type { AttachmentSummary } from "../types/graph.js";

export interface ImageAttachment {
  id: string;
  contentType: string;
  contentUrl?: string;
  name?: string;
  thumbnailUrl?: string;
}

export interface HostedContent {
  "@microsoft.graph.temporaryId": string;
  contentBytes: string;
  contentType: string;
}

/**
 * Upload image as hosted content for Teams messages
 * This creates a temporary hosted content that can be referenced in message attachments
 */
export async function uploadImageAsHostedContent(
  graphService: GraphService,
  teamId: string,
  channelId: string,
  imageData: Buffer | string,
  contentType: string,
  fileName?: string
): Promise<{ hostedContentId: string; attachment: ImageAttachment } | null> {
  try {
    const client = await graphService.getClient();

    // Convert Buffer to base64 if needed
    const contentBytes = typeof imageData === "string" ? imageData : imageData.toString("base64");

    // Create hosted content
    const hostedContent: HostedContent = {
      "@microsoft.graph.temporaryId": `temp_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      contentBytes,
      contentType,
    };

    // Upload hosted content
    const response = await client
      .api(`/teams/${teamId}/channels/${channelId}/messages/hostedContents`)
      .post(hostedContent);

    const hostedContentId = response.id;

    // Create attachment reference
    const attachment: ImageAttachment = {
      id: hostedContentId,
      contentType,
      contentUrl: `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${channelId}/messages/hostedContents/${hostedContentId}/$value`,
      name: fileName || `image.${getFileExtensionFromMimeType(contentType)}`,
    };

    return { hostedContentId, attachment };
  } catch (error) {
    console.error("Error uploading image as hosted content:", error);
    return null;
  }
}

/**
 * Validate image content type
 */
export function isValidImageType(contentType: string): boolean {
  const validTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/bmp",
    "image/svg+xml",
  ];

  return validTypes.includes(contentType.toLowerCase());
}

/**
 * Get file extension from MIME type
 */
export function getFileExtensionFromMimeType(mimeType: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
    "image/svg+xml": "svg",
  };

  return extensions[mimeType.toLowerCase()] || "img";
}

/** Attachment content type that turns a channel message into a Teams announcement */
export const ANNOUNCEMENT_BANNER_CONTENT_TYPE =
  "application/vnd.microsoft.teams.messaging-announcementBanner";

/** Extension → MIME type for the banner images an announcement accepts */
const ANNOUNCEMENT_IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

export interface AnnouncementBannerAttachment {
  id: string;
  contentType: string;
  contentUrl: null;
  content: string;
  name: null;
  thumbnailUrl: null;
}

export interface AnnouncementBanner {
  /** `<attachment>` tag that has to open the message body */
  bodyTag: string;
  attachment: AnnouncementBannerAttachment;
  hostedContents: HostedContent[];
}

/**
 * Get the MIME type of an announcement banner image from its file extension.
 * Returns null for anything other than PNG or JPEG.
 */
export function getAnnouncementImageContentType(filePath: string): string | null {
  const contentType = ANNOUNCEMENT_IMAGE_TYPES[extname(filePath).toLowerCase()];
  return contentType && isValidImageType(contentType) ? contentType : null;
}

/**
 * Read a local PNG or JPEG to use as an announcement banner.
 * Throws an Error with a user-facing message when the path is not absolute, the extension is
 * not PNG/JPEG, or the file cannot be read or is empty.
 */
export async function readAnnouncementImage(
  filePath: string
): Promise<{ data: string; contentType: string }> {
  if (!isAbsolute(filePath)) {
    throw new Error(`Announcement image path must be absolute: ${filePath}`);
  }

  const contentType = getAnnouncementImageContentType(filePath);
  if (!contentType) {
    throw new Error(`Unsupported announcement image type: ${filePath} (use .png, .jpg or .jpeg)`);
  }

  let buffer: Buffer;
  try {
    buffer = await fs.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Announcement image not found: ${filePath}`);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read announcement image ${filePath}: ${reason}`);
  }

  if (buffer.length === 0) {
    throw new Error(`Announcement image is empty: ${filePath}`);
  }

  return { data: buffer.toString("base64"), contentType };
}

/**
 * Build what turns a channel message into a Teams announcement, following Graph's documented
 * "send a message that contains an announcement" shape: an announcementBanner attachment whose
 * card points at two inline hosted contents — the cropped banner (temporary id 1) and the
 * original image (temporary id 2). Both carry the same image, as in announcements posted from
 * the Teams client when the banner needs no cropping.
 */
export function buildAnnouncementBanner(
  imageBase64: string,
  imageContentType: string,
  title = ""
): AnnouncementBanner {
  const id = randomBytes(16).toString("hex");
  const card = {
    title,
    cardImageType: "uploadedImage",
    cardImageDetails: {
      uploadedImageDetail: {
        originalImage: { source: "../hostedContents/2/$value", imageContentType },
        croppedImage: { source: "../hostedContents/1/$value" },
      },
    },
  };

  return {
    bodyTag: `<attachment id="${id}"></attachment>`,
    attachment: {
      id,
      contentType: ANNOUNCEMENT_BANNER_CONTENT_TYPE,
      contentUrl: null,
      content: JSON.stringify(card),
      name: null,
      thumbnailUrl: null,
    },
    hostedContents: ["1", "2"].map((temporaryId) => ({
      "@microsoft.graph.temporaryId": temporaryId,
      contentBytes: imageBase64,
      contentType: imageContentType,
    })),
  };
}

/**
 * Convert image URL to base64 for upload
 */
export async function imageUrlToBase64(
  imageUrl: string
): Promise<{ data: string; contentType: string } | null> {
  try {
    const response = await fetch(imageUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";

    if (!isValidImageType(contentType)) {
      throw new Error(`Unsupported image type: ${contentType}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");

    return {
      data: base64Data,
      contentType,
    };
  } catch (error) {
    console.error("Error converting image URL to base64:", error);
    return null;
  }
}

/**
 * Extracts a minimal attachment summary from Graph API ChatMessageAttachment array.
 * Returns undefined if there are no meaningful attachments to report.
 */
export function extractAttachmentSummaries(
  attachments: ChatMessageAttachment[] | null | undefined
): AttachmentSummary[] | undefined {
  if (!attachments || attachments.length === 0) {
    return undefined;
  }

  const summaries: AttachmentSummary[] = [];
  for (const att of attachments) {
    if (!att.id && !att.name && !att.contentUrl) continue;

    summaries.push({
      id: att.id ?? undefined,
      name: att.name ?? undefined,
      contentType: att.contentType ?? undefined,
      contentUrl: att.contentUrl ?? undefined,
      thumbnailUrl: att.thumbnailUrl ?? undefined,
    });
  }

  return summaries.length > 0 ? summaries : undefined;
}
