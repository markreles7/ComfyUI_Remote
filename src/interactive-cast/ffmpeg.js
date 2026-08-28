import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function ffmpeg(args, { timeout = 180_000 } = {}) {
  const result = await execFile("ffmpeg", args, { timeout, windowsHide: true });
  return {
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
  };
}

export async function commandVersion(command, args = ["-version"]) {
  try {
    const { stdout } = await execFile(command, args, { timeout: 15_000, windowsHide: true });
    return { available: true, version: String(stdout || "").split(/\r?\n/)[0] || command };
  } catch (error) {
    return { available: false, version: "", error: error.message };
  }
}

export async function ffprobeJson(file) {
  const { stdout } = await execFile("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    file,
  ], { timeout: 60_000, windowsHide: true });
  return JSON.parse(stdout);
}

export async function extractFrame({ input, output, time = 0 }) {
  await ffmpeg([
    "-y",
    "-ss", String(Math.max(0, Number(time) || 0)),
    "-i", input,
    "-frames:v", "1",
    "-q:v", "2",
    output,
  ]);
  return output;
}

export async function extractAudioWav({ input, output }) {
  await ffmpeg([
    "-y",
    "-i", input,
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "48000",
    "-ac", "2",
    output,
  ], { timeout: 300_000 });
  return output;
}

export async function filterAudioWav({ input, output, filter }) {
  const args = [
    "-y",
    "-i", input,
    "-vn",
  ];
  if (filter) args.push("-af", String(filter));
  args.push(
    "-acodec", "pcm_s16le",
    "-ar", "48000",
    "-ac", "2",
    output,
  );
  await ffmpeg(args, { timeout: 300_000 });
  return output;
}

export async function cutAudioSegmentWav({ input, output, start = 0, end = 0 }) {
  const startValue = Math.max(0, Number(start) || 0);
  const duration = Math.max(0.05, (Number(end) || 0) - startValue);
  await ffmpeg([
    "-y",
    "-ss", String(startValue),
    "-i", input,
    "-t", String(duration),
    "-vn",
    "-acodec", "pcm_s16le",
    "-ar", "48000",
    "-ac", "2",
    output,
  ], { timeout: 180_000 });
  return output;
}

export async function cutVideoSegment({ input, output, start = 0, end = 0 }) {
  const startValue = Math.max(0, Number(start) || 0);
  const duration = Math.max(0.01, (Number(end) || 0) - startValue);
  await ffmpeg([
    "-y",
    "-ss", String(startValue),
    "-i", input,
    "-t", String(duration),
    "-map", "0",
    "-c", "copy",
    "-avoid_negative_ts", "make_zero",
    output,
  ], { timeout: 300_000 });
  return output;
}

export async function normalizeGeneratedSegment({ generatedVideo, sourceClip, output, duration, nativeDialogueWindows = [] }) {
  const [probe, generatedProbe] = await Promise.all([
    ffprobeJson(sourceClip),
    ffprobeJson(generatedVideo),
  ]);
  const video = (probe.streams || []).find((stream) => stream.codec_type === "video") || {};
  const width = Math.max(2, Number(video.width) || 1280);
  const height = Math.max(2, Number(video.height) || 720);
  const fps = frameRate(video.avg_frame_rate || video.r_frame_rate) || 24;
  const targetDuration = Math.max(0.04, Number(duration) || Number(probe.format?.duration) || 1);
  const videoFilter = `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,fps=${fps},setsar=1[v]`;
  const hasGeneratedAudio = (generatedProbe.streams || []).some((stream) => stream.codec_type === "audio");
  const hasSourceAudio = (probe.streams || []).some((stream) => stream.codec_type === "audio");
  const dialogueWindows = hasGeneratedAudio && hasSourceAudio
    ? nativeDialogueWindows
      .map((window) => ({
        start: Math.max(0, Math.min(targetDuration, Number(window.start) || 0)),
        end: Math.max(0, Math.min(targetDuration, Number(window.end) || 0)),
      }))
      .filter((window) => window.end > window.start)
    : [];
  const filterParts = [videoFilter];
  let audioMap = "1:a?";
  if (dialogueWindows.length) {
    const duckExpression = dialogueWindows
      .map((window) => `between(t\\,${window.start.toFixed(3)}\\,${window.end.toFixed(3)})`)
      .join("+");
    filterParts.push(`[1:a]volume='if(gt(${duckExpression}\\,0)\\,0.35\\,1)'[source_audio]`);
    const generatedLabels = dialogueWindows.map((window, index) => {
      const label = `native_${index}`;
      const delay = Math.round(window.start * 1000);
      filterParts.push(`[0:a]atrim=start=${window.start.toFixed(3)}:end=${window.end.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${delay}|${delay}[${label}]`);
      return `[${label}]`;
    });
    filterParts.push(`[source_audio]${generatedLabels.join("")}amix=inputs=${generatedLabels.length + 1}:duration=first:normalize=0[audio]`);
    audioMap = "[audio]";
  }
  await ffmpeg([
    "-y",
    "-i", generatedVideo,
    "-i", sourceClip,
    "-filter_complex", filterParts.join(";"),
    "-map", "[v]",
    "-map", audioMap,
    "-t", String(targetDuration),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-movflags", "+faststart",
    output,
  ], { timeout: 600_000 });
  return {
    output,
    width,
    height,
    fps,
    duration: targetDuration,
    audioSource: dialogueWindows.length ? "original-segment+ltx-native-dialogue" : "original-segment",
    nativeDialogueWindows: dialogueWindows,
  };
}

