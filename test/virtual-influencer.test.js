import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildStudioJobs } from "../src/studio-workflows.js";
import { buildPhotoPlan, buildVideoPlan, identityEngineConfig, photoStudioRequest, videoWorkflowRequest } from "../src/virtual-influencer/identity-engine.js";
import { virtualInfluencerCacheKey } from "../src/virtual-influencer/cache.js";
import { VirtualInfluencerStore } from "../src/virtual-influencer/store.js";

function tempStore() {
  return new VirtualInfluencerStore({
    dataDirectory: fs.mkdtempSync(path.join(os.tmpdir(), "virtual-influencer-")),
  });
}

function pngBuffer(width = 768, height = 1024) {
  const buffer = Buffer.alloc(40_000);
  buffer.set(Buffer.from("89504e470d0a1a0a", "hex"), 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function adultProfile(overrides = {}) {
  return {
    displayName: "Nova Vale",
    declaredAge: 24,
    synthetic: true,
    imitatesRealPerson: false,
    identity: {
      language: "Italiano",
      fictionalNationality: "Mediterranea immaginaria",
      fictionalCity: "Lumen City",
      narrativeProfession: "digital creator",
      shortBio: "Personaggio virtuale adulto originale.",
    },
    appearance: {
      faceShape: "viso ovale",
      eyeColorAndShape: "occhi verdi a mandorla",
      hair: "capelli castani mossi",
      skinTone: "carnagione olivastra",
      bodyShape: "corporatura atletica",
    },
    ...overrides,
  };
}

test("crea un profilo adulto sintetico con versione iniziale", () => {
  const profile = tempStore().createProfile(adultProfile());
  assert.equal(profile.identityProfile.declaredAge, 24);
  assert.equal(profile.disclosureSettings.synthetic, true);
  assert.equal(profile.contentRules.adultRestrictedEnabled, false);
  assert.equal(profile.versions.length, 1);
  assert.equal(profile.versions[0].versionNumber, 1);
});

test("blocca età sotto 21, profili non sintetici e imitazione reale", () => {
  const store = tempStore();
  assert.throws(() => store.createProfile(adultProfile({ declaredAge: 20 })), /almeno 21/);
  assert.throws(() => store.createProfile(adultProfile({ synthetic: false })), /sintetico/);
  assert.throws(() => store.createProfile(adultProfile({ imitatesRealPerson: true })), /persone reali/);
});

test("blocca termini che rendono ambigua l'età adulta", () => {
  const store = tempStore();
  assert.throws(
    () => store.createProfile(adultProfile({ identity: { shortBio: "teen fashion avatar" } })),
    /Termine non consentito/,
  );
});

test("salvare la Character Bible crea una nuova versione senza sovrascrivere la precedente", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const updated = store.updateBible(created.id, {
    changeLog: "Definizione lock volto.",
    identity: {
      ...created.identityProfile,
      personalHistory: "Background editoriale adulto.",
      values: "creatività, trasparenza",
      habits: "allenamento mattutino",
      typicalLexicon: "luce, ritmo",
      recurringPhrases: "sempre sintetica, sempre dichiarata",
    },
    appearance: {
      ...created.appearanceProfile,
      hair: "capelli ramati lunghi",
      bodyProportions: "proporzioni atletiche realistiche",
      makeup: "trucco naturale luminoso",
      recurringAccessories: "orecchini minimal",
      tattoosEnabled: true,
      tattoos: "piccolo simbolo astratto sulla spalla",
      immutableElements: "occhi verdi, capelli ramati",
    },
    identityLocks: {
      face: { enabled: true, strength: 0.9, tolerance: 0.15, validationThreshold: 0.8 },
    },
  });
  assert.equal(updated.versions.length, 2);
  assert.equal(updated.currentVersionId, updated.versions[1].id);
  assert.equal(updated.versions[0].identitySignature.appearanceProfile.hair, "capelli castani mossi");
  assert.equal(updated.versions[1].identitySignature.appearanceProfile.hair, "capelli ramati lunghi");
  assert.deepEqual(updated.identityProfile.values, ["creatività", "trasparenza"]);
  assert.deepEqual(updated.identityProfile.habits, ["allenamento mattutino"]);
  assert.deepEqual(updated.identityProfile.typicalLexicon, ["luce", "ritmo"]);
  assert.equal(updated.appearanceProfile.tattoos, "piccolo simbolo astratto sulla spalla");
  assert.deepEqual(updated.appearanceProfile.immutableElements, ["occhi verdi", "capelli ramati"]);
});

test("gestisce Identity Dataset, approvazione canonica e readiness", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const upload = {
    originalname: "frontale_primo_piano_sorriso_naturale.png",
    mimetype: "image/png",
    size: 40_000,
    buffer: pngBuffer(),
  };
  const added = store.addReference(created.id, upload, { tags: "master, volto" });
  assert.equal(added.asset.status, "pending");
  assert.equal(added.asset.width, 768);
  assert.ok(added.asset.categories.includes("frontale"));
  assert.equal(added.profile.identityDatasetReadiness.status, "insufficient");

  const approved = store.updateReference(created.id, added.asset.id, {
    status: "approved",
    canonical: true,
    categories: "frontale, primo piano, sorriso, luce naturale",
  });
  assert.equal(approved.asset.status, "approved");
  assert.equal(approved.asset.canonical, true);
  assert.equal(approved.profile.identityDatasetReadiness.approvedCount, 1);

  const versioned = store.createVersion(created.id, { changeLog: "Reference canonica approvata." });
  assert.deepEqual(versioned.version.approvedReferences, [added.asset.id]);
});

