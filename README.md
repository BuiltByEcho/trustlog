# Trust Log

Human-readable receipts for agent work.

> Don’t ask humans to blindly trust agents. Give them a Trust Log.

Trust Log wraps commands and produces clean Markdown + JSON receipts with:

- command, duration, exit code, and working directory
- git branch/commit/status scoped to the current project
- changed file list and diff stats when available
- secret redaction for common API keys/tokens
- `<think>...</think>` / reasoning-block stripping
- risk flags for destructive commands, external actions, failures, redactions, and file changes
- receipt verification with `trustlog verify` so CI/agents can reject receipts that still contain likely secrets or thinking blocks
- redacted command argv storage (the raw command is represented by a SHA-256 hash, not leaked in plaintext)

## Install

```bash
npm install -g @builtbyecho/trustlog
```

Local development:

```bash
npm link
```

## Usage

```bash
trustlog run -- npm test
trustlog run -- node script.js
trustlog summarize .trustlog/latest.json
trustlog verify .trustlog/latest.json
```

Receipts are written to `.trustlog/` by default:

- timestamped `.json`
- timestamped `.md`
- `latest.json`
- `latest.md`

## Verify Receipts

Use `trustlog verify` before attaching receipts to pull requests, tickets, or chat handoffs:

```bash
trustlog verify .trustlog/latest.json
```

Verification checks the receipt schema, required fields, command hash, redacted command argv, output previews, and that visible receipt content does not still contain obvious secrets or thinking/reasoning-looking blocks.

## Why

AI agents are useful, but people get nervous when they cannot tell what happened. Trust Log gives humans a simple receipt: what ran, what changed, what looked risky, and what was redacted — without exposing private chain-of-thought.

## Monetization Direction

Trust Log should stay local-first and useful for free. Paid cloud features can add hosted receipts, team audit history, private share links, API ingestion, and compliance retention. See `docs/stripe-integration-reference.md`.
