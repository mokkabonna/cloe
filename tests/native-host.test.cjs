const {test} = require('node:test');
const assert = require('node:assert/strict');
const {existsSync, mkdtempSync, writeFileSync, openSync, closeSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {spawnSync} = require('node:child_process');
const binary = `${__dirname}/../native-host/target/release/cloe-host`;
function frame(body) {
  const payload = Buffer.from(JSON.stringify(body));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length);
  return Buffer.concat([header, payload]);
}
function run(input) {
  // A finite file guarantees EOF, including under process sandbox wrappers.
  const dir = mkdtempSync(join(tmpdir(), 'cloe-test-'));
  let fd;
  try {
    const path = join(dir, 'input');
    writeFileSync(path, input);
    fd = openSync(path, 'r');
    return spawnSync(binary, [], {stdio:[fd, 'pipe', 'pipe'], timeout:5000});
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(dir, {recursive:true, force:true});
  }
}
test('native process rejects invalid schemes over real framing without launching apps',
  {skip: !existsSync(binary)}, () => {
    const result = run(Buffer.concat([
      frame({url:'file:///tmp/cloe-review'}), frame({url:'custom:review'})
    ]));
    assert.equal(result.status, 0);
    let bytes = result.stdout;
    for (let i = 0; i < 2; i++) {
      const length = bytes.readUInt32LE(0);
      const reply = JSON.parse(bytes.subarray(4, length + 4));
      assert.equal(reply.ok, false);
      assert.match(reply.error, /Unsupported URL scheme/);
      bytes = bytes.subarray(length + 4);
    }
    assert.equal(bytes.length, 0);
    const header = Buffer.alloc(4);
    header.writeUInt32LE(65537);
    const oversized = run(header);
    assert.equal(oversized.status, 1);
    assert.match(oversized.stderr.toString(), /Message too large/);
  });