test("rimuove duplicati reference, permette ordinamento e rimozione dataset", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const upload = {
    originalname: "frontale_primo_piano_sorriso_naturale.png",
    mimetype: "image/png",
    size: 40_000,
    buffer: pngBuffer(),
  };
  const first = store.addReference(created.id, upload, { approved: "true", canonical: "true", sortOrder: 2 });
  const duplicate = store.addReference(created.id, upload, { approved: "true", canonical: "true", sortOrder: 1 });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.profile.referenceAssets.length, 1);
  assert.match(duplicate.asset.quality.warnings.join(" "), /Duplicato/);

  const second = store.addReference(created.id, {
    originalname: "tre_quarti_mezzo_busto_seria_indoor.png",
    mimetype: "image/png",
    size: 40_000,
    buffer: pngBuffer(1024, 768),
  }, { sortOrder: 1 });
  assert.equal(second.asset.comparison.method, "dataset-overlap-heuristic");
  assert.equal(second.profile.referenceAssets[0].id, second.asset.id);

  const reordered = store.updateReference(created.id, first.asset.id, { sortOrder: 0 });
  assert.equal(reordered.profile.referenceAssets[0].id, first.asset.id);

  const removed = store.removeReference(created.id, first.asset.id);
  assert.equal(removed.removed, first.asset.id);
  assert.equal(removed.profile.referenceAssets.length, 1);
});

test("Identity Engine seleziona reference, compone piano foto e dichiara adapter", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const refs = [
    ["frontale_primo_piano_sorriso_naturale.png", "frontale, primo piano, sorriso, luce naturale"],
    ["tre_quarti_mezzo_busto_seria_indoor.png", "tre quarti, mezzo busto, seria, luce interna"],
  ].map(([originalname, categories], index) =>
    store.addReference(created.id, {
      originalname,
      mimetype: "image/png",
      size: 40_000,
      buffer: pngBuffer(768 + index * 64, 1024),
    }, { approved: "true", canonical: "true", categories }).asset
  );
  const profile = store.getProfile(created.id);
  const plan = buildPhotoPlan(profile, {
    model: "qwen",
    qualityPreset: "balanced",
    outfit: "abito elegante rosso",
    location: "hotel immaginario",
    pose: "in piedi",
    expression: "sorriso",
    framing: "primo piano",
    orientation: "frontale",
    aspectRatio: "portrait",
    contentLevel: 1,
    seed: 123,
  });
  assert.equal(plan.adapter.name, "QwenIdentityAdapter");
  assert.equal(plan.references.length, 2);
  assert.equal(plan.references[0].id, refs[0].id);
  assert.match(plan.prompt, /fictional AI-generated adult virtual creator/);
  assert.equal(plan.identitySignature.referenceIds.length, 2);
  assert.equal(identityEngineConfig().adapters.flux.name, "FluxIdentityAdapter");
  assert.ok(plan.adapter.unavailableControls.includes("unauthorized-face-swap"));
});

