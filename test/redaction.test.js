import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('help prints usage', () => {
  const out = execFileSync('node', ['src/cli.js', '--help'], { encoding: 'utf8' });
  assert.match(out, /Trust Log/);
  assert.match(out, /trustlog run/);
});
