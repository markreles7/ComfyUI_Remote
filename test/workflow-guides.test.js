import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_WORKFLOW_GUIDES,
  PUBLIC_WORKFLOW_GUIDES,
  VIDEO_WORKFLOW_GUIDES,
  WORKFLOW_GUIDES,
  WORKFLOW_GUIDE_BY_ID,
} from "../public/workflow-guides.js";
import { STUDIO_MODES } from "../src/studio-workflows.js";

test("ogni modalità Studio ha una guida completa e univoca", () => {
  const modeIds = Object.keys(STUDIO_MODES).sort();
  const guideIds = WORKFLOW_GUIDES.map((guide) => guide.id).sort();

  assert.deepEqual(guideIds, modeIds);
  assert.equal(new Set(guideIds).size, guideIds.length);

  for (const guide of WORKFLOW_GUIDES) {
    assert.equal(WORKFLOW_GUIDE_BY_ID[guide.id], guide);
    assert.ok(guide.name);
    assert.ok(guide.summary);
    assert.ok(guide.example);
    assert.ok(guide.bestFor.length >= 2);
    assert.ok(guide.inputs.length >= 2);
    assert.ok(guide.steps.length >= 3);
    assert.ok(guide.settings.length >= 3);
    assert.ok(guide.tips.length >= 2);
  }
});

test("la guida comprende tutti i workflow Video Studio", () => {
  assert.deepEqual(
    VIDEO_WORKFLOW_GUIDES.map((guide) => guide.id),
    [
      "videoMiniMaxH3",
      "videoActionH3",
      "videoInteractiveCast",
      "videoActorReplacement",
      "videoInteractiveScene",
      "videoSceneTransform",
      "videoRetake",
      "videoExtend",
      "videoHdr",
      "videoTemporalUpscale",
    ],
  );
  assert.equal(ALL_WORKFLOW_GUIDES.length, PUBLIC_WORKFLOW_GUIDES.length + VIDEO_WORKFLOW_GUIDES.length + 1);
  assert.deepEqual(
    ALL_WORKFLOW_GUIDES.slice(0, -VIDEO_WORKFLOW_GUIDES.length).map((guide) => guide.id),
    ["sceneIntegration", ...PUBLIC_WORKFLOW_GUIDES.map((guide) => guide.id)],
  );
  for (const guide of VIDEO_WORKFLOW_GUIDES) {
    assert.match(guide.destination, /^\/video-studio\.html\?workflow=/);
    assert.ok(guide.steps.length >= 4);
    assert.ok(guide.settings.length >= 4);
  }
});