test("Influencer Photo traduce una singola richiesta in bozze Studio numericamente valide", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  store.data.profiles.find((item) => item.id === created.id).contentRules.maxContentLevel = 3;
  store.addReference(created.id, {
    originalname: "frontale_primo_piano_sorriso_naturale.png",
    mimetype: "image/png",
    size: 40_000,
    buffer: pngBuffer(),
  }, { approved: "true", canonical: "true", categories: "frontale, primo piano, sorriso, luce naturale" });
  const outfit = store.createOutfit(created.id, {
    name: "Olive crop top selfie",
    category: "casual",
    sensualityLevel: 3,
    description: "top aderente glamour adulto",
  }).outfit;
  const location = store.createLocation(created.id, {
    name: "Camera privata luce finestra",
    type: "camera da letto",
    description: "luce naturale morbida",
  }).location;
  const enriched = store.enrichGenerationInput(created.id, {
    model: "qwen",
    qualityPreset: "fastPreview",
    aspectRatio: "vertical",
    contentLevel: "1",
    outfitId: outfit.id,
    locationId: location.id,
    seed: "",
  });
  const plan = buildPhotoPlan(store.getProfile(created.id), enriched);
  assert.equal(plan.contentLevel, 3);
  assert.equal(plan.seed, undefined);
  assert.equal(plan.quantity, 1);

  const request = photoStudioRequest(plan, [{ name: "reference.png", subfolder: "VirtualInfluencer" }]);
  assert.equal(request.alternatives, 2);
  const jobs = buildStudioJobs("perfect", request, {
    source: request.sourceUpload,
    references: request.referenceUploads,
  }, []);
  assert.equal(jobs.length, 2);
});

test("Identity Engine blocca prompt foto con ambiguità sull'età", () => {
  const store = tempStore();
  const profile = store.createProfile(adultProfile());
  assert.throws(
    () => buildPhotoPlan(profile, { outfit: "schoolgirl uniform", contentLevel: 0 }),
    /Termine non consentito/,
  );
});

test("gestisce lifecycle foto: asset, validation score, review ed export metadata", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const added = store.addReference(created.id, {
    originalname: "frontale_primo_piano_sorriso_naturale.png",
    mimetype: "image/png",
    size: 40_000,
    buffer: pngBuffer(),
  }, { approved: "true", canonical: "true", categories: "frontale, primo piano, sorriso, luce naturale" });
  const profile = store.getProfile(created.id);
  const plan = buildPhotoPlan(profile, {
    model: "flux",
    qualityPreset: "fastPreview",
    outfit: "look casual",
    location: "studio fotografico",
    contentLevel: 0,
  });
  const createdAsset = store.createPhotoAsset(profile.id, plan, "project-1", ["generation-1"]);
  assert.equal(createdAsset.asset.status, "generating");
  assert.equal(createdAsset.asset.referenceIds[0], added.asset.id);
  assert.ok(createdAsset.asset.validationScores.identity.overallScore > 0);
  assert.equal(createdAsset.asset.disclosure.text, profile.disclosureSettings.defaultText);

  const finalized = store.updateGeneratedAssetFromGeneration({
    id: "generation-1",
    virtualInfluencer: { profileId: profile.id, assetId: createdAsset.asset.id },
    images: [{ filename: "final.png", subfolder: "Studio/perfect", type: "output" }],
    outputWidth: 1080,
    outputHeight: 1350,
    imageModelName: "Flux.2 Klein 9B",
    imageModelFile: "FLUX2\\flux2Klein_9bBase.safetensors",
    workflowId: "studio:perfect",
    finishedAt: "2026-08-01T10:00:00.000Z",
  });
  assert.equal(finalized.asset.status, "review");
  assert.equal(finalized.asset.outputFiles.length, 1);
  assert.ok(finalized.asset.review.identityScore >= createdAsset.asset.review.identityScore);

  const reviewed = store.reviewGeneratedAsset(profile.id, createdAsset.asset.id, { action: "approve" });
  assert.equal(reviewed.asset.approvalStatus, "approved");

  const correction = store.reviewGeneratedAsset(profile.id, createdAsset.asset.id, {
    action: "correct",
    instruction: "Rafforzare occhi e capelli.",
  });
  assert.equal(correction.asset.status, "needs-correction");
  assert.match(correction.asset.review.correctionRequested.instruction, /occhi/);

  const regeneration = store.reviewGeneratedAsset(profile.id, createdAsset.asset.id, {
    action: "regenerate",
    reason: "Identity score da migliorare.",
  });
  assert.equal(regeneration.asset.status, "regenerate-requested");

  const comparison = store.compareGeneratedAssetVersions(profile.id, createdAsset.asset.id);
  assert.equal(comparison.comparison.assetId, createdAsset.asset.id);
  assert.ok(comparison.comparison.comparisons.length >= 1);

  const exported = store.exportGeneratedAsset(profile.id, createdAsset.asset.id, { preset: "instagramStory" });
  assert.equal(exported.export.aspectRatio, "9:16");
  assert.equal(exported.export.preservesMaster, true);
  assert.equal(exported.export.disclosure.text, profile.disclosureSettings.defaultText);
});

