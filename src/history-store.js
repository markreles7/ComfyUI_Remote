import fs from "node:fs";
import path from "node:path";

export class HistoryStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.items = this.#read();
  }

  #read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return [];
    }
  }

  #write() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.items, null, 2));
    fs.renameSync(temp, this.file);
  }

  list() {
    return [...this.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id) {
    return this.items.find((item) => item.id === id);
  }

  add(item) {
    this.items.push(item);
    this.#write();
    return item;
  }

  update(id, patch, { persist = true } = {}) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    this.items[index] = { ...this.items[index], ...patch };
    if (persist) this.#write();
    return this.items[index];
  }

  updateMany(ids, patch) {
    const selected = new Set(ids);
    const updated = [];
    this.items = this.items.map((item) => {
      if (!selected.has(item.id)) return item;
      const next = { ...item, ...patch };
      updated.push(next);
      return next;
    });
    if (updated.length) this.#write();
    return updated;
  }

  patchMany(patches) {
    const patchMap = patches instanceof Map ? patches : new Map(Object.entries(patches || {}));
    if (!patchMap.size) return [];
    const updated = [];
    this.items = this.items.map((item) => {
      const patch = patchMap.get(item.id);
      if (!patch) return item;
      const next = { ...item, ...patch };
      updated.push(next);
      return next;
    });
    if (updated.length) this.#write();
    return updated;
  }

  delete(id) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const [removed] = this.items.splice(index, 1);
    this.#write();
    return removed;
  }

  deleteMany(ids) {
    const selected = new Set(ids);
    if (!selected.size) return [];
    const removed = [];
    this.items = this.items.filter((item) => {
      if (!selected.has(item.id)) return true;
      removed.push(item);
      return false;
    });
    if (removed.length) this.#write();
    return removed;
  }
}
