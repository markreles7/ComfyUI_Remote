import fs from "node:fs";
import path from "node:path";
import {
  extractAudioWav,
  extractFrame,
  ffmpegSceneDetect,
  ffprobeJson,
  frameRate,
} from "./ffmpeg.js";

export async function probeVideo(file) {
  const payload = await ffprobeJson(file);
  const video = (payload.streams || []).find((stream) => stream.codec_type === "video") || {};
  const audioStreams = (payload.streams || []).filter((stream) => stream.codec_type === "audio");
  return {
    path: file,
    duration: Number(payload.format?.duration || video.duration || 0),
    width: Number(video.width || 0),
    height: Number(video.height || 0),
    fps: frameRate(video.avg_frame_rate || video.r_frame_rate),
    codec: video.codec_name || "",
    pixelFormat: video.pix_fmt || "",
    audioStreams: audioStreams.map((stream, index) => ({
      index,
      codec: stream.codec_name || "",
      channels: stream.channels || null,
      sampleRate: stream.sample_rate ? Number(stream.sample_rate) : null,
      duration: stream.duration ? Number(stream.duration) : null,
    })),
    raw: {
      formatName: payload.format?.format_name || "",
      bitRate: payload.format?.bit_rate ? Number(payload.format.bit_rate) : null,
    },
  };
}

export function sceneWindowsFromCuts(times, duration) {
  const sorted = [...new Set(times.map((time) => Number(time)).filter((time) =>
    Number.isFinite(time) && time > 0 && (!duration || time < duration)
  ))].sort((a, b) => a - b);
  const boundaries = [0, ...sorted, duration].filter((time, index, all) =>
    Number.isFinite(time) && (index === 0 || time > all[index - 1])
  );
  const cuts = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    cuts.push({
      start: boundaries[index],
      end: boundaries[index + 1],
      confidence: index === 0 && !sorted.length ? 0.35 : 0.68,
      reason: sorted.length ? "ffmpeg scene threshold" : "single-shot fallback",
    });
  }
  return cuts;
}

export function parseSceneDetectLog(stderr) {
  return String(stderr || "")
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/pts_time:([0-9.]+)/);
      return match ? Number(match[1]) : null;
    })
    .filter((time) => Number.isFinite(time));
}

export async function detectSceneCuts(file, analysis, { threshold = 0.35 } = {}) {
  try {
    const log = await ffmpegSceneDetect({ input: file, threshold });
    const times = parseSceneDetectLog(log);
    return {
      configured: true,
      method: "ffmpeg-scenedetect",
      threshold,
      cuts: sceneWindowsFromCuts(times, Number(analysis?.duration || 0)),
    };
  } catch (error) {
    return {
      ...detectSceneCutsPlaceholder(analysis),
      error: error.message,
    };
  }
}

export function detectSceneCutsPlaceholder(analysis) {
  const duration = Number(analysis?.duration || 0);
  return {
    configured: false,
    method: "ffmpeg-scenedetect-placeholder",
    cuts: duration ? [{ start: 0, end: duration, confidence: 0.35, reason: "single-shot fallback" }] : [],
  };
}

export function referenceFrameTimes(duration) {
  const safeDuration = Math.max(0, Number(duration) || 0);
  if (!safeDuration) return [0];
  return [
    0.05,
    Math.max(0.05, safeDuration * 0.5),
    Math.max(0.05, safeDuration - 0.25),
  ].map((time) => Math.min(time, Math.max(0.05, safeDuration - 0.05)));
}

export async function extractVideoArtifacts({ input, analysis, directory }) {
  fs.mkdirSync(directory, { recursive: true });
  const framesDirectory = path.join(directory, "frames");
  const audioDirectory = path.join(directory, "audio");
  fs.mkdirSync(framesDirectory, { recursive: true });
  fs.mkdirSync(audioDirectory, { recursive: true });
  const frames = [];
  for (const [index, time] of referenceFrameTimes(analysis.duration).entries()) {
    const filename = `reference-${String(index + 1).padStart(2, "0")}-${time.toFixed(2).replace(".", "_")}s.jpg`;
    const target = path.join(framesDirectory, filename);
    try {
      await extractFrame({ input, output: target, time });
      frames.push({
        role: index === 0 ? "start" : index === 1 ? "middle" : "end",
        time,
        filename,
        path: target,
        relativePath: `frames/${filename}`,
        mimeType: "image/jpeg",
      });
    } catch (error) {
      frames.push({
        role: index === 0 ? "start" : index === 1 ? "middle" : "end",
        time,
        error: error.message,
      });
    }
  }
  let audio = null;
  if ((analysis.audioStreams || []).length) {
    const filename = "source-dialogue-mix.wav";
    const target = path.join(audioDirectory, filename);
    try {
      await extractAudioWav({ input, output: target });
      audio = {
        role: "sourceMix",
        filename,
        path: target,
        relativePath: `audio/${filename}`,
        mimeType: "audio/wav",
      };
    } catch (error) {
      audio = { role: "sourceMix", error: error.message };
    }
  }
  return {
    frames,
    audio,
  };
}