test("Identity Engine crea piani video LTX con keyframe, durata breve e adapter dichiarato", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const reference = store.addReference(created.id, {
    originalname: "frontale_mezzo_busto_neutra_naturale.png",
    mimetype: "image/png",
    size: 40_000,
    buffer: pngBuffer(),
  }, { approved: "true", canonical: "true", categories: "frontale, mezzo busto, espressione neutra, luce naturale" });
  const plan = buildVideoPlan(store.getProfile(created.id), {
    qualityPreset: "balanced",
    actionPrompt: "slow natural walk toward the camera",
    cameraMotion: "slow push-in",
    motionIntensity: "medium",
    duration: 7,
    fps: 24,
    aspectRatio: "vertical",
    contentLevel: 0,
    seed: 456,
  });
  assert.equal(plan.adapter.name, "LTXIdentityAdapter");
  assert.equal(plan.keyframeReferenceId, reference.asset.id);
  assert.equal(plan.duration, 7);
  assert.equal(plan.fps, 24);
  assert.match(plan.prompt, /temporal consistency/);
  const raw = videoWorkflowRequest(plan);
  assert.equal(raw.workflowId, "standard");
  assert.equal(raw.orientation, "portrait");
  assert.equal(raw.duration, 7);
});

test("Influencer Video richiede reference approvata come keyframe", () => {
  const store = tempStore();
  const profile = store.createProfile(adultProfile());
  assert.throws(
    () => buildVideoPlan(profile, { actionPrompt: "turns toward camera", duration: 5 }),
    /reference approvata/,
  );
});

test("gestisce lifecycle video: asset, temporal score, review ed export metadata", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const added = store.addReference(created.id, {
    originalname: "frontale_mezzo_busto_neutra_naturale.png",
    mimetype: "image/png",
    size: 40_000,
    buffer: pngBuffer(),
  }, { approved: "true", canonical: "true", categories: "frontale, mezzo busto, espressione neutra, luce naturale" });
  const profile = store.getProfile(created.id);
  const plan = buildVideoPlan(profile, {
    actionPrompt: "subtle smile and hand gesture",
    duration: 5,
    contentLevel: 0,
  });
  const createdAsset = store.createVideoAsset(profile.id, plan, "video-project-1", ["video-generation-1"]);
  assert.equal(createdAsset.asset.type, "video");
  assert.equal(createdAsset.asset.keyframeReferenceId, added.asset.id);
  assert.ok(createdAsset.asset.review.temporalIdentityScore > 0);

  const finalized = store.updateGeneratedAssetFromGeneration({
    id: "video-generation-1",
    virtualInfluencer: { profileId: profile.id, assetId: createdAsset.asset.id },
    videos: [{ filename: "final.mp4", subfolder: "video", type: "output" }],
    duration: 5,
    fps: 24,
    videoModelName: "LTX 2.3",
    videoModelFile: "LTX2.3\\ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors",
    workflowId: "virtualInfluencer:video",
    finishedAt: "2026-08-01T10:00:00.000Z",
  });
  assert.equal(finalized.asset.status, "review");
  assert.equal(finalized.asset.outputFiles.length, 1);
  assert.equal(finalized.asset.metadata.duration, 5);
  assert.ok(finalized.asset.review.temporalIdentityScore > 0);

  const exported = store.exportGeneratedAsset(profile.id, createdAsset.asset.id, { preset: "tiktok" });
  assert.equal(exported.export.aspectRatio, "9:16");
  assert.equal(exported.export.metadata.generatedAssetId, createdAsset.asset.id);
});

