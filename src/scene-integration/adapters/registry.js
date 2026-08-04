import { FluxKleinAdapter } from "./flux-klein-adapter.js";
import { GenericComfyUIAdapter } from "./generic-comfy-adapter.js";
import { LTXVideoAdapter } from "./ltx-video-adapter.js";
import { QwenImageEditAdapter } from "./qwen-image-edit-adapter.js";
import { SulphurVideoAdapter } from "./sulphur-video-adapter.js";

export function adapterForGeneration(metadata = {}, options = {}) {
  const family = String(metadata.imageModelFamily || "").toLowerCase();
  const modelDescriptor = [
    metadata.imageModelId,
    metadata.imageModelName,
    metadata.imageModelFile,
    family,
  ].filter(Boolean).join(" ").toLowerCase();
  const workflowId = String(metadata.workflowId || "");
  if (
    workflowId === "ltxSulphur"
    || metadata.videoModelId === "ltx23-sulphur"
    || /sulphur/i.test([
      metadata.workflowName,
      metadata.videoModelName,
      metadata.model,
      metadata.videoModelFile,
    ].filter(Boolean).join(" "))
  ) {
    return new SulphurVideoAdapter(options);
  }
  if (family === "qwenedit" || /(qwen.*edit|biglovegwen|biglovegwen|gwen2)/i.test(modelDescriptor)) {
    return new QwenImageEditAdapter(options);
  }
  if (family === "flux2" || /(klein|flux2)/i.test(modelDescriptor)) {
    return new FluxKleinAdapter(options);
  }
  if (
    metadata.mediaType === "video"
    || metadata.generationType === "video"
    || /^studio:firstLast/.test(workflowId)
    || /ltx/i.test(metadata.workflowName || "")
  ) {
    return new LTXVideoAdapter(options);
  }
  return new GenericComfyUIAdapter(options);
}
