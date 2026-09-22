import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = path.resolve(".");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("gli installer Vast.ai coprono Windows, Linux e avvio sicuro su localhost", () => {
  const bat = read("install-vastai-all-in-one.bat");
  const powershell = read("scripts/install-vastai-windows.ps1");
  const linux = read("install-vastai-all-in-one.sh");
  const startWindows = read("scripts/start-vastai-windows.ps1");
  const startLinux = read("start-vastai.sh");

  assert.match(bat, /install-vastai-windows\.ps1/);
  assert.match(powershell, /Comfy-Org\/ComfyUI/);
  assert.match(powershell, /127\.0\.0\.1/);
  assert.match(powershell, /npm ci --omit=dev/);
  assert.match(powershell, /\[switch\]\$ValidateOnly/);
  assert.match(linux, /Comfy-Org\/ComfyUI/);
  assert.match(linux, /uv python install 3\.12/);
  assert.match(linux, /127\.0\.0\.1/);
  assert.match(linux, /--check/);
  assert.match(linux, /pypi\.nvidia\.com[\s\S]*nvidia-vfx/);
  assert.match(linux, /import nvvfx/);
  assert.match(powershell, /pypi\.nvidia\.com[\s\S]*nvidia-vfx/);
  assert.match(startWindows, /--listen", "127\.0\.0\.1/);
  assert.match(startLinux, /--listen 127\.0\.0\.1/);
});

test("il manifesto custom node è valido, univoco e comprende le pipeline principali", () => {
  const entries = read("config/vastai-custom-nodes.txt")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split("|"));

  assert.ok(entries.length >= 15);
  assert.ok(entries.every(([tier, folder, url]) => ["core", "extended"].includes(tier) && folder && /^https:\/\/github\.com\/.+\.git$/.test(url)));
  assert.equal(new Set(entries.map(([, folder]) => folder.toLowerCase())).size, entries.length);
  for (const required of ["ComfyUI-LTXVideo", "ComfyUI-LTX2.5-MSR", "seedvr2_videoupscaler", "Nvidia_RTX_Nodes_ComfyUI", "Comfyui_Minimax_h3_latent_Upscaler"]) {
    assert.ok(entries.some(([, folder]) => folder === required), `manca ${required}`);
  }
});

test("il pacchetto PlagueKind Vast.ai installa e verifica NVIDIA RTX VSR", () => {
  const installer = read("plaguekind-vastai/install.sh");
  const bootstrap = read("plaguekind-vastai/bootstrap-vastai.sh");
  const nodes = read("plaguekind-vastai/nodes.txt");
  assert.match(nodes, /Nvidia_RTX_Nodes_ComfyUI\|https:\/\/github\.com\/Comfy-Org\/Nvidia_RTX_Nodes_ComfyUI\.git/);
  assert.match(installer, /--extra-index-url https:\/\/pypi\.nvidia\.com nvidia-vfx/);
  assert.match(installer, /import nvvfx/);
  assert.match(installer, /NVIDIA RTX Video Super Resolution: nodo e runtime disponibili/);
  assert.match(bootstrap, /plaguekind-vastai\.zip/);
  assert.match(bootstrap, /python3 -m zipfile -e/);
  assert.match(bootstrap, /install\.sh/);
  assert.match(bootstrap, /install\.sh" --check/);
  assert.doesNotMatch(bootstrap, /npm|start-vastai|LTX Remote Studio/i);
});

test("il workflow UHD completa refine e SaveVideo con una sola Queue", () => {
  const workflow = JSON.parse(read("plaguekind-vastai/PlagueKind_H3_V9_Continuous_R2V_UHD_ComfyUI.json"));
  const refine = workflow.nodes.find((node) => node.type === "MiniMaxH3DirectorRefine");
  const saveVideo = workflow.nodes.find((node) => node.type === "SaveVideo");

  assert.ok(refine, "nodo MiniMaxH3DirectorRefine mancante");
  assert.equal(refine.widgets_values_named?.confirm_first_pass, false);
  assert.equal(refine.widgets_values?.[11], false);
  assert.ok(refine.inputs.some((input) => input.name === "confirm_first_pass"));
  assert.match(refine.title, /AUTO/);
  assert.equal(workflow.extra?.plagueKindAutoRefineSingleQueue, true);
  assert.ok(saveVideo?.inputs?.some((input) => input.name === "video" && input.link != null));
});

test("la guida modelli elenca file e destinazioni H3, LTX 2.5, GalaxyAce e SeedVR2", () => {
  const models = read("docs/VASTAI_MODELS.md");
  for (const marker of [
    "minimax_h3_fl2va_pruned_int8_convrot.safetensors",
    "minimax_h3_ref2va_pruned_int8_convrot.safetensors",
    "pinkcherryMMH3Fl2va_06Beta.safetensors",
    "STY_GalaxyAce.safetensors",
    "ltx-2.5-22b-distilled-transformer-comfy-int8-convrot.safetensors",
    "redgraftLTX25Fast2K_ltx25RedgraftNSFW.safetensors",
    "seedvr2_ema_3b-Q4_K_M.gguf",
    "seedvr2_ema_7b_fp16.safetensors",
  ]) assert.match(models, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
