import fs from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';

const signature = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex');
const crcTable = Array.from({ length: 256 }, (_, i) => {
  for (let bit = 0; bit < 8; bit++) i = (i >>> 1) ^ ((i & 1) ? 0xedb88320 : 0);
  return i >>> 0;
});
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function inspectNsis(bytes) {
  if (bytes.length < 512 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid NSIS executable');
  const pe = bytes.readUInt32LE(60);
  if (pe + 24 > bytes.length || bytes.readUInt32LE(pe) !== 0x4550) throw new Error('Invalid PE header');
  const count = bytes.readUInt16LE(pe + 6), optionalSize = bytes.readUInt16LE(pe + 20);
  const sections = pe + 24 + optionalSize;
  if (sections + count * 40 > bytes.length) throw new Error('Truncated PE sections');
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const section = sections + i * 40;
    offset = Math.max(offset, bytes.readUInt32LE(section + 16) + bytes.readUInt32LE(section + 20));
  }
  if (offset < 512 || offset % 512 || offset + 32 > bytes.length || !bytes.subarray(offset + 4, offset + 20).equals(signature)) throw new Error('Unsupported NSIS layout');
  const flags = bytes.readUInt32LE(offset), length = bytes.readUInt32LE(offset + 24);
  if ((flags & ~15) || (flags & 4)) throw new Error('NSIS integrity checking must remain enabled');
  const end = offset + length;
  if (length < 32 || end > bytes.length) throw new Error('Truncated NSIS payload');
  const storedCrc = bytes.readUInt32LE(end - 4), actualCrc = crc32(bytes.subarray(512, end - 4));
  return { offset, end, flags, storedCrc, actualCrc, crcValid: storedCrc === actualCrc, uninstaller: Boolean(flags & 1) };
}

function iconPatches(block, stubSize) {
  const patches = [];
  let cursor = 0;
  while (cursor + 4 <= block.length) {
    const size = block.readUInt32LE(cursor); cursor += 4;
    if (!size) return patches.length && cursor === block.length ? patches : null;
    if (cursor + 4 + size > block.length) return null;
    const offset = block.readUInt32LE(cursor); cursor += 4;
    if (offset < 512 || offset + size > stubSize) return null;
    patches.push({ offset, bytes: block.subarray(cursor, cursor + size) }); cursor += size;
  }
  return null;
}

/** Reproduce NSIS WriteUninstaller, including the PE icon patches omitted by
 * electron-builder 26.15.3's macOS UninstallerReader. Never rewrite/bypass CRC.
 * Upstream semantics: kichik/nsis Source/exehead/exec.c EW_WRITEUNINSTALLER. */
export function reconstructNsisUninstaller(container) {
  const outer = inspectNsis(container);
  if (!outer.crcValid || outer.uninstaller) throw new Error('Invalid uninstaller-generation container CRC');
  const blocks = [];
  for (let cursor = outer.offset + 28; cursor < outer.end - 4;) {
    if (cursor + 4 > outer.end - 4) throw new Error('Truncated NSIS block length');
    const packed = container.readUInt32LE(cursor); cursor += 4;
    const size = packed & 0x7fffffff;
    if (!size || cursor + size > outer.end - 4) throw new Error('Truncated NSIS data block');
    const raw = container.subarray(cursor, cursor + size); cursor += size;
    blocks.push(packed & 0x80000000 ? inflateRawSync(raw, { maxOutputLength: 32 * 1024 * 1024 }) : raw);
  }
  const inner = blocks.map((block, index) => ({ block, index })).filter(({ block }) => block.length >= 32 && block.subarray(4, 20).equals(signature));
  if (inner.length !== 1) throw new Error('Expected exactly one embedded uninstaller');
  const { block, index } = inner[0];
  if (!(block.readUInt32LE(0) & 1) || block.readUInt32LE(24) !== block.length) throw new Error('Invalid embedded uninstaller header');
  const stub = Buffer.from(container.subarray(0, outer.offset));
  const patches = index ? iconPatches(blocks[index - 1], stub.length) : null;
  if (patches) for (const patch of patches) patch.bytes.copy(stub, patch.offset);
  const output = Buffer.concat([stub, block]);
  const result = inspectNsis(output);
  if (!result.crcValid || !result.uninstaller) throw new Error('Reconstructed uninstaller CRC mismatch; unsupported NSIS format');
  return { output, patchesApplied: patches?.length || 0, integrity: result };
}

export async function writeNsisUninstaller(installerPath, uninstallerPath) {
  const { output, patchesApplied, integrity } = reconstructNsisUninstaller(await fs.readFile(installerPath));
  await fs.writeFile(uninstallerPath, output);
  console.log(`  • verified NSIS uninstaller CRC; applied ${patchesApplied} PE resource patches (${integrity.actualCrc.toString(16)})`);
}
