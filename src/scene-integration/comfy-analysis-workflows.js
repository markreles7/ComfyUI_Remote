function node(inputs, classType, title) {
  return { inputs, class_type: classType, _meta: { title } };
}

export function buildComfySceneAnalysisWorkflow({
  input,
  mediaType,
  profileId,
  depth = true,
  segmentation = false,
  tracking = false,
  sam3Checkpoint = null,
  analysisScale = 0.6,
}) {
  const workflow = {};
  let image;
  if (mediaType === "video") {
    workflow["1"] = node({ file: input }, "LoadVideo", "Scene Analysis · video");
    workflow["2"] = node({ video: ["1", 0] }, "GetVideoComponents", "Scene Analysis · frame");
    workflow["3"] = node({
      image: ["2", 0],
      batch_index: 0,
      length: 1,
    }, "ImageFromBatch", "Scene Analysis · primo frame");
    image = ["3", 0];
  } else {
    workflow["1"] = node({ image: input }, "LoadImage", "Scene Analysis · immagine");
    image = ["1", 0];
  }
  if (depth) {
    workflow["10"] = node({
      image,
      ckpt_name: "depth_anything_v2_vits.pth",
      resolution: analysisScale >= 0.9 ? 1024 : analysisScale >= 0.5 ? 768 : 512,
    }, "DepthAnythingV2Preprocessor", "Scene Analysis · Depth Anything V2 VITS");
    workflow["11"] = node({
      images: ["10", 0],
      filename_prefix: `SceneIntegration/${profileId}/depth`,
    }, "SaveImage", "Scene Analysis · salva depth");
  }
  if (segmentation) {
    workflow["20"] = node({
      version: "base",
    }, "LayerMask: LoadFlorence2Model", "Scene Analysis · Florence 2");
    workflow["21"] = node({
      florence2_model: ["20", 0],
      image,
      task: "referring expression segmentation",
      text_input: "main person or primary foreground subject",
      detail_method: "GuidedFilter",
      detail_erode: 4,
      detail_dilate: 4,
      black_point: 0.01,
      white_point: 0.99,
      process_detail: true,
      device: "cpu",
      max_megapixels: 2,
    }, "LayerMask: Florence2Ultra", "Scene Analysis · soggetto principale");
    workflow["22"] = node({
      mask: ["21", 1],
    }, "MaskToImage", "Scene Analysis · maschera in immagine");
    workflow["23"] = node({
      images: ["22", 0],
      filename_prefix: `SceneIntegration/${profileId}/subject_mask`,
    }, "SaveImage", "Scene Analysis · salva maschera");
    if (mediaType === "video" && tracking && sam3Checkpoint) {
      workflow["30"] = node({
        ckpt_name: sam3Checkpoint,
      }, "CheckpointLoaderSimple", "Scene Analysis · SAM3");
      workflow["31"] = node({
        images: ["2", 0],
        model: ["30", 0],
        initial_mask: ["21", 1],
        detection_threshold: 0.5,
        max_objects: 1,
        detect_interval: 3,
      }, "SAM3_VideoTrack", "Scene Analysis · tracking soggetto");
      workflow["32"] = node({
        track_data: ["31", 0],
        object_indices: "0",
      }, "SAM3_TrackToMask", "Scene Analysis · maschera temporale");
      workflow["33"] = node({
        mask: ["32", 0],
        start: 0,
        length: 1,
      }, "MaskFromBatch+", "Scene Analysis · primo tracking mask");
      workflow["34"] = node({
        mask: ["33", 0],
      }, "MaskToImage", "Scene Analysis · tracking mask in immagine");
      workflow["35"] = node({
        images: ["34", 0],
        filename_prefix: `SceneIntegration/${profileId}/tracked_mask`,
      }, "SaveImage", "Scene Analysis · salva tracking mask");
    }
  }
  return workflow;
}
