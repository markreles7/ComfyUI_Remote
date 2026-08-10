import fs from "node:fs";
import path from "node:path";
import { cosineSimilarity, fingerprintFromPgm } from "../sequential-story.js";
import { ffmpeg } from "./ffmpeg.js";

async function frameToPgm({ input, output, time = null }) {
  const args = ["-y"];
  if (time !== null) args.push("-ss", String(Math.max(0, Number(time) || 0)));
  args.push(
    "-i", input,
    "-frames:v", "1",
    "-vf", "scale=96:96:flags=bicubic,format=gray",
    output,
  );
  await ffmpeg(args, { timeout: 60_000 });
  return output;
}

async function sampleVideoFrames({ input, outputPattern, sampleCount = 6 }) {
  await ffmpeg([
    "-y",
    "-i", input,
    "-vf", "fps=1,scale=96:96:flags=bicubic,format=gray",
    "-frames:v", String(Math.max(1, Number(sampleCount) || 6)),
    outputPattern,
  ], { timeout: 120_000 });
}

export async function verifySegmentIdentity({
  segment,
  referenceFrame = null,
  replacementPath = null,
  projectDirectory,
  threshold = 0.58,
  sampleCount = 6,
} = {}) {
  const videoPath = replacementPath || segment?.replacementPath;
  const sourceReference = referenceFrame?.path || segment?.sourceClipPath || segment?.path || null;
  const segmentId = String(segment?.id || "segment").replace(/[^\w-]+/g, "_");
  if (!videoPath || !fs.existsSync(videoPath)) {
    return {
      status: "insufficient-output",
      engine: "interactive-cast-perceptual-pgm",
      warning: "Nessun segmento generato disponibile per identity check.",
    };
  }
  if (!sourceReference || !fs.existsSync(sourceReference)) {
    return {
      status: "insufficient-reference",
      engine: "interactive-cast-perceptual-pgm",
      warning: "Nessun frame o source clip originale disponibile per confrontare l'identità.",
    };
  }
  const identityDirectory = path.join(projectDirectory, "identity", segmentId);
  fs.rmSync(identityDirectory, { recursive: true, force: true });
  fs.mkdirSync(identityDirectory, { recursive: true });
  try {
    const referencePgm = path.join(identityDirectory, "reference.pgm");
    await frameToPgm({
      input: sourceReference,
      output: referencePgm,
      time: referenceFrame?.path ? null : segment?.start || 0,
    });
    const samplePattern = path.join(identityDirectory, "sample-%03d.pgm");
    await sampleVideoFrames({ input: videoPath, outputPattern: samplePattern, sampleCount });
    const reference = fingerprintFromPgm(referencePgm);
    const samples = fs.readdirSync(identityDirectory)
      .filter((name) => /^sample-\d+\.pgm$/i.test(name))
      .sort()
      .map((name, index) => {
        const file = path.join(identityDirectory, name);
        return {
          index,
          file,
          relativePath: `identity/${segmentId}/${name}`,
          similarity: Number(cosineSimilarity(reference, fingerprintFromPgm(file)).toFixed(4)),
        };
      });
    if (!samples.length) {
      return {
        status: "failed",
        engine: "interactive-cast-perceptual-pgm",
        warning: "Nessun frame campione estratto dal segmento generato.",
      };
    }
    const average = samples.reduce((sum, item) => sum + item.similarity, 0) / samples.length;
    const minimum = Math.min(...samples.map((item) => item.similarity));
    const driftFrames = samples.filter((item) => item.similarity < threshold).map((item) => item.index);
    return {
      status: driftFrames.length ? "drift-detected" : "passed",
      engine: "interactive-cast-perceptual-pgm",
      threshold,
      averageSimilarity: Number(average.toFixed(4)),
      minSimilarity: Number(minimum.toFixed(4)),
      sampledFrames: samples.length,
      driftFrames,
      reference: {
        source: referenceFrame?.relativePath || segment?.sourceClipRelativePath || segment?.relativePath || null,
        file: referencePgm,
        relativePath: `identity/${segmentId}/reference.pgm`,
      },
      samples,
      warning: driftFrames.length
        ? "Possibile identity drift: controlla volto, capelli, outfit e camera nel segmento replacement."
        : null,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      status: "failed",
      engine: "interactive-cast-perceptual-pgm",
      error: error.message,
      warning: "Identity check locale fallito: verifica FFmpeg e i file segmento/reference.",
      checkedAt: new Date().toISOString(),
    };
  }
}
