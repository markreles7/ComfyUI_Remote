import { execFile as execFileCallback } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { resolveMediaFile } from "./media-files.js";

const execFile = promisify(execFileCallback);

async function probe(filePath) {
  const { stdout } = await execFile("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=nb_frames,duration:format=duration", "-of", "json", filePath],
  { windowsHide: true, timeout: 60_000 });
  const data = JSON.parse(stdout);
  const frames = Number(data.streams?.[0]?.nb_frames);
  const duration = Number(data.format?.duration || data.streams?.[0]?.duration);
  if (!Number.isInteger(frames) || frames < 1 || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Impossibile leggere frame e durata del video PlagueKind.");
  }
  return { frames, duration };
}

async function hasAudio(filePath) {
  const { stdout } = await execFile("ffprobe", ["-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=index", "-of", "csv=p=0", filePath],
  { windowsHide: true, timeout: 60_000 });
  return Boolean(stdout.trim());
}

export async function normalizePlaguekindDuration(outputDirectory, media, targetDuration) {
  const target = Number(targetDuration);
  if (!Number.isFinite(target) || target <= 0) throw new Error("Durata PlagueKind non valida.");
  const source = resolveMediaFile(outputDirectory, media)?.path;
  if (!source) throw new Error("Video PlagueKind non trovato nella cartella output locale.");
  const original = await probe(source);
  if (Math.abs(original.duration - target) < 0.002) return media;

  const filename = `${path.parse(media.filename).name}-timed.mp4`;
  const destination = path.join(path.dirname(source), filename);
  const temporary = path.join(path.dirname(source), `${path.parse(filename).name}-${process.pid}.tmp.mp4`);
  const fps = original.frames / target;
  const audio = await hasAudio(source);
  const args = ["-y", "-v", "error", "-i", source, "-filter_complex",
    audio
      ? `[0:v]setpts=N/(${fps}*TB)[v];[0:a]atempo=${original.duration / target},apad,atrim=duration=${target}[a]`
      : `[0:v]setpts=N/(${fps}*TB)[v]`,
    "-map", "[v]", ...(audio ? ["-map", "[a]"] : []), "-fps_mode", "passthrough",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "10",
    ...(audio ? ["-c:a", "aac", "-b:a", "192k"] : []),
    "-movflags", "+faststart", temporary];
  try {
    await execFile("ffmpeg", args, { windowsHide: true, timeout: 180_000 });
    const corrected = await probe(temporary);
    if (corrected.frames !== original.frames || Math.abs(corrected.duration - target) > 0.002) {
      throw new Error(`Durata finale non valida: ${corrected.duration}s invece di ${target}s.`);
    }
    fs.renameSync(temporary, destination);
    return { ...media, filename };
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