test("gestisce librerie outfit e location e le integra nei piani di generazione", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  store.addReference(created.id, {
    originalname: "frontale_primo_piano_sorriso_naturale.png",
    mimetype: "image/png",
    size: 40_000,
    buffer: pngBuffer(),
  }, { approved: "true", canonical: "true", categories: "frontale, primo piano, sorriso, luce naturale" });
  const outfit = store.createOutfit(created.id, {
    name: "Red linen beach set",
    category: "spiaggia",
    description: "coordinato rosso in lino",
    colors: "rosso, bianco",
    materials: "lino",
    accessories: "occhiali da sole",
    sensualityLevel: 1,
  });
  const location = store.createLocation(created.id, {
    name: "Bahamas pool terrace",
    type: "piscina",
    description: "terrazza piscina con vista tropicale immaginaria",
    lightingPreset: "sole morbido",
    cameraPreset: "vertical handheld",
  });
  const enriched = store.enrichGenerationInput(created.id, {
    outfitId: outfit.outfit.id,
    locationId: location.location.id,
    contentLevel: 0,
  });
  assert.match(enriched.outfit, /Red linen beach set/);
  assert.match(enriched.location, /Bahamas pool terrace/);
  assert.equal(enriched.contentLevel, 1);
  const plan = buildPhotoPlan(store.getProfile(created.id), enriched);
  assert.match(plan.prompt, /coordinato rosso/);
  assert.match(plan.prompt, /terrazza piscina/);
});

test("Batch queue stima combinazioni e impedisce avvii accidentali troppo grandi", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const outfit = store.createOutfit(created.id, { name: "Casual denim", category: "casual" }).outfit;
  const location = store.createLocation(created.id, { name: "Photo studio", type: "studio fotografico" }).location;
  const queue = store.createBatchQueue(created.id, {
    outfitIds: [outfit.id],
    locationIds: [location.id],
    poses: "standing, seated",
    expressions: "smile, serious",
    framings: "primo piano",
    aspectRatios: "portrait, square",
    platforms: "instagram",
    maxItems: 12,
  });
  assert.equal(queue.queue.totalOutputs, 8);
  assert.equal(queue.queue.status, "draft");
  assert.equal(queue.queue.controls.cancel, true);
  assert.equal(queue.queue.estimates.diskMb, 144);

  const ready = store.updateBatchQueue(created.id, queue.queue.id, "start");
  assert.equal(ready.queue.status, "ready");
  const paused = store.updateBatchQueue(created.id, queue.queue.id, "pause");
  assert.equal(paused.queue.status, "paused");
  const cancelled = store.updateBatchQueue(created.id, queue.queue.id, "cancel");
  assert.equal(cancelled.queue.status, "cancelled");

  assert.throws(() => store.createBatchQueue(created.id, {
    outfitIds: [outfit.id],
    locationIds: [location.id],
    poses: "a,b,c,d",
    expressions: "a,b,c,d",
    framings: "a,b,c,d",
    aspectRatios: "portrait, square",
    maxItems: 12,
  }), /Batch troppo grande/);
});

test("Caption engine crea bozze coerenti, conserva disclosure e blocca DM ingannevoli", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile({
    identity: {
      ...adultProfile().identity,
      interests: "fitness, fotografia",
      typicalLexicon: "luce, ritmo",
      recurringPhrases: "sempre sintetica, sempre dichiarata",
    },
  }));
  const draft = store.createCaptionDraft(created.id, {
    platform: "instagram",
    contentCategory: "pool editorial",
    objective: "community",
    wordsToAvoid: "fake",
    brief: "momento piscina tropicale",
  });
  assert.equal(draft.caption.approvalRequired, true);
  assert.match(draft.caption.caption, /AI-generated fictional adult character/);
  assert.ok(draft.caption.hashtags.includes("#AIGenerated"));
  assert.match(draft.caption.videoScript, /CTA pubblica/);

  assert.throws(() => store.createCaptionDraft(created.id, {
    contentType: "private dm",
    brief: "write a private message",
  }), /messaggi privati ingannevoli/);
});

test("Voice profile accetta solo voci sintetiche originali, licenziate o con consenso", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  assert.throws(() => store.updateVoiceProfile(created.id, {
    enabled: true,
    provider: "local",
    voiceId: "voice-1",
  }), /voci sintetiche originali/);
  const allowed = store.updateVoiceProfile(created.id, {
    enabled: true,
    provider: "local",
    voiceId: "voice-1",
    syntheticOriginal: true,
    style: "warm",
  });
  assert.equal(allowed.voiceProfile.enabled, true);
  assert.equal(allowed.voiceProfile.syntheticOriginal, true);
});

