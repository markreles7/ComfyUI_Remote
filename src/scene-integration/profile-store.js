import fs from "node:fs";
import path from "node:path";
import { assertSceneProfile, migrateSceneProfile } from "./schema.js";

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, data);
  fs.renameSync(temp, file);
}

export class SceneProfileStore {
  constructor(directory) {
    this.directory = directory;
    fs.mkdirSync(directory, { recursive: true });
  }

  file(id) {
    if (!/^[a-zA-Z0-9-]+$/.test(String(id))) throw new Error("ID profilo non valido.");
    return path.join(this.directory, `${id}.json`);
  }

  get(id) {
    try {
      return migrateSceneProfile(JSON.parse(fs.readFileSync(this.file(id), "utf8")));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  list() {
    return fs.readdirSync(this.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        try {
          return migrateSceneProfile(JSON.parse(
            fs.readFileSync(path.join(this.directory, entry.name), "utf8"),
          ));
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  }

  save(profile) {
    const validated = assertSceneProfile(profile);
    if (!validated.id) throw new Error("Il profilo deve avere un ID.");
    atomicWrite(this.file(validated.id), JSON.stringify(validated, null, 2));
    return validated;
  }

  import(raw, id) {
    const profile = migrateSceneProfile({ ...raw, id });
    return this.save(profile);
  }
}
