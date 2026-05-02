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
```

Receipts are written to `.trustlog/` by default:

- timestamped `.json`
- timestamped `.md`
- `latest.json`
- `latest.md`

## Why

AI agents are useful, but people get nervous when they cannot tell what happened. Trust Log gives humans a simple receipt: what ran, what changed, what looked risky, and what was redacted — without exposing private chain-of-thought.

## Monetization Direction

Trust Log should stay local-first and useful for free. Paid cloud features can add hosted receipts, team audit history, private share links, API ingestion, and compliance retention. See `docs/stripe-integration-reference.md`.
