const previewUrls = new WeakMap();
const activeInputs = new Set();

function revoke(input) {
  const urls = previewUrls.get(input) || [];
  for (const url of urls) URL.revokeObjectURL(url);
  previewUrls.delete(input);
  activeInputs.delete(input);
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fileKind(file) {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  if (file.type.startsWith("image/")) return "image";
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  if (["mp4", "webm", "mov", "mkv", "avi"].includes(extension)) return "video";
  if (["mp3", "wav", "m4a", "aac", "flac", "ogg"].includes(extension)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif", "avif"].includes(extension)) return "image";
  return "file";
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function previewNode(file, url) {
  const item = document.createElement("div");
  item.className = "upload-preview-item";
  const kind = fileKind(file);
  let media;
  if (kind === "video") {
    media = document.createElement("video");
    media.muted = true;
    media.controls = true;
    media.playsInline = true;
    media.preload = "metadata";
  } else if (kind === "audio") {
    media = document.createElement("audio");
    media.controls = true;
    media.preload = "metadata";
  } else if (kind === "image") {
    media = document.createElement("img");
    media.alt = `Anteprima di ${file.name}`;
  } else {
    media = document.createElement("div");
    media.className = "upload-preview-file";
    media.textContent = file.name.split(".").pop()?.toUpperCase() || "FILE";
  }
  if ("src" in media) media.src = url;
  const caption = document.createElement("span");
  caption.textContent = [file.name, formatSize(file.size)].filter(Boolean).join(" · ");
  if (kind === "video" || kind === "audio") {
    media.addEventListener("loadedmetadata", () => {
      const dimensions = kind === "video" && media.videoWidth && media.videoHeight
        ? `${media.videoWidth}×${media.videoHeight}`
        : "";
      caption.textContent = [file.name, dimensions, formatDuration(media.duration), formatSize(file.size)]
        .filter(Boolean)
        .join(" · ");
    }, { once: true });
  }
  item.append(media, caption);
  return item;
}

function shouldPreviewInput(input) {
  const accept = input.getAttribute("accept") || "";
  if (input.closest(".dropzone, .guided-upload, .compact-file")) return true;
  return /\bimage\/|\.png|\.jpe?g|\.webp|\bvideo\/|\.mp4|\.webm|\.mov|\.mkv|\.avi|\baudio\/|\.mp3|\.wav|\.m4a/i.test(accept);
}

function previewHost(input) {
  const structured = input.closest(".dropzone, .guided-upload, .compact-file");
  if (structured) return structured;
  const label = input.closest("label");
  if (!label) return null;
  label.classList.add("file-upload-preview-host");
  return label;
}

function ensurePreview(host) {
  let preview = host.querySelector(":scope > .upload-preview");
  if (preview) return preview;
  preview = document.createElement("div");
  preview.className = "upload-preview";
  host.append(preview);
  return preview;
}

function updateInputPreview(input) {
  const host = previewHost(input);
  if (!host) return;
  revoke(input);
  const preview = ensurePreview(host);
  const files = [...(input.files || [])];
  preview.innerHTML = "";
  host.classList.toggle("has-upload-preview", files.length > 0);
  if (!files.length) return;

  const urls = files.slice(0, 6).map((file) => URL.createObjectURL(file));
  previewUrls.set(input, urls);
  activeInputs.add(input);
  for (const [index, file] of files.slice(0, 6).entries()) {
    preview.append(previewNode(file, urls[index]));
  }
  if (files.length > 6) {
    const more = document.createElement("div");
    more.className = "upload-preview-more";
    more.textContent = `+${files.length - 6} file`;
    preview.append(more);
  }
  const clear = document.createElement("button");
  clear.className = "upload-preview-clear";
  clear.type = "button";
  clear.textContent = "Rimuovi";
  clear.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  preview.append(clear);
}

export function setupUploadPreviews(root = document) {
  const inputs = [...root.querySelectorAll('input[type="file"]')].filter(shouldPreviewInput);
  for (const input of inputs) {
    if (input.dataset.uploadPreviewReady === "true") continue;
    input.dataset.uploadPreviewReady = "true";
    input.addEventListener("change", () => updateInputPreview(input));
    if (input.files?.length) updateInputPreview(input);
  }
}

window.addEventListener("pagehide", () => {
  for (const input of [...activeInputs]) revoke(input);
});
