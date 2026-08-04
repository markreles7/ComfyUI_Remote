import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}

export function virtualInfluencerCacheKey(profile, type, raw = {}) {
  const payload = {
    type,
    influencerId: profile.id,
    versionId: raw.versionId || profile.currentVersionId,
    profileUpdatedAt: profile.updatedAt,
    references: (profile.referenceAssets || []).map((asset) => ({
      id: asset.id,
      status: asset.status,
      canonical: asset.canonical,
      sha256: asset.sha256,
      updatedAt: asset.updatedAt,
    })),
    input: raw,
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable(payload))).digest("hex");
}

export class VirtualInfluencerCache {
  constructor(directory, { maxEntries = 120 } = {}) {
    this.directory = directory;
    this.indexFile = path.join(directory, "index.json");
    this.maxEntries = maxEntries;
    this.index = readJson(this.indexFile, {});
  }

  fileFor(key) {
    return path.join(this.directory, `${key}.json`);
  }

  get(key) {
    const entry = this.index[key];
    if (!entry) return null;
    const value = readJson(this.fileFor(key), null);
    if (!value) {
      delete this.index[key];
      this.save();
      return null;
    }
    entry.hits = Number(entry.hits || 0) + 1;
    entry.lastHitAt = new Date().toISOString();
    this.save();
    return value;
  }

  put(key, value, metadata = {}) {
    const timestamp = new Date().toISOString();
    writeJson(this.fileFor(key), {
      ...value,
      cacheKey: key,
      cachedAt: timestamp,
    });
    this.index[key] = {
      key,
      type: metadata.type || value.type || "unknown",
      influencerId: metadata.influencerId || value.profileId || null,
      createdAt: this.index[key]?.createdAt || timestamp,
      updatedAt: timestamp,
      hits: this.index[key]?.hits || 0,
    };
    this.prune();
    this.save();
    return this.index[key];
  }

  invalidateByInfluencer(influencerId) {
    let removed = 0;
    for (const [key, entry] of Object.entries(this.index)) {
      if (entry.influencerId !== influencerId) continue;
      try {
        fs.rmSync(this.fileFor(key), { force: true });
      } catch {
        // Cache invalidation is best-effort; stale index entries are removed below.
      }
      delete this.index[key];
      removed += 1;
    }
    this.save();
    return removed;
  }

  prune(limit = this.maxEntries) {
    const entries = Object.values(this.index)
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    for (const entry of entries.slice(limit)) {
      try {
        fs.rmSync(this.fileFor(entry.key), { force: true });
      } catch {
        // Missing cache files are harmless.
      }
      delete this.index[entry.key];
    }
  }

  stats() {
    const entries = Object.values(this.index);
    return {
      entries: entries.length,
      maxEntries: this.maxEntries,
      hits: entries.reduce((sum, entry) => sum + Number(entry.hits || 0), 0),
      byType: entries.reduce((acc, entry) => {
        acc[entry.type] = (acc[entry.type] || 0) + 1;
        return acc;
      }, {}),
    };
  }

  save() {
    writeJson(this.indexFile, this.index);
  }
}
