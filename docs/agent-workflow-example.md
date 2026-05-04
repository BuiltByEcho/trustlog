# Agent Workflow Example

This repo dogfoods the BuiltByEcho agent-workflow tools so agents can produce useful evidence without dumping noisy transcripts into chat.

## Workflow

From the repository root:

```bash
npx repo-agent-brief . > AGENT_BRIEF.md
npx @builtbyecho/add-ci . --framework vite --backend none --tier 2 --skip-install --dry-run
npx agent-runlog -- npm test
npx @builtbyecho/trustlog run -- npm test
node src/cli.js verify .trustlog/latest.json
```

Notes:

- `AGENT_BRIEF.md`, `.agent-runs/`, and `.trustlog/` are local artifacts. Keep them out of commits unless you intentionally want to publish a receipt.
- For generic Node CLI repos, pass explicit `--framework`/`--backend` flags to `add-ci --dry-run` so it does not enter interactive prompts.
- Inside this package's own checkout, use `node src/cli.js ...` when validating the local CLI implementation. External users can use `npx @builtbyecho/trustlog ...`.

## Dogfood result, 2026-05-04

- `repo-agent-brief` generated a useful repo orientation and recommended adding `AGENTS.md` plus faster lint/typecheck commands.
- `add-ci --dry-run` previewed a tier-2 CI plan without writing files.
- `agent-runlog -- npm test` captured a passing test run under `.agent-runs/`.
- `trustlog run -- npm test` created a receipt under `.trustlog/`.
- `trustlog verify .trustlog/latest.json` passed when run against the local CLI.

The workflow is useful enough to document, but it exposed one follow-up: `add-ci` should support a first-class `node`/`generic` framework mode for CLI packages instead of requiring a Vite/Next.js choice.
