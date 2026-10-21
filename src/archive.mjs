import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';

const hash = data => createHash('sha256').update(data).digest('hex');
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function snapshotTree(root) {
  const entries = [];
  function visit(target, name) {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new Error(`Unsupported archive entry: ${target}`);
    const directory = stat.isDirectory();
    entries.push({ name: name + (directory ? '/' : ''), directory, size: directory ? 0 : stat.size,
      mode: stat.mode, mtimeMs: stat.mtimeMs, sha256: directory ? null : hash(fs.readFileSync(target)) });
    if (directory) for (const child of fs.readdirSync(target).sort()) visit(path.join(target, child), `${name}/${child}`);
  }
  visit(root, '.trellis');
  return entries;
}

export function assertSnapshot(root, expected) {
  if (JSON.stringify(snapshotTree(root)) !== JSON.stringify(expected)) throw new Error('The .trellis source changed; retained original directory. Re-run migration.');
}

// Standard ZIP (UTF-8 names, raw DEFLATE), written one file at a time. Refuse
// ZIP64-sized inputs before mutation instead of producing a truncated backup.
export function createArchive(root, file, entries) {
  if (entries.length >= 65535 || entries.some(e => e.size >= 0xffffffff)) throw new Error('ZIP64 is required for this tree; retain .trellis and archive it externally.');
  assertSnapshot(root, entries);
  const fd = fs.openSync(file, 'wx');
  let offset = 0;
  const central = [];
  const write = data => {
    if (offset + data.length >= 0xffffffff) throw new Error('Archive exceeds standard ZIP size; original .trellis retained.');
    let written = 0;
    while (written < data.length) written += fs.writeSync(fd, data, written, data.length - written);
    offset += data.length;
  };
  try {
    for (const entry of entries) {
      const name = Buffer.from(entry.name);
      if (name.length > 65535) throw new Error(`ZIP path too long: ${entry.name}`);
      const data = entry.directory ? Buffer.alloc(0) : fs.readFileSync(path.join(path.dirname(root), entry.name));
      if (!entry.directory && hash(data) !== entry.sha256) throw new Error(`Source changed during backup: ${entry.name}`);
      const packed = entry.directory ? data : deflateRawSync(data);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
      header.writeUInt16LE(entry.directory ? 0 : 8, 8);
      const date = new Date(entry.mtimeMs), year = Math.max(1980, Math.min(2107, date.getFullYear()));
      header.writeUInt16LE((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), 10);
      header.writeUInt16LE(((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(), 12);
      header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(packed.length, 18);
      header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50); record.writeUInt16LE(0x0314, 4);
      header.copy(record, 6, 4, 28);
      record.writeUInt32LE(((entry.mode & 0xffff) * 65536 + (entry.directory ? 16 : 0)) >>> 0, 38);
      record.writeUInt32LE(offset, 42);
      central.push(record, name);
      write(header); write(name); write(packed);
    }
    const start = offset;
    for (const data of central) write(data);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - start, 12); end.writeUInt32LE(start, 16);
    write(end); fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  verifyArchive(file, entries);
  assertSnapshot(root, entries);
}

export function verifyArchive(file, entries, restoreRoot) {
  const fd = fs.openSync(file, 'r');
  const read = (size, at) => {
    const data = Buffer.alloc(size);
    let n = 0;
    while (n < size) { const got = fs.readSync(fd, data, n, size - n, at + n); if (!got) throw new Error('Truncated ZIP backup'); n += got; }
    return data;
  };
  try {
    const size = fs.fstatSync(fd).size;
    const end = read(22, size - 22);
    if (end.readUInt32LE(0) !== 0x06054b50 || end.readUInt16LE(10) !== entries.length) throw new Error('Invalid ZIP directory');
    let pos = end.readUInt32LE(16);
    for (const entry of entries) {
      const record = read(46, pos);
      if (record.readUInt32LE(0) !== 0x02014b50) throw new Error('Invalid ZIP entry');
      const name = read(record.readUInt16LE(28), pos + 46).toString('utf8');
      if (name !== entry.name || record.readUInt32LE(24) !== entry.size) throw new Error('ZIP manifest mismatch');
      const at = record.readUInt32LE(42), local = read(30, at);
      if (local.readUInt32LE(0) !== 0x04034b50 || !local.subarray(4, 28).equals(record.subarray(6, 30))) throw new Error('ZIP header mismatch');
      if (read(local.readUInt16LE(26), at + 30).toString('utf8') !== name) throw new Error('ZIP filename mismatch');
      const packed = read(record.readUInt32LE(20), at + 30 + local.readUInt16LE(26) + local.readUInt16LE(28));
      const data = entry.directory ? packed : inflateRawSync(packed, { maxOutputLength: Math.max(1, entry.size) });
      if (data.length !== entry.size || crc32(data) !== record.readUInt32LE(16) || (!entry.directory && hash(data) !== entry.sha256)) throw new Error(`ZIP verification failed: ${name}`);
      if (restoreRoot) {
        const target = path.resolve(restoreRoot, name);
        if (!target.startsWith(path.resolve(restoreRoot) + path.sep) || !name.startsWith('.trellis/')) throw new Error('Unsafe restore path');
        let cursor = path.resolve(restoreRoot);
        for (const part of path.relative(cursor, target).split(path.sep)) {
          cursor = path.join(cursor, part);
          try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error(`Symlink in restore path: ${cursor}`); }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
        }
        // Recovery only recreates missing entries; never clobber concurrent edits.
        if (!fs.existsSync(target)) {
          if (entry.directory) fs.mkdirSync(target, { recursive: true });
          else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, data, { flag: 'wx', mode: entry.mode }); fs.utimesSync(target, new Date(entry.mtimeMs), new Date(entry.mtimeMs)); }
        }
      }
      pos += 46 + record.readUInt16LE(28) + record.readUInt16LE(30) + record.readUInt16LE(32);
    }
    if (pos !== size - 22) throw new Error('Unexpected ZIP directory length');
  } finally { fs.closeSync(fd); }
}
