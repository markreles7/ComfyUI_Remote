const QWEN_NODES = ["TextEncodeQwenImageEditPlus", "ModelPatchLoader"];
const MASK_NODES = ["LayerMask: SegmentAnythingUltra V2", "SAM2Segment", "SAM3Segment"];
const GROUNDING_NODES = ["GroundingDinoSAMSegment", "LayerMask: SegmentAnythingUltra V2", "Florence2Run"];
const DEPTH_NODES = ["DepthAnythingV2Preprocessor", "DepthAnythingPreprocessor"];

function availableAny(nodes, candidates) {
  return candidates.find((name) => nodes.has(name)) || null;
}

function runtimeCapabilities(availableNodes = []) {
  const nodes = new Set(availableNodes);
  return {
    segmentationNode: availableAny(nodes, MASK_NODES),
    groundingNode: availableAny(nodes, GROUNDING_NODES),
    depthNode: availableAny(nodes, DEPTH_NODES),
    compositing: nodes.has("ImageCompositeMasked"),
    localCrop: nodes.has("ImageCropByMaskAndResize") && nodes.has("ImageUncropByMask"),
    qwenStructure: QWEN_NODES.every((name) => nodes.has(name)),
  };
}

export function strategyForSubjectInsertion(request, availableNodes = []) {
  const runtime = runtimeCapabilities(availableNodes);
  const klein = /klein|flux/.test(request.model.family);
  const base = {
    id: klein ? "flux2-klein-subject-insertion" : "qwen-2511-subject-insertion",
    family: klein ? "flux2-klein" : "qwen-image-edit-2511",
    parameterPolicy: "preserve-native",
    nativeParameters: ["steps", "guidance", "denoise", "referenceStrength"],
    supports: {
      sourceImage: true,
      multiReference: true,
      nativeMaskConditioning: false,
      externalMaskCompositing: runtime.compositing,
      localCrop: runtime.localCrop,
      structureGuide: !klein && runtime.qwenStructure,
      depthControl: !klein && runtime.qwenStructure && Boolean(runtime.depthNode),
    },
    runtime,
    fallbacks: [],
  };
  if (klein) {
    base.fallbacks.push("Klein non dichiara un ControlNet depth verificato: la profondità resta un vincolo testuale e di compositing.");
  }
  if (!runtime.compositing || !runtime.localCrop) {
    base.fallbacks.push("Compositing locale completo non disponibile nel runtime: il workflow userà soltanto le capacità realmente collegate.");
  }
  return base;
}

export { runtimeCapabilities };
