export function createFs() {
  const fsa = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  let root = null;
  const parts = (rel) => rel.split('\\').filter(Boolean);
  async function dirHandle(rel, create = false) {
    let h = root; for (const p of parts(rel)) h = await h.getDirectoryHandle(p, { create }); return h;
  }
  async function fileHandle(rel, create = false) {
    const ps = parts(rel); const name = ps.pop(); const d = await dirHandle(ps.join('\\'), create);
    return d.getFileHandle(name, { create });
  }
  return {
    mode: fsa ? 'fsa' : 'fallback',
    get rootName() { return root ? root.name : null; },
    async pickRoot() { root = await window.showDirectoryPicker({ mode: 'readwrite' }); },
    async readText(rel) { const f = await (await fileHandle(rel)).getFile(); return f.text(); },
    // probe: also open each file (metadata only) and drop the ones that fail - a dangling symlink is listed by the
    // directory but cannot be opened, and must not be reported as a present game.
    async listDir(rel, { probe = false } = {}) {
      const d = await dirHandle(rel); const files = [], dirs = [];
      for await (const [name, h] of d.entries()) {
        if (h.kind !== 'file') { dirs.push(name); continue; }
        if (probe) { try { await h.getFile(); } catch { continue; } }
        files.push(name);
      }
      return { files, dirs };
    },
    async exists(rel) { try { await fileHandle(rel); return true; } catch { try { await dirHandle(rel); return true; } catch { return false; } } },
    async writeText(rel, text) {
      const h = await fileHandle(rel, true); const w = await h.createWritable();
      await w.write(new TextEncoder().encode(text)); await w.close(); // TextEncoder emits no BOM
    },
    loadRoomViaInput(file) { return file.text(); },
    download(name, text) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
  };
}
