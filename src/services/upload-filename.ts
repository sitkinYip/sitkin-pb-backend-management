const MEDIA_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/x-icon": "ico",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/ogg": "ogv",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv",
  "video/x-msvideo": "avi",
  "video/mpeg": "mpeg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/webm": "webm",
};

/** A fresh ASCII object key per upload; never overwrites an earlier same-name file. */
export function createUploadFilename(file: Pick<File, "name" | "type">): string {
  const suffix = /\.([a-z0-9]{1,10})$/i.exec(file.name)?.[1].toLowerCase();
  // Preserve a valid extension; MIME is only a fallback, not format conversion.
  const fallback = MEDIA_EXTENSIONS[file.type.toLowerCase()];
  const extension = suffix || (typeof fallback === "string" ? fallback : "bin");
  // getRandomValues also works on the project's non-HTTPS development domain.
  const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${id}.${extension}`;
}