export async function mixAudioOverlays({ baseAudio, overlays = [], output }) {
  const readyOverlays = overlays.filter((overlay) => overlay?.input);
  if (!readyOverlays.length) {
    await ffmpeg([
      "-y",
      "-i", baseAudio,
      "-acodec", "pcm_s16le",
      "-ar", "48000",
      "-ac", "2",
      output,
    ], { timeout: 300_000 });
    return output;
  }

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, number(value, min)));
  const args = ["-y", "-i", baseAudio];
  for (const overlay of readyOverlays) args.push("-i", overlay.input);
  const chains = [];
  let baseLabel = "[0:a]";
  readyOverlays.forEach((overlay, index) => {
    const start = Math.max(0, number(overlay.start, 0));
    const duration = Math.max(0, number(overlay.duration, number(overlay.end, start) - start));
    const end = Math.max(start, number(overlay.end, duration ? start + duration : start));
    if (overlay.ducking !== false && end > start) {
      const duckVolume = clamp(overlay.duckVolume ?? 0.45, 0.05, 1);
      const duckIn = Math.max(0, start - clamp(overlay.duckLead ?? 0.08, 0, 1));
      const duckOut = end + clamp(overlay.duckTail ?? 0.16, 0, 1);
      const nextBase = `[b${index}]`;
      chains.push(`${baseLabel}volume=volume=${duckVolume}:enable='between(t\\,${duckIn.toFixed(3)}\\,${duckOut.toFixed(3)})'${nextBase}`);
      baseLabel = nextBase;
    }
  });
  readyOverlays.forEach((overlay, index) => {
    const delay = Math.max(0, Math.round(number(overlay.start, 0) * 1000));
    const volume = clamp(overlay.volume ?? 1, 0, 4);
    const duration = Math.max(0, number(overlay.duration, number(overlay.end, 0) - number(overlay.start, 0)));
    const fadeIn = clamp(overlay.fadeIn ?? 0.035, 0, 1);
    const fadeOut = clamp(overlay.fadeOut ?? 0.05, 0, 1);
    const overlayFilters = [`volume=${volume}`];
    if (fadeIn > 0) overlayFilters.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
    if (duration > fadeOut && fadeOut > 0) {
      overlayFilters.push(`afade=t=out:st=${Math.max(0, duration - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
    }
    overlayFilters.push(`adelay=${delay}|${delay}`);
    chains.push(`[${index + 1}:a]${overlayFilters.join(",")}[d${index}]`);
  });
  const mixInputs = [baseLabel, ...readyOverlays.map((_, index) => `[d${index}]`)].join("");
  const filter = `${chains.join(";")};${mixInputs}amix=inputs=${readyOverlays.length + 1}:duration=longest:dropout_transition=0,alimiter=limit=0.95,dynaudnorm=f=75:g=11[aout]`;
  await ffmpeg([
    ...args,
    "-filter_complex", filter,
    "-map", "[aout]",
    "-acodec", "pcm_s16le",
    "-ar", "48000",
    "-ac", "2",
    output,
  ], { timeout: 300_000 });
  return output;
}

export async function concatVideoSegments({ manifest, output }) {
  await ffmpeg([
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", manifest,
    "-c", "copy",
    output,
  ], { timeout: 300_000 });
  return output;
}

export async function muxAudioIntoVideo({ video, audio, output }) {
  await ffmpeg([
    "-y",
    "-i", video,
    "-i", audio,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "192k",
    "-shortest",
    "-movflags", "+faststart",
    output,
  ], { timeout: 300_000 });
  return output;
}

export async function compositeVideoWithMask({ baseVideo, overlayVideo, maskImage, output, feather = 7 }) {
  const blur = Math.max(0, Math.min(40, Number(feather) || 0));
  const filter = [
    "[1:v][0:v]scale2ref=w=iw:h=ih[fg][base]",
    "[2:v][base]scale2ref=w=iw:h=ih[mask][base2]",
    `[mask]format=gray,gblur=sigma=${blur}[alpha]`,
    "[fg][alpha]alphamerge[fgalpha]",
    "[base2][fgalpha]overlay=0:0:format=auto[v]",
  ].join(";");
  await ffmpeg([
    "-y",
    "-i", baseVideo,
    "-i", overlayVideo,
    "-i", maskImage,
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "copy",
    "-shortest",
    "-movflags", "+faststart",
    output,
  ], { timeout: 300_000 });
  return output;
}

export async function ffmpegSceneDetect({ input, threshold = 0.35 }) {
  const result = await ffmpeg([
    "-hide_banner",
    "-i", input,
    "-filter:v", `select=gt(scene\\,${Number(threshold) || 0.35}),showinfo`,
    "-f", "null",
    "-",
  ], { timeout: 300_000 });
  return result.stderr;
}

export function frameRate(value) {
  const text = String(value || "");
  const [num, den] = text.split("/").map(Number);
  if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return num / den;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}
