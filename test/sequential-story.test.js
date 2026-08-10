import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  SequentialStoryService,
  SequentialStoryStore,
  cosineSimilarity,
  fingerprintFromPgm,
  finalScenePrompt,
  parseSequentialStoryJson,
  selectBestContinuityFrame,
  validateSequentialStoryPlan,
} from "../src/sequential-story.js";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sequential-story-"));
}

function writePgm(filePath, width, height, pixelAt) {
  const pixels = Buffer.alloc(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels[y * width + x] = Math.max(0, Math.min(255, pixelAt(x, y)));
    }
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.concat([
    Buffer.from(`P5\n${width} ${height}\n255\n`, "ascii"),
    pixels,
  ]));
}

function plan(sceneCount = 3) {
  return {
    title: "Pool to bedroom",
    globalContinuity: {
      character: "same adult woman",
      lighting: "warm natural light",
      visualStyle: "realistic LTX video",
    },
    scenes: Array.from({ length: sceneCount }, (_, index) => ({
      id: `scene-${index + 1}`,
      index: index + 1,
      title: `Scene ${index + 1}`,
      duration: index === 1 ? 8 : 10,
      prompt: `Scene prompt ${index + 1}`,
      negativePrompt: "flicker, identity drift",
      continuityNotes: `Continuity ${index + 1}`,
      startState: `Start ${index + 1}`,
      endState: `End ${index + 1}`,
    })),
  };
}

function makeStore(root = tempRoot()) {
  return new SequentialStoryStore({
    file: path.join(root, "stories.json"),
    assetDirectory: path.join(root, "assets"),
  });
}

function makeService({
  root = tempRoot(),
  generationStatus = "completed",
  missingOutput = false,
  promptAssistant = null,
  anchorFrameGenerator = null,
  identityVerifier = null,
} = {}) {
  const outputDirectory = path.join(root, "output");
  fs.mkdirSync(path.join(outputDirectory, "clips"), { recursive: true });
  const calls = [];
  let generationIndex = 0;
  const generations = new Map();
  const store = makeStore(root);
  const service = new SequentialStoryService({
    store,
    promptAssistant,
    outputDirectory,
    buildWorkflow: (workflowId, raw, upload) => {
      calls.push({ type: "build", workflowId, raw, upload });
      return { workflow: {}, metadata: { workflowName: "Test LTX" } };
    },
    queueJob: async () => {
      generationIndex += 1;
      const id = `generation-${generationIndex}`;
      const video = { filename: `clip-${generationIndex}.mp4`, subfolder: "clips", type: "output" };
      if (!missingOutput) fs.writeFileSync(path.join(outputDirectory, "clips", video.filename), "video");
      generations.set(id, { id, status: generationStatus, videos: [video] });
      return { id, promptId: `prompt-${generationIndex}` };
    },
    generationStore: {
      get(id) {
        return generations.get(id);
      },
    },
    comfy: {
      async free(payload) {
        calls.push({ type: "free", payload });
      },
      async uploadImage(file) {
        calls.push({ type: "upload", file });
        return { name: file.originalname, subfolder: "continuity", type: "input" };
      },
    },
    anchorFrameGenerator,
    identityVerifier,
    execFileImpl: async (command, args) => {
      calls.push({ type: "exec", command, args });
      if (command === "ffprobe" && args.includes("-print_format")) {
        return {
          stdout: JSON.stringify({
            streams: [
              { codec_type: "video", codec_name: "h264", width: 640, height: 360, avg_frame_rate: "24/1", pix_fmt: "yuv420p" },
              { codec_type: "audio", codec_name: "aac" },
            ],
          }),
        };
      }
      if (command === "ffprobe") return { stdout: "5.0" };
      if (command === "ffmpeg") {
        const output = args.at(-1);
        if (String(output).includes("%03d.pgm")) {
          for (let index = 1; index <= 3; index += 1) {
            writePgm(String(output).replace("%03d", String(index).padStart(3, "0")), 8, 8, (x, y) =>
              index === 2 ? ((x + y) % 2) * 255 : 120 + index
            );
          }
          return { stdout: "" };
        }
        if (String(output).endsWith(".pgm")) {
          writePgm(output, 8, 8, (x, y) => ((x + y) % 2) * 255);
          return { stdout: "" };
        }
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, "media");
        return { stdout: "" };
      }
      throw new Error(command);
    },
    generationTimeoutMs: 500,
  });
  return { service, store, calls, outputDirectory, root };
}

