// Drawings, kept on this machine once they have been fetched.
//
// A sheet is immutable: a revised drawing is a new upload with a new id, so a
// file id plus a render timestamp names one exact set of bytes forever. That
// makes an on-disk cache trivially correct and worth a great deal here — a 9 MB
// sheet over a slow link is a twenty-second wait the first time and nothing at
// all after it, across restarts, which no browser cache can promise.
//
// Kept under the app's own data directory and namespaced by server origin, so
// two workspaces cannot see each other's drawings and uninstalling takes the
// lot with it.

const { promises: fs } = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");

/** A file name that cannot escape the cache directory whatever the key says. */
const safeName = (key) => createHash("sha256").update(key).digest("hex");

class DrawingCache {
  constructor(root) {
    this.root = root;
    this.ready = fs.mkdir(root, { recursive: true }).catch(() => { /* checked on use */ });
  }

  async get(key) {
    await this.ready;
    try {
      return await fs.readFile(path.join(this.root, safeName(key)));
    } catch {
      return null;
    }
  }

  async set(key, bytes) {
    await this.ready;
    const file = path.join(this.root, safeName(key));
    // Written aside and renamed: a write interrupted by a quit must not leave a
    // half a drawing behind for the next launch to read as a whole one.
    const tmp = `${file}.${process.pid}.part`;
    try {
      await fs.writeFile(tmp, bytes);
      await fs.rename(tmp, file);
    } catch {
      await fs.unlink(tmp).catch(() => { /* nothing to clean up */ });
    }
  }

  /** Total bytes held, for the settings screen — people want to know. */
  async size() {
    await this.ready;
    let total = 0;
    for (const name of await fs.readdir(this.root).catch(() => [])) {
      const s = await fs.stat(path.join(this.root, name)).catch(() => null);
      if (s?.isFile()) total += s.size;
    }
    return total;
  }

  async clear() {
    await this.ready;
    await fs.rm(this.root, { recursive: true, force: true });
    this.ready = fs.mkdir(this.root, { recursive: true });
  }
}

module.exports = { DrawingCache };
