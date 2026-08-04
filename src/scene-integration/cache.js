import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}

export function sceneCacheKey(buffer, settings) {
  const hash = crypto.createHash("sha256");
  hash.update(buffer);
  hash.update("\0");
  hash.update(JSON.stringify(stable(settings || {})));
  return hash.digest("hex");
}

export class SceneProfileCache {
  constructor(directory) {
    this.directory = directory;
    this.indexFile = path.join(directory, "index.json");
    fs.mkdirSync(directory, { recursive: true });
    this.index = this.#readIndex();
  }

  #readIndex() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexFile, "utf8"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  #saveIndex() {
    atomicWrite(this.indexFile, JSON.stringify(this.index, null, 2));
  }

  get(cacheKey) {
    const entry = this.index[cacheKey];
    if (!entry) return null;
    const file = path.join(this.directory, `${entry.profileId}.json`);
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      delete this.index[cacheKey];
      this.#saveIndex();
      return null;
    }
  }

  put(cacheKey, profile) {
    atomicWrite(
      path.join(this.directory, `${profile.id}.json`),
      JSON.stringify(profile, null, 2),
    );
    this.index[cacheKey] = {
      profileId: profile.id,
      createdAt: profile.createdAt,
    };
    this.#saveIndex();
    return profile;
  }

  invalidate(cacheKey) {
    const entry = this.index[cacheKey];
    if (!entry) return false;
    const file = path.join(this.directory, `${entry.profileId}.json`);
    delete this.index[cacheKey];
    this.#saveIndex();
    try {
      fs.unlinkSync(file);
    } catch {
      // Il file può essere già stato rimosso.
    }
    return true;
  }
}