async function waitFor(assertion, timeoutMs = 1000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      return assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw lastError;
}

test("planner JSON parse e validazione normalizzano scene 1/2/3", () => {
  const parsed = parseSequentialStoryJson(`\n\`\`\`json\n${JSON.stringify(plan(2))}\n\`\`\``);
  assert.equal(parsed.scenes.length, 2);
  for (const count of [1, 2, 3]) {
    const normalized = validateSequentialStoryPlan(plan(count), { sceneCount: count, sceneDuration: 10 });
    assert.equal(normalized.scenes.length, count);
    assert.deepEqual(normalized.scenes.map((scene) => scene.index), Array.from({ length: count }, (_, index) => index + 1));
  }
  assert.throws(() => validateSequentialStoryPlan({ scenes: [{ prompt: "" }] }), /prompt/);
});

test("selectBestContinuityFrame prepara il futuro smart selector con fallback semplice", () => {
  assert.equal(selectBestContinuityFrame({ frames: [] }), null);
  const selected = selectBestContinuityFrame({
    frames: [{ id: "soft", sharpness: 0.2 }, { id: "sharp", sharpness: 0.9 }],
    criteria: { sharpness: true, faceStability: true, motionBlur: true, poseReadability: true },
  });
  assert.equal(selected.id, "sharp");
});

test("fingerprint percettivo confronta frame simili e diversi", () => {
  const root = tempRoot();
  const a = path.join(root, "a.pgm");
  const b = path.join(root, "b.pgm");
  const c = path.join(root, "c.pgm");
  writePgm(a, 16, 16, (x, y) => ((x + y) % 2) * 255);
  writePgm(b, 16, 16, (x, y) => ((x + y) % 2) * 255);
  writePgm(c, 16, 16, (x) => x * 8);
  assert.ok(cosineSimilarity(fingerprintFromPgm(a), fingerprintFromPgm(b)) > 0.99);
  assert.ok(cosineSimilarity(fingerprintFromPgm(a), fingerprintFromPgm(c)) < 0.8);
});

test("crea progetto persistente e resta leggibile dopo restart store", () => {
  const root = tempRoot();
  const store = makeStore(root);
  const { service } = makeService({ root });
  const project = service.create({ plan: plan(3), settings: { sceneCount: 3, sceneDuration: 10 } });
  assert.equal(project.type, "sequentialStory");
  assert.equal(project.status, "planned");
  assert.equal(project.numberOfScenes, 3);

  const restarted = makeStore(root);
  assert.equal(restarted.require(project.id).title, "Pool to bedroom");
});

test("prompt finale compatta continuity e stato precedente senza duplicare prompt intero", () => {
  const project = { globalContinuity: plan(2).globalContinuity };
  const prompt = finalScenePrompt({
    project,
    scene: plan(2).scenes[1],
    previousScene: plan(2).scenes[0],
    characterPrompt: "Character pack identity prompt",
  });
  assert.match(prompt, /Create one continuous short LTX 2\.3 video shot/);
  assert.match(prompt, /Keep consistent: Character pack identity prompt/);
  assert.match(prompt, /Carry over from the previous clip: Previous ending: End 1/);
  assert.match(prompt, /Action timeline:/);
  assert.doesNotMatch(prompt, /Scene prompt 1/);
});

test("prompt finale normalizza soggetti sensuali ambigui come adulti", () => {
  const prompt = finalScenePrompt({
    project: {
      globalContinuity: {
        character: "young girl with long hair",
      },
    },
    scene: {
      prompt: "girl turns toward camera",
      endState: "girl holds the pose",
    },
  });
  assert.doesNotMatch(prompt, /\bgirl\b/i);
  assert.match(prompt, /adult woman/);
});

test("retry singola scena marca downstream completate come stale", () => {
  const { service, store } = makeService();
  const project = service.create({ plan: plan(3), settings: { sceneCount: 3 } });
  store.update(project.id, {
    scenes: project.scenes.map((scene) => ({ ...scene, status: "completed", outputVideo: { filename: "x.mp4" } })),
  });
  const retried = service.retryScene(project.id, "scene-2");
  assert.equal(retried.scenes[1].status, "pending");
  assert.equal(retried.scenes[2].status, "stale");
  assert.equal(retried.scenes[2].stale, true);
  assert.equal(retried.finalVideo, null);
});

