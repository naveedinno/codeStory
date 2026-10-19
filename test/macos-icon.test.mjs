import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';

// The installer's real icon lives at macos/CodeStoryApp/icons/icon.png, which is
// gitignored — a worktree, a fresh clone, or CI has no copy of it. What is under
// test here is scripts/build-icns.mjs, and that only cares that the iconset holds
// correctly sized PNGs, so the test draws its own source rather than depending on
// an untracked file.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let remainder = n;
  for (let bit = 0; bit < 8; bit += 1) {
    remainder = remainder & 1 ? 0xedb88320 ^ (remainder >>> 1) : remainder >>> 1;
  }
  return remainder >>> 0;
});

function crc32(buffer) {
  let remainder = 0xffffffff;
  for (const byte of buffer) {
    remainder = crcTable[(remainder ^ byte) & 0xff] ^ (remainder >>> 8);
  }
  return (remainder ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function solidPng(size) {
  const stride = size * 4 + 1; // one filter byte per row, then RGBA pixels
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y += 1) {
    const row = y * stride;
    for (let x = 0; x < size; x += 1) {
      raw.writeUInt32BE(0x1f6fffff, row + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

test('macOS updater closes and relaunches an already-running installed app', () => {
  const installer = fs.readFileSync('scripts/install-macos-app.sh', 'utf8');
  assert.match(installer, /pgrep -f -x "\$INSTALLED_EXECUTABLE"/);
  assert.match(installer, /tell application id "local\.codestory\.desktop" to quit/);
  assert.match(installer, /pkill -TERM -f -x "\$_server_command"/);
  assert.match(installer, /never kill an arbitrary owner/);
  assert.match(installer, /if \(\( RELAUNCH_APP \)\); then\s+\/usr\/bin\/open "\$APP_PATH"/);
});

test('the macOS installer replaces the pre-rename diffStory app instead of keeping it beside codeStory', () => {
  const installer = fs.readFileSync('scripts/install-macos-app.sh', 'utf8');
  assert.match(installer, /APP_PATH="\$INSTALL_DIR\/codeStory\.app"/);
  assert.match(installer, /LEGACY_APPS=\("\$INSTALL_DIR\/diffStory\.app" "\/Applications\/diffStory\.app"\)/);
  assert.match(installer, /LEGACY_APP_ID="local\.diffstory\.desktop"/);
  // A running old app is closed first, the same way the current one is.
  assert.match(installer, /tell application id \\"\$LEGACY_APP_ID\\" to quit/);
  // Only an app that really is the old one is removed, and only after the new
  // one is in place.
  const installed = installer.indexOf('/usr/bin/ditto "$BUILD_APP" "$APP_PATH"');
  const removed = installer.indexOf('/bin/rm -rf "$_legacy_app"');
  assert.ok(installed > 0 && removed > installed, 'the old app is removed after the new one is installed');
  assert.match(installer, /PlistBuddy -c 'Print :CFBundleIdentifier' "\$_legacy_app\/Contents\/Info\.plist"/);
  assert.match(installer, /Removed the old diffStory app at \$_legacy_app; codeStory replaces it\./);
});

// Cargo cannot build the app offline, so the lookup order is pinned in source:
// a checkout path set by whoever builds the app wins under its new name, then
// under the name it had before the codeStory rename, then the crate's checkout.
test('the macOS build takes CODESTORY_PROJECT_PATH, then the pre-rename DIFFSTORY_PROJECT_PATH', () => {
  const build = fs.readFileSync('macos/CodeStoryApp/build.rs', 'utf8');
  const main = fs.readFileSync('macos/CodeStoryApp/src/main.rs', 'utf8');
  assert.match(build, /const NAMES: \[&str; 2\] = \["CODESTORY_PROJECT_PATH", "DIFFSTORY_PROJECT_PATH"\];/);
  assert.match(build, /\.find_map\(std::env::var_os\)/, 'the first name that is set wins');
  assert.match(build, /println!\("cargo:rerun-if-env-changed=\{name\}"\);/, 'changing either name rebuilds');
  assert.match(build, /let checkout = manifest\.parent\(\)\.and_then\(Path::parent\)\.unwrap\(\);/);
  assert.match(build, /\.map_or_else\(\|\| checkout\.to_path_buf\(\), PathBuf::from\)/, 'otherwise the checkout');
  assert.match(build, /"cargo:rustc-env=CODESTORY_PROJECT_PATH=\{\}",\s*project_path\(&manifest\)\.display\(\)/);
  assert.match(main, /const PROJECT_PATH: &str = env!\("CODESTORY_PROJECT_PATH"\);/);
});

test('macOS installer builds an iconutil-readable ICNS without iconutil packing', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codestory-icon-test-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const iconset = path.join(tempDir, 'codeStory.iconset');
  const output = path.join(tempDir, 'codeStory.icns');
  const extracted = path.join(tempDir, 'extracted.iconset');
  const source = path.join(tempDir, 'icon.png');
  fs.mkdirSync(iconset);
  fs.writeFileSync(source, solidPng(1024));

  for (const size of [16, 32, 128, 256, 512]) {
    for (const [name, pixels] of [
      [`icon_${size}x${size}.png`, size],
      [`icon_${size}x${size}@2x.png`, size * 2],
    ]) {
      const scaled = path.join(iconset, name);
      execFileSync('/usr/bin/sips', [
        '-z', String(pixels), String(pixels), source, '--out', scaled,
      ], { stdio: 'pipe' });
      // sips exits 0 and only warns when it cannot read its input, so without
      // this check an unusable source surfaces as a confusing ENOENT deep inside
      // build-icns.mjs instead of failing here.
      assert.ok(fs.existsSync(scaled), `sips produced ${name} from the source icon`);
    }
  }

  execFileSync(process.execPath, ['scripts/build-icns.mjs', iconset, output]);
  const icns = fs.readFileSync(output);
  assert.equal(icns.subarray(0, 4).toString('ascii'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);

  execFileSync('/usr/bin/iconutil', ['-c', 'iconset', output, '-o', extracted]);
  assert.ok(fs.existsSync(path.join(extracted, 'icon_512x512@2x.png')));
});
