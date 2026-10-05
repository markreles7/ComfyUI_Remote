import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { normalizePlaguekindDuration } from "../src/plaguekind-duration.js";

const execFile = promisify(execFileCallback);

test("PlagueKind porta video e audio da 3,75 a 4,00 secondi senza cambiare i 90 frame", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plaguekind-duration-test-"));
  t.after(() => {
    if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith("plaguekind-duration-test-")) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  const folder = path.join(root, "VideoStudio");
  fs.mkdirSync(folder);
  const input = path.join(folder, "clip.mp4");
  await execFile("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-frames:v", "90",
    "-t", "3.75", "-c:v", "libx264", "-c:a", "aac", input], { windowsHide: true });
  const media = { filename: "clip.mp4", subfolder: "VideoStudio", type: "output" };
  const corrected = await normalizePlaguekindDuration(root, media, 4);
  assert.equal(corrected.filename, "clip-timed.mp4");
  const { stdout } = await execFile("ffprobe", ["-v", "error", "-show_entries",
    "stream=codec_type,duration,nb_frames:format=duration", "-of", "json",
    path.join(folder, corrected.filename)], { windowsHide: true });
  const info = JSON.parse(stdout);
  assert.equal(info.streams.find((stream) => stream.codec_type === "video").nb_frames, "90");
  assert.ok(Math.abs(Number(info.format.duration) - 4) < 0.002);
  assert.ok(Math.abs(Number(info.streams.find((stream) => stream.codec_type === "audio").duration) - 4) < 0.002);
  assert.equal((await normalizePlaguekindDuration(root, corrected, 4)).filename, corrected.filename);
});
