import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { crc32 as nativeCrc32, deflateRawSync } from 'node:zlib';
import { crc32, inspectNsis, reconstructNsisUninstaller } from '../nsis-uninstaller.mjs';

const signature = Buffer.from('efbeadde4e756c6c736f6674496e7374', 'hex');
function stub() {
  const out = Buffer.alloc(1024);
  out.write('MZ'); out.writeUInt32LE(64, 60); out.writeUInt32LE(0x4550, 64);
  out.writeUInt16LE(1, 70); out.writeUInt16LE(224, 84);
  out.write('.rsrc', 312); out.writeUInt32LE(512, 328); out.writeUInt32LE(512, 332);
  return out;
}
function image(stubBytes, blocks, flags) {
  const body = Buffer.concat(blocks.map(data => {
    const packed = deflateRawSync(data), length = Buffer.alloc(4);
    length.writeUInt32LE((packed.length | 0x80000000) >>> 0); return Buffer.concat([length, packed]);
  }));
  const header = Buffer.alloc(28); header.writeUInt32LE(flags); signature.copy(header, 4);
  header.writeUInt32LE(16, 20); header.writeUInt32LE(28 + body.length + 4, 24);
  const executable = Buffer.concat([stubBytes, header, body, Buffer.alloc(4)]);
  executable.writeUInt32LE(nativeCrc32(executable.subarray(512, -4)), executable.length - 4);
  return executable;
}
function fixture() {
  const original = stub(), patched = Buffer.from(original);
  patched.write('UNINSTALL ICON', 800);
  const inner = image(patched, [Buffer.from('uninstall script')], 9).subarray(1024);
  const patches = Buffer.alloc(8 + 14 + 4);
  patches.writeUInt32LE(14); patches.writeUInt32LE(800, 4); Buffer.from('UNINSTALL ICON').copy(patches, 8);
  return { original, patched, inner, patches, container: image(original, [Buffer.from('install script'), patches, inner], 8) };
}

test('CRC agrees with the NSIS oracle and detects payload corruption', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  const { container } = fixture(); assert.equal(inspectNsis(container).crcValid, true);
  const corrupt = Buffer.from(container); corrupt[800] ^= 1;
  assert.equal(inspectNsis(corrupt).crcValid, false);
  assert.throws(() => reconstructNsisUninstaller(corrupt), /container CRC/);
});

test('WriteUninstaller applies resource patches and retains the ORIGINAL embedded CRC', () => {
  const { original, patched, inner, container } = fixture();
  assert.equal(inspectNsis(Buffer.concat([original, inner])).crcValid, false, 'old macOS reader reproduces the reported error');
  const result = reconstructNsisUninstaller(container);
  assert.equal(result.patchesApplied, 1);
  assert.deepEqual(result.output, Buffer.concat([patched, inner]));
  assert.equal(inspectNsis(result.output).crcValid, true);
  assert.equal(inspectNsis(result.output).flags, 9, 'uninstall + forced CRC');
});

test('unknown patches and disabled integrity checks fail instead of rewriting CRC', () => {
  const { original, inner, patches } = fixture();
  const invalid = Buffer.from(patches); invalid.writeUInt32LE(2000, 4);
  assert.throws(() => reconstructNsisUninstaller(image(original, [invalid, inner], 8)), /CRC mismatch/);
  assert.throws(() => inspectNsis(image(original, [inner], 4)), /integrity checking must remain enabled/);
  assert.throws(() => reconstructNsisUninstaller(image(original, [patches, inner, inner], 8)), /exactly one/);
});

test('real makensis fixture reproduces the omitted icon-patch failure', { skip: !process.env.YACHIYO_NSIS_FIXTURE }, () => {
  const result = reconstructNsisUninstaller(fs.readFileSync(process.env.YACHIYO_NSIS_FIXTURE));
  assert.ok(result.patchesApplied > 0); assert.ok(result.integrity.crcValid);
});
