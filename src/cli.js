#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const VERSION = pkg.version;
const args = process.argv.slice(2);

function usage() {
  console.log(`Trust Log ${VERSION} — human-readable receipts for agent work\n\nUsage:\n  trustlog run [--out DIR] [--no-git] -- <command> [args...]\n  trustlog summarize <receipt.json>\n  trustlog verify <receipt.json>\n  trustlog --help\n\nExamples:\n  trustlog run -- npm test\n  trustlog run --out .trustlog -- node script.js\n  trustlog summarize .trustlog/latest.json\n  trustlog verify .trustlog/latest.json`);
}

function stripThinking(text) {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '[thinking stripped]')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '[thinking stripped]')
    .replace(/```(?:thinking|think|reasoning)[\s\S]*?```/gi, '[thinking block stripped]');
}

const SECRET_PATTERNS = [
  { name: 'Stripe secret key', regex: /sk_(?:live|test)_[A-Za-z0-9_\-]{16,}/g },
  { name: 'Stripe restricted key', regex: /rk_(?:live|test)_[A-Za-z0-9_\-]{16,}/g },
  { name: 'OpenAI API key', regex: /sk-proj-[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9]{32,}/g },
  { name: 'GitHub token', regex: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
  { name: 'JWT', regex: /eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g },
  { name: 'Generic assignment secret', regex: /\b([A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PASSWORD|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*(?!\[REDACTED\])([^\s'\"]{8,})/gi, replacement: '$1=[REDACTED]' }
];

function redact(text) {
  let redacted = stripThinking(String(text ?? ''));
  const findings = new Set();
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.regex.test(redacted)) {
      findings.add(pattern.name);
      pattern.regex.lastIndex = 0;
      redacted = redacted.replace(pattern.regex, pattern.replacement ?? '[REDACTED]');
    }
    pattern.regex.lastIndex = 0;
  }
  return { text: redacted, findings: [...findings] };
}

function hashCommand(command, commandArgs) {
  return createHash('sha256').update([command, ...commandArgs].join('\0')).digest('hex');
}

function redactArgv(argv) {
  return argv.map((part) => redact(part).text);
}

async function git(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.on('error', (error) => resolve({ code: 1, stdout: '', stderr: error.message }));
  });
}

async function gitSnapshot(cwd) {
  const inside = await git(['rev-parse', '--is-inside-work-tree'], cwd);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') return { enabled: false, reason: 'not a git repository' };

  const root = (await git(['rev-parse', '--show-toplevel'], cwd)).stdout.trim();
  const branchResult = await git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  const commitResult = await git(['rev-parse', 'HEAD'], cwd);
  const branch = branchResult.code === 0 ? branchResult.stdout.trim() : 'unknown';
  const commit = commitResult.code === 0 ? commitResult.stdout.trim() : 'unknown';
  // Scope status/diff to the current directory so running Trust Log inside a
  // subproject does not produce a noisy receipt for the entire parent workspace.
  const porcelain = (await git(['status', '--porcelain', '--', '.'], cwd)).stdout;
  const diffStat = (await git(['diff', '--stat', '--', '.'], cwd)).stdout.trim();
  const changedFiles = porcelain.split('\n').filter(Boolean).map((line) => ({ status: line.slice(0, 2).trim(), path: line.slice(3) }));

  return { enabled: true, root, branch, commit, dirty: changedFiles.length > 0, changedFiles, diffStat };
}

function detectRisk({ command, commandArgs, stdout, stderr, exitCode, gitInfo, secretFindings }) {
  const joined = [command, ...commandArgs].join(' ');
  const risks = [];

  if (exitCode !== 0) risks.push({ level: 'medium', type: 'nonzero_exit', message: `Command exited with code ${exitCode}` });
  if (/\b(rm\s+-rf|sudo|chmod\s+777|chown|dd\s+if=|mkfs|diskutil|trash\s+)/.test(joined)) {
    risks.push({ level: 'high', type: 'dangerous_command', message: 'Command includes potentially destructive or elevated operation' });
  }
  if (/\b(curl|wget|ssh|scp|rsync|gh\s+(issue|pr|release|repo)|npm\s+publish|vercel\s+--prod|git\s+push)\b/.test(joined)) {
    risks.push({ level: 'medium', type: 'external_action', message: 'Command may contact external services or publish changes' });
  }
  if (secretFindings.length > 0) risks.push({ level: 'high', type: 'secret_redacted', message: `Redacted possible secrets: ${secretFindings.join(', ')}` });
  if (/<think>|<thinking>|```(?:thinking|think|reasoning)/i.test(stdout + stderr)) {
    risks.push({ level: 'low', type: 'thinking_stripped', message: 'Hidden reasoning/thinking-looking content was stripped from output' });
  }
  if (gitInfo?.enabled && gitInfo.changedFiles?.length > 0) {
    risks.push({ level: 'low', type: 'working_tree_changed', message: `${gitInfo.changedFiles.length} changed/untracked file(s) present after run` });
  }

  return risks;
}

function markdownReceipt(receipt) {
  const risks = receipt.risks.length
    ? receipt.risks.map((r) => `- **${r.level.toUpperCase()}** ${r.type}: ${r.message}`).join('\n')
    : '- No obvious risk flags detected.';
  const files = receipt.git?.enabled && receipt.git.changedFiles.length
    ? receipt.git.changedFiles.map((f) => `- ${f.status || '??'} ${f.path}`).join('\n')
    : '- No changed files detected, or git unavailable.';

  return `# Trust Log Receipt\n\n**ID:** ${receipt.id}\n**Created:** ${receipt.createdAt}\n**Command:** \`${receipt.command.display}\`\n**Exit code:** ${receipt.exitCode}\n**Duration:** ${receipt.durationMs}ms\n**CWD:** \`${receipt.cwd}\`\n\n## Risk Flags\n\n${risks}\n\n## Git\n\n- Enabled: ${receipt.git?.enabled ? 'yes' : 'no'}${receipt.git?.enabled ? `\n- Branch: ${receipt.git.branch}\n- Commit: ${receipt.git.commit}\n- Dirty: ${receipt.git.dirty ? 'yes' : 'no'}` : `\n- Reason: ${receipt.git?.reason ?? 'unknown'}`}\n\n### Changed Files\n\n${files}\n\n${receipt.git?.diffStat ? `### Diff Stat\n\n\`\`\`\n${receipt.git.diffStat}\n\`\`\`\n\n` : ''}## Output Preview\n\n### stdout\n\n\`\`\`\n${receipt.output.stdoutPreview || '(empty)'}\n\`\`\`\n\n### stderr\n\n\`\`\`\n${receipt.output.stderrPreview || '(empty)'}\n\`\`\`\n`;
}

async function runCommand(argv) {
  let outDir = '.trustlog';
  let includeGit = true;
  const sep = argv.indexOf('--');
  const optionArgs = sep === -1 ? argv : argv.slice(0, sep);
  const cmdArgs = sep === -1 ? [] : argv.slice(sep + 1);

  for (let i = 0; i < optionArgs.length; i++) {
    if (optionArgs[i] === '--out') outDir = optionArgs[++i];
    else if (optionArgs[i] === '--no-git') includeGit = false;
    else throw new Error(`Unknown option: ${optionArgs[i]}`);
  }
  if (!cmdArgs.length) throw new Error('Missing command. Use: trustlog run -- <command> [args...]');

  const [command, ...commandArgs] = cmdArgs;
  const cwd = process.cwd();
  const started = Date.now();
  const child = spawn(command, commandArgs, { cwd, stdio: ['inherit', 'pipe', 'pipe'], shell: false });
  let rawStdout = '';
  let rawStderr = '';

  child.stdout.on('data', (d) => { process.stdout.write(d); rawStdout += d; });
  child.stderr.on('data', (d) => { process.stderr.write(d); rawStderr += d; });

  const exitCode = await new Promise((resolve) => {
    child.on('close', resolve);
    child.on('error', (error) => { rawStderr += `\n${error.message}`; resolve(127); });
  });

  const durationMs = Date.now() - started;
  const stdoutRedacted = redact(rawStdout);
  const stderrRedacted = redact(rawStderr);
  const secretFindings = [...new Set([...stdoutRedacted.findings, ...stderrRedacted.findings])];
  const gitInfo = includeGit ? await gitSnapshot(cwd) : { enabled: false, reason: 'disabled with --no-git' };
  const commandDisplay = redact([command, ...commandArgs].join(' '));
  const argvRedacted = redactArgv([command, ...commandArgs]);
  const argvFindings = argvRedacted.flatMap((part) => redact(part).findings);
  const allSecretFindings = [...new Set([...secretFindings, ...commandDisplay.findings, ...argvFindings])];
  const risks = detectRisk({ command, commandArgs, stdout: rawStdout, stderr: rawStderr, exitCode, gitInfo, secretFindings: allSecretFindings });

  const receipt = {
    schema: 'trustlog.receipt.v1',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    cwd,
    command: {
      display: commandDisplay.text,
      argv: argvRedacted,
      sha256: hashCommand(command, commandArgs)
    },
    exitCode,
    durationMs,
    git: gitInfo,
    risks,
    output: {
      stdoutPreview: stdoutRedacted.text.slice(-6000),
      stderrPreview: stderrRedacted.text.slice(-6000),
      stdoutBytes: Buffer.byteLength(rawStdout),
      stderrBytes: Buffer.byteLength(rawStderr),
      redactions: allSecretFindings
    }
  };

  await mkdir(outDir, { recursive: true });
  const stamp = receipt.createdAt.replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `${stamp}-${receipt.id}.json`);
  const mdPath = path.join(outDir, `${stamp}-${receipt.id}.md`);
  await writeFile(jsonPath, JSON.stringify(receipt, null, 2));
  await writeFile(mdPath, markdownReceipt(receipt));
  await writeFile(path.join(outDir, 'latest.json'), JSON.stringify(receipt, null, 2));
  await writeFile(path.join(outDir, 'latest.md'), markdownReceipt(receipt));

  console.error(`\nTrust Log receipt written:\n- ${jsonPath}\n- ${mdPath}`);
  process.exit(exitCode ?? 0);
}

async function summarize(file) {
  if (!file || !existsSync(file)) throw new Error(`Receipt not found: ${file ?? '(missing)'}`);
  const receipt = JSON.parse(await readFile(file, 'utf8'));
  console.log(markdownReceipt(receipt));
}

function verifyReceipt(receipt) {
  const errors = [];
  if (receipt.schema !== 'trustlog.receipt.v1') errors.push('schema is not trustlog.receipt.v1');
  if (!receipt.id) errors.push('missing id');
  if (!receipt.createdAt || Number.isNaN(Date.parse(receipt.createdAt))) errors.push('createdAt is missing or invalid');
  if (typeof receipt.exitCode !== 'number') errors.push('exitCode must be a number');
  if (!receipt.command?.sha256 || !/^[a-f0-9]{64}$/i.test(receipt.command.sha256)) errors.push('command.sha256 is missing or invalid');
  if (!Array.isArray(receipt.command?.argv)) errors.push('command.argv must be an array');
  if (!receipt.output || typeof receipt.output.stdoutPreview !== 'string' || typeof receipt.output.stderrPreview !== 'string') {
    errors.push('output previews are missing');
  }

  const visible = JSON.stringify({ command: receipt.command, output: receipt.output });
  const redacted = redact(visible);
  if (redacted.findings.length > 0) errors.push(`receipt still contains likely secret material: ${redacted.findings.join(', ')}`);
  if (/<think>|<thinking>|```(?:thinking|think|reasoning)/i.test(visible)) errors.push('receipt still contains thinking/reasoning-looking content');
  return errors;
}

async function verify(file) {
  if (!file || !existsSync(file)) throw new Error(`Receipt not found: ${file ?? '(missing)'}`);
  const receipt = JSON.parse(await readFile(file, 'utf8'));
  const errors = verifyReceipt(receipt);
  if (errors.length) {
    console.error('Trust Log receipt verification failed:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log('Trust Log receipt verified: schema, required fields, redaction, and thinking stripping look OK.');
}

try {
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    usage();
  } else if (args[0] === 'run') {
    await runCommand(args.slice(1));
  } else if (args[0] === 'summarize') {
    await summarize(args[1]);
  } else if (args[0] === 'verify') {
    await verify(args[1]);
  } else if (args[0] === '--version' || args[0] === '-v') {
    console.log(VERSION);
  } else {
    throw new Error(`Unknown command: ${args[0]}`);
  }
} catch (error) {
  console.error(`trustlog: ${error.message}`);
  process.exit(1);
}
