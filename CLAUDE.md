# RedReplier CLI

Command line interface for RedReplier, which watches Reddit, Hacker News, X and Bluesky for keywords and surfaces lead mentions. Bins: `redreplier`, `rr`.

## Setup

1. Get an API token from https://redreplier.com/api-tokens
2. `redreplier login`, or set `REDREPLIER_API_TOKEN`
3. Talks to one host only: `https://ai.redreplier.com/ai-app/api/v1`

## Architecture

- `src/cli.ts` holds the shebang, program assembly, global flags and dispatch
- `src/core/` holds config, credentials, http, output, table, poll and friends. Byte-identical in all three CLI repos, synced with `npm run sync-core`
- `src/api/` has one typed method per REST endpoint
- `src/commands/` has one file per top-level noun, lazy-imported from the action handler
- No LLM call, no prompt, no provider key here; `site analyze` and `mention explain` post to the API and the model runs behind it

## Build & Run

```bash
npm install
npm run build        # tsdown bundles src/cli.ts to dist/cli.js
node dist/cli.js --version
npm run typecheck && npm test
```

Ship compiled JavaScript: `bin` points at `dist/cli.js` and never at `src/`. Pointing it at a `.ts` file needs Bun on the user's machine, and `npx @redreplier/cli` must run on Node alone. Bun is a build-time tool for `npm run compile` only. Releases are tagged `v1.2.3`, with the `v`.