test("Platform policy resta modificabile e mostra warning di verifica manuale", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const policy = store.updatePlatformPolicy(created.id, "instagram", {
    aspectRatios: "4:5, 9:16",
    requiredMetadata: "syntheticDisclosure",
    source: "admin-editable/manual",
  });
  assert.equal(policy.policy.platform, "instagram");
  assert.deepEqual(policy.policy.aspectRatios, ["4:5", "9:16"]);
  assert.equal(policy.policy.manualVerificationWarning, "Verifica manualmente i termini della piattaforma prima della pubblicazione.");
});

test("Content project richiede approvazione umana prima di schedule/publish e registra analytics manuali", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const project = store.createContentProject(created.id, {
    title: "Pool reveal",
    campaign: "summer",
    platform: "tiktok",
    contentType: "video",
    brief: "short pubblico dichiaratamente sintetico",
    scheduledAt: "2026-08-03T12:00",
  });
  assert.equal(project.project.status, "Draft");
  assert.equal(project.project.humanApprovalRequired, true);
  assert.match(project.project.disclosures[0], /AI-generated fictional adult character/);
  assert.throws(() => store.updateContentProject(created.id, project.project.id, {
    status: "Scheduled",
  }), /approvazione umana/);
  const approved = store.updateContentProject(created.id, project.project.id, { status: "Approved" });
  assert.equal(approved.project.status, "Approved");
  const scheduled = store.updateContentProject(created.id, project.project.id, {
    status: "Scheduled",
    humanApproved: true,
  });
  assert.equal(scheduled.project.status, "Scheduled");
  const analytics = store.recordAnalytics(created.id, project.project.id, {
    views: 1000,
    likes: 120,
    comments: 8,
    shares: 3,
    saves: 4,
    completionRate: 0.62,
    clicks: 12,
  });
  assert.equal(analytics.analytics.views, 1000);
  assert.equal(analytics.project.analytics.length, 1);
  assert.equal(analytics.profile.analyticsEntries.length, 1);
  const imported = store.importAnalyticsCsv(created.id, project.project.id, [
    "views,likes,comments,shares,saves,completionRate,clicks",
    "500,60,4,2,3,0.5,8",
  ].join("\n"));
  assert.equal(imported.imported.length, 1);
  assert.equal(imported.imported[0].csvImported, true);
  assert.equal(imported.profile.analyticsEntries.length, 2);
});

test("Milestone 6 cache: snapshot piani identitari, hit e invalidazione su modifiche profilo", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  store.addReference(created.id, {
    originalname: "frontale_primo_piano_sorriso_naturale.png",
    mimetype: "image/png",
    size: 40_000,
    buffer: pngBuffer(),
  }, { approved: "true", canonical: "true", categories: "frontale, primo piano, sorriso, luce naturale" });
  const profile = store.getProfile(created.id);
  const raw = { qualityPreset: "fastPreview", outfit: "look casual", location: "studio", contentLevel: 0 };
  const key = virtualInfluencerCacheKey(profile, "photo", raw);
  const plan = buildPhotoPlan(profile, raw);
  const stored = store.putCachedPlan(profile.id, "photo", raw, plan);
  assert.equal(stored.key, key);
  const cached = store.getCachedPlan(profile.id, "photo", raw);
  assert.equal(cached.cached, true);
  assert.equal(cached.plan.prompt, plan.prompt);
  assert.equal(store.getProfile(profile.id).runtimeStatus.cache.entries, 1);

  const outfit = store.createOutfit(profile.id, { name: "Cache invalidating blazer", category: "elegante" });
  assert.equal(outfit.profile.runtimeStatus.cache.entries, 0);
});

test("Milestone 6 debug report espone performance, limiti e code senza log sensibili", () => {
  const store = tempStore();
  const created = store.createProfile(adultProfile());
  const report = store.debugReport(created.id);
  assert.equal(report.milestone, 6);
  assert.equal(report.performance.lazyLoading, true);
  assert.equal(report.performance.cancellation, true);
  assert.equal(report.debugging.sensitiveLogs, false);
  assert.ok(report.debugging.unavailableMethods.includes("unauthorized voice cloning"));
  assert.equal(store.config().milestone, 6);
  assert.equal(store.config().performance.cacheIdentityPlans, true);
});