test("render scena singola verifica output, estrae continuity frame e fa purge", async () => {
  const { service, store, calls } = makeService();
  const project = service.create({ plan: plan(1), settings: { sceneCount: 1, purgeBetweenScenes: true } });
  const updated = await service.runSequentialScene(project.id, "scene-1");
  const scene = updated.scenes[0];
  assert.equal(scene.status, "completed");
  assert.ok(fs.existsSync(scene.continuityFrame.path));
  assert.ok(calls.some((call) => call.type === "free"));
  assert.equal(store.require(project.id).generationIds.length, 1);
});

test("la prima scena puo partire da immagine iniziale e usare I2V", async () => {
  const { service, calls } = makeService();
  const project = service.create({
    plan: plan(1),
    settings: { sceneCount: 1, inputMode: "image" },
    initialFrameUpload: { name: "initial.png", subfolder: "input", type: "input" },
    initialFrameSource: { filename: "initial.png", type: "sequential-story-initial-frame" },
  });
  const updated = await service.runSequentialScene(project.id, "scene-1");
  const build = calls.find((call) => call.type === "build");
  assert.equal(build.raw.videoInputMode, "image");
  assert.equal(build.upload.name, "initial.png");
  assert.equal(updated.scenes[0].anchorStatus, "initial image used");
});

test("best-frame selector smart sceglie il candidato piu nitido", async () => {
  const { service } = makeService();
  const project = service.create({ plan: plan(1), settings: { sceneCount: 1 } });
  const result = await service.extractContinuityFrame("video.mp4", {
    projectId: project.id,
    sceneIndex: 1,
    mode: "automatic",
    bestFrameSelector: "smart",
    sampleCount: 3,
    windowSeconds: 1,
  });
  assert.equal(result.mode, "smart-best-frame");
  assert.equal(result.selectedIndex, 1);
  assert.ok(result.score > 0);
  assert.ok(fs.existsSync(result.file.path));
});

test("anchor frame generator dedicato fornisce input I2V e metadata scena", async () => {
  const root = tempRoot();
  const anchorPath = path.join(root, "anchor.png");
  fs.writeFileSync(anchorPath, "anchor");
  const { service } = makeService({
    root,
    anchorFrameGenerator: async () => ({
      status: "anchor generated",
      upload: { name: "anchor.png", subfolder: "anchors", type: "input" },
      file: { path: anchorPath, filename: "anchor.png", type: "sequential-story-anchor" },
      generationId: "anchor-generation",
    }),
  });
  const project = service.create({
    plan: plan(1),
    settings: { sceneCount: 1, anchorFrameMode: "qwen-image-edit" },
  });
  const updated = await service.runSequentialScene(project.id, "scene-1");
  assert.equal(updated.scenes[0].anchorStatus, "anchor generated");
  assert.equal(updated.scenes[0].anchorFrame.filename, "anchor.png");
});

test("identity verification percettiva campiona il video e segnala passed o drift", async () => {
  const { service } = makeService();
  const project = service.create({
    plan: plan(1),
    settings: { sceneCount: 1, identityVerification: "perceptual", identityThreshold: 0.2 },
  });
  const reference = path.join(service.store.sceneAssetDirectory(project.id), "frames", "reference.pgm");
  writePgm(reference, 8, 8, (x, y) => ((x + y) % 2) * 255);
  const report = await service.verifyIdentityPerceptual({
    project,
    sceneIndex: 0,
    videoPath: "video.mp4",
    referenceFrame: { path: reference, filename: "reference.pgm" },
    sampleCount: 3,
    threshold: 0.2,
  });
  assert.equal(report.status, "passed");
  assert.equal(report.sampledFrames, 3);
  assert.ok(report.averageSimilarity > 0.2);
});

test("scene successive usano continuity frame via upload", async () => {
  const { service, store, calls } = makeService();
  const project = service.create({ plan: plan(2), settings: { sceneCount: 2, useContinuityFrame: true } });
  await service.runSequentialScene(project.id, "scene-1");
  await service.runSequentialScene(project.id, "scene-2");
  assert.ok(calls.some((call) => call.type === "upload"));
  const builds = calls.filter((call) => call.type === "build");
  assert.equal(builds[1].raw.videoInputMode, "image");
});

test("errore output mancante fallisce solo la scena corrente", async () => {
  const { service } = makeService({ missingOutput: true });
  const project = service.create({ plan: plan(2), settings: { sceneCount: 2 } });
  const failed = await service.runSequentialScene(project.id, "scene-1");
  assert.equal(failed.status, "failed");
  assert.equal(failed.scenes[0].status, "failed");
  assert.equal(failed.scenes[1].status, "pending");
});

