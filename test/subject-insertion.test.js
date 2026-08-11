import assert from "node:assert/strict";
import test from "node:test";
import {
  planSubjectInsertion,
  preservationMetrics,
  subjectInsertionResult,
} from "../src/subject-insertion/index.js";

const nodes = [
  "LayerMask: SegmentAnythingUltra V2",
  "DepthAnythingV2Preprocessor",
  "ImageCompositeMasked",
  "ImageCropByMaskAndResize",
  "ImageUncropByMask",
  "TextEncodeQwenImageEditPlus",
  "ModelPatchLoader",
];

test("Subject Insertion separa bbox, maschera e identità e preserva i parametri nativi", () => {
  const plan = planSubjectInsertion({
    sourceFile: "bar.png",
    operation: "addPerson",
    prompt: "Insert a third adult man between the two men at the bar.",
    subjectName: "Third man",
    characterId: "third-man",
    placement: { x: 0.42, y: 0.2, width: 0.2, height: 0.7 },
    compositionPolicy: "recomposeGroup",
    references: [{ file: "third-man-front.png", role: "identity" }],
    modelFamily: "qwenEdit",
    sceneProfile: {
      id: "scene-1",
      confidenceScores: { camera: 0.8, spatial: 0.7 },
      spatialProfile: { depthMap: { value: "depth.png", confidence: 0.8 } },
      artifacts: {},
    },
  }, { availableNodes: nodes });
  assert.equal(plan.placement.box.isMask, false);
  assert.equal(plan.masks.edit, null);
  assert.equal(plan.identity.characterId, "third-man");
  assert.equal(plan.strategy.parameterPolicy, "preserve-native");
  assert.deepEqual(plan.strategy.nativeParameters, ["steps", "guidance", "denoise", "referenceStrength"]);
  assert.ok(plan.fallbacks.some((item) => item.includes("riquadro")));
  assert.ok(plan.fallbacks.some((item) => item.includes("Maschera soggetto")));
  assert.equal(plan.scene.localFinishingOnly, true);
  assert.equal(plan.scene.globalFinishing, false);
  assert.equal(plan.scene.protectedPixelComposite, false);
  assert.equal(subjectInsertionResult(plan, { final: "final.png" }).final, "final.png");
});

test("Klein dichiara il fallback depth senza simulare un controllo incompatibile", () => {
  const plan = planSubjectInsertion({
    sourceFile: "frame.png",
    operation: "addObject",
    prompt: "Place a lamp on the table.",
    spatialInstruction: "on the table",
    modelFamily: "flux2",
  }, { availableNodes: nodes });
  assert.equal(plan.strategy.family, "flux2-klein");
  assert.equal(plan.strategy.supports.depthControl, false);
  assert.ok(plan.fallbacks.some((item) => item.includes("ControlNet depth")));
});

test("le metriche misurano preservazione fuori maschera e continuità del bordo", () => {
  const source = Array.from({ length: 9 }, () => [0, 0, 0]);
  const result = source.map((pixel) => [...pixel]);
  const mask = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  result[4] = [255, 255, 255];
  let metrics = preservationMetrics(source, result, mask, 3, 3, { boundaryRadius: 1 });
  assert.equal(metrics.changedPixelsOutsideMask, 0);
  assert.equal(metrics.outsideRoiPreservationScore, 100);
  result[0] = [255, 0, 0];
  metrics = preservationMetrics(source, result, mask, 3, 3, { boundaryRadius: 1 });
  assert.equal(metrics.changedPixelsOutsideMask, 1);
  assert.ok(metrics.outsideRoiPreservationScore < 100);
});
