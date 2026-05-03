import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CLI = path.resolve('src/cli.js');

test('help prints usage', () => {
  const out = execFileSync('node', [CLI, '--help'], { encoding: 'utf8' });
  assert.match(out, /Trust Log/);
  assert.match(out, /trustlog run/);
  assert.match(out, /trustlog verify/);
});

test('redacts command argv, output secrets, and thinking blocks in receipts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trustlog-'));
  const secret = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
  const result = spawnSync('node', [CLI, 'run', '--out', dir, '--no-git', '--', 'node', '-e', `console.log(process.argv[1]); console.error('<think>hidden</think>');`, `TOKEN=${secret}`], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const receiptText = readFileSync(path.join(dir, 'latest.json'), 'utf8');
  assert.doesNotMatch(receiptText, new RegExp(secret));
  assert.doesNotMatch(receiptText, /<think>hidden<\/think>/);

  const receipt = JSON.parse(receiptText);
  assert.deepEqual(receipt.command.argv.at(-1), 'TOKEN=[REDACTED]');
  assert.match(receipt.output.stdoutPreview, /TOKEN=\[REDACTED\]/);
  assert.match(receipt.output.stderrPreview, /\[thinking stripped\]/);
  assert(receipt.risks.some((risk) => risk.type === 'secret_redacted'));
  assert(receipt.risks.some((risk) => risk.type === 'thinking_stripped'));

  const verify = spawnSync('node', [CLI, 'verify', path.join(dir, 'latest.json')], { encoding: 'utf8' });
  assert.equal(verify.status, 0, verify.stderr);
  assert.match(verify.stdout, /verified/);
});

test('verify fails receipts that still contain obvious secrets', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'trustlog-bad-'));
  const file = path.join(dir, 'bad.json');
  writeFileSync(file, JSON.stringify({
    schema: 'trustlog.receipt.v1',
    id: 'bad',
    createdAt: new Date().toISOString(),
    exitCode: 0,
    command: {
      display: 'node -e ghp_abcdefghijklmnopqrstuvwxyz123456',
      argv: ['node', 'ghp_abcdefghijklmnopqrstuvwxyz123456'],
      sha256: 'a'.repeat(64)
    },
    output: { stdoutPreview: '', stderrPreview: '', stdoutBytes: 0, stderrBytes: 0, redactions: [] }
  }));

  const result = spawnSync('node', [CLI, 'verify', file], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /verification failed/);
  assert.match(result.stderr, /likely secret/);
});