test("start supporta pausa dopo ogni scena e resume fino al finale", async () => {
  const { service, store } = makeService();
  const project = service.create({
    plan: plan(2),
    settings: { sceneCount: 2, pauseAfterEachScene: true, concatEnabled: true },
  });
  await service.start(project.id);
  await waitFor(() => {
    const current = store.require(project.id);
    assert.equal(current.status, "paused");
    assert.equal(current.scenes[0].status, "completed");
    return current;
  });
  await waitFor(() => assert.equal(service.running.has(project.id), false));
  await service.start(project.id);
  await waitFor(() => {
    const current = store.require(project.id);
    assert.equal(current.scenes[1].status, "completed");
    return current;
  });
  await waitFor(() => assert.equal(service.running.has(project.id), false));
  await service.start(project.id);
  await waitFor(() => {
    const current = store.require(project.id);
    assert.equal(current.status, "completed");
    assert.ok(current.finalVideo);
    assert.equal(current.totalDuration, 18);
    return current;
  });
});

test("concat command supporta direct cut, mute e future-global fallback", () => {
  const { service } = makeService();
  const base = service.create({ plan: plan(1), settings: { sceneCount: 1, transition: "cut" } });
  const direct = service.concatCommand(base, ["C:\\video\\a.mp4"], "out.mp4");
  assert.deepEqual(direct.args.slice(-2), ["copy", "out.mp4"]);

  const mute = service.update(base.id, { settings: { ...base.settings, audioMode: "mute" } });
  const muteCommand = service.concatCommand(mute, ["C:\\video\\a.mp4"], "mute.mp4");
  assert.ok(muteCommand.args.includes("-an"));

  const future = service.update(base.id, { settings: { ...base.settings, audioMode: "future-global" } });
  const futureCommand = service.concatCommand(future, ["C:\\video\\a.mp4"], "future.mp4");
  assert.match(futureCommand.warning, /Audio globale continuo non configurato/);
});

test("inspectConcatClips forza re-encode quando width height fps codec o audio differiscono", async () => {
  const { service } = makeService();
  service.execFile = async (_command, args) => {
    const videoPath = args.at(-1);
    const second = String(videoPath).includes("b.mp4");
    return {
      stdout: JSON.stringify({
        streams: [
          {
            codec_type: "video",
            codec_name: second ? "hevc" : "h264",
            width: second ? 1280 : 640,
            height: 360,
            avg_frame_rate: second ? "30/1" : "24/1",
            pix_fmt: "yuv420p",
          },
          ...(second ? [] : [{ codec_type: "audio", codec_name: "aac" }]),
        ],
      }),
    };
  };
  const diagnostics = await service.inspectConcatClips(["a.mp4", "b.mp4"]);
  assert.equal(diagnostics.compatible, false);
  assert.equal(diagnostics.forceReencode, true);
  const project = service.create({ plan: plan(1), settings: { sceneCount: 1, transition: "cut" } });
  const command = service.concatCommand(project, ["a.mp4", "b.mp4"], "out.mp4", diagnostics);
  assert.equal(command.mode, "direct-cut-reencode");
  assert.ok(command.args.includes("libx264"));
});

test("purge classifica errori senza fingere successo e ID invalidi sono rifiutati", async () => {
  const { service, store } = makeService();
  service.comfy.free = async () => {
    throw new Error("offline");
  };
  const purge = await service.purgeComfyVram();
  assert.equal(purge.requested, true);
  assert.equal(purge.successful, false);
  assert.match(purge.warning, /offline/);
  assert.throws(() => store.require("../bad"), /ID non valido/);
});

test("delete pulisce asset temporanei ma preserva riferimenti generazioni", async () => {
  const { service, store } = makeService();
  const project = service.create({ plan: plan(1), settings: { sceneCount: 1 } });
  const assetDirectory = store.sceneAssetDirectory(project.id);
  fs.writeFileSync(path.join(assetDirectory, "frames", "temp.png"), "frame");
  store.update(project.id, { generationIds: ["generation-final"] });

  const result = service.delete(project.id);
  assert.equal(result.deleted, true);
  assert.deepEqual(result.preservedGenerations, ["generation-final"]);
  assert.equal(fs.existsSync(assetDirectory), false);
  assert.throws(() => store.require(project.id), /non trovata/);
});
