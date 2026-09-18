# RedReplier CLI

Watch Reddit, Hacker News, X and Bluesky for your keywords, from your terminal.

`redreplier` talks to the RedReplier REST API and nothing else. It registers the sites you monitor, manages the keywords they listen for, lists and scores the lead mentions those keywords found, explains why a mention scored what it did, and tails new mentions into any script you want to run on them. Everything prints as a table for humans or as one JSON document for `jq`.

Runs on Node 22.12 or newer. Also ships as a standalone binary with no Node requirement.

## Install

```bash
# npm, the usual path
npm install -g @redreplier/cli

# or run it without installing
npx -p @redreplier/cli redreplier --help

# macOS and Linux, standalone binary, no Node required
brew trust RedReplier/tap && brew install RedReplier/tap/redreplier

# or
curl -fsSL https://redreplier.com/install.sh | sh
```

`npx @redreplier/cli` prompts instead of running, because npx resolves a bin named after the unscoped package. Use `npx -p @redreplier/cli redreplier`. There is no unscoped `redreplier` package, so plain `npx redreplier` will not find anything.

Homebrew 7 refuses to load a formula from a third-party tap until you trust it, which is
what `brew trust` does. Skip it and both `brew install` and `brew upgrade` stop with
"Refusing to load formula ... from untrusted tap".

The install script downloads the release archive for your platform, verifies its checksum, and puts the binary in `~/.local/bin`. It never edits your shell rc files; it prints the `export PATH` line for you to add. Override the destination with `REDREPLIER_INSTALL_DIR`.

Both bins run the same program. `rr` is the short one.

## Authentication

Create an API token at <https://redreplier.com/api-tokens> and hand it to `login`:

```bash
redreplier login
```

The command opens the token page, reads the token from a hidden prompt, checks the `redreplier_` prefix locally, verifies it with one `GET /websites`, and writes it to `~/.config/redreplier/credentials.json` at mode 0600. Nothing is written if verification fails.

Token creation is gated behind the `api_access` subscription feature. On the free plan the token page answers with an error instead of a token, which is a plan limit and not a CLI fault. Plans are at <https://redreplier.com/billing>.

For CI, pipe the token in and skip the prompt:

```bash
echo "$RR_TOKEN" | redreplier login --token-stdin --profile ci
```

Or skip `login` entirely and export `REDREPLIER_API_TOKEN`. The CLI reads it on every command.

There is no OAuth or device-code flow yet. There is also no `/me` endpoint on the API, so `whoami` reconstructs your identity from the cheapest authenticated listing and says where each field came from.

`logout` removes the profile from the credentials file. It does not revoke the token; do that in the dashboard.

## Quick start

```
$ redreplier login
  Opening https://redreplier.com/api-tokens in your browser.
  Create a token, then paste it here.

  Token (starts with redreplier_): ****************************

  ✓ Token valid
    profile    default
    sites      2 monitored
    keywords   16 active, 3 pending
    stored in  ~/.config/redreplier/credentials.json (0600)
```

```
$ redreplier site create --url https://acme.com -k "reddit monitoring" -k "lead finder"
  ! No --description given. The server will scrape acme.com and spend one AI
    generation from this month's quota. Continue? [Y/n] y

  ✓ Created ws_4f21…  acme.com
    description  generated (412 chars)
    keywords     2 active, 0 pending
```

```
$ redreplier mention list --bucket HIGH --bucket VERY_HIGH --sort RELEVANCE --limit 5
  SCORE  SOURCE         WHEN     KEYWORD            TITLE
   92    r/SaaS         2h ago   reddit monitoring  How do you track brand mentions on Reddit?
   84    HACKERNEWS     5h ago   social listening   Ask HN: tools for monitoring keywords
   77    r/marketing    9h ago   reddit leads       Best way to find leads without spamming
   71    BLUESKY        1d ago   reddit monitoring  anyone using a reddit alert tool?
   68    TWITTER        1d ago   social listening   looking for a mention tracker

  5 of 213 · open: redreplier mention show <id>
  ℹ REJECTED mentions are hidden unless you pass --status REJECTED.
  ℹ 41 mentions below the site's minimum score are hidden. Add --include-low.
```

## The parts worth the install

**Tail mentions into a script.** `mention tail` is the reason this CLI exists. It polls `GET /mentions?sort=RECENT` on a timer, dedupes on mention id through an LRU of 10,000, and prints each new one the moment it arrives. On an empty poll the interval grows by 1.5x to a 300 s ceiling, and any new mention drops it back to the floor, so an idle workspace costs a handful of requests an hour.

```
$ redreplier mention tail --min-score 70 --exec './notify.sh'
  Tailing new mentions for 2 sites, score ≥ 70, every 60s. Ctrl-C to stop.
  12:04:11   92  r/SaaS       How do you track brand mentions on Reddit?
  12:09:14   78  HACKERNEWS   Ask HN: tools for monitoring keywords
```

`--exec` runs your command once per mention, with the mention as JSON on the child's stdin and the fields in its environment as `RR_ID`, `RR_SCORE`, `RR_URL`, `RR_SOURCE`, `RR_KEYWORD` and `RR_TITLE`. Children run one at a time in arrival order, so a slow notifier cannot fan out. A non-zero exit prints a warning and the tail keeps going. Add `--approve-on-exec-success` and a zero exit sets the mention to `APPROVED`, which turns the tail into a review queue driven by whatever script you already have.

In machine mode the output is newline-delimited JSON, one object per mention:

```bash
redreplier mention tail --json | jq -r 'select(.relevanceScore > 80) | .url'
```

**Read one mention properly.** There is no single-mention GET on the API, so `mention show <id>` pages the list until it finds the id, or goes straight through `POST /mentions/{id}/explain` with `--explain`. Either way you get the thread, the score, the reason it scored that way and the suggested reply in one screen.

```
$ redreplier mention show 8f2c1b0e
  r/SaaS · 2h ago · score 92 (VERY_HIGH) · NEW
  keyword    reddit monitoring
  author     u/throwaway_pm
  url        https://reddit.com/r/SaaS/comments/…

  How do you track brand mentions on Reddit?

  We keep missing threads about us until someone screenshots them in Slack…

  why it scored 92
    Directly asks for the category of tool acme.com sells, in a subreddit
    where self-promotion is tolerated when it answers the question.

  suggested reply
    We built acme for exactly this…

  approve: redreplier mention status 8f2c1b0e APPROVED
```

**Keyword commands that tell you what they cost.** Adding a keyword with no free slot lands it as `PENDING` rather than charging you, and the CLI prints that instead of implying a purchase. `keyword plan --count 25` prices the plan an absolute account-wide total of 25 active keywords would need, and ends by pointing at the web app, because no endpoint changes a plan.

```
$ redreplier keyword plan --count 25
  CURRENT            TARGET
  Starter  $19/mo    Growth  $49/mo   (25 keywords)

  upgrade          yes
  charged now      $23.40   (prorated)
  payment needed   yes

  Plans change in the RedReplier app: https://redreplier.com/billing
```

**Destructive commands that make you type.** `keyword delete` also deletes every mention that keyword produced, with no undo and no refund, so it asks you to type DELETE and offers `keyword disable` first. `site delete` asks you to type the domain. `--yes` skips both; `--no-input` without `--yes` refuses with exit 2 rather than guessing.

```
$ redreplier keyword delete kw_7c19
  ✗ Deleting "reddit monitoring" also deletes 1,204 mentions it produced.
    There is no undo and no refund. To pause instead, keeping the mentions:
      redreplier keyword disable kw_7c19

  Type DELETE to confirm: DELETE
  ✓ Deleted
```

## Commands

Grammar is noun then verb, space-separated. `ls` works wherever `list` does, `rm` wherever `delete` does, and `view` wherever `get` does.

### site

| Command | Key flags | Notes |
|---|---|---|
| `site list` | | Every monitored site, its keyword counts and whether it has a description |
| `site get <id>` | | The site plus its full keyword table with statuses |
| `site create` | `--url`, `--name`, `-k/--keyword`, `--description`, `--no-analyze` | Without `--description` the server scrapes the URL and spends one AI generation, so it confirms first. `--description @file` reads a file and `-` reads stdin |
| `site update <id>` | `--name`, `--description` | Existing mentions are not rescored |
| `site delete <id>` | `--yes` | Deletes the site, its keywords and every mention they produced |
| `site analyze` | `--url`, `--yes` | Generates a description. Human mode prints it to stdout alone; a pipe is machine mode and gets the JSON envelope, so pipe it with `REDREPLIER_FORCE_TTY=1` or read `.data.description` with `jq` |

A site with no description has its mentions left unscored, and `site list` says so with the command that fixes it:

```
$ redreplier site list
  ID              DOMAIN            NAME            KEYWORDS              DESCRIPTION
  ws_4f21…        acme.com          Acme            12 active, 3 pending  yes
  ws_9b03…        acmedocs.io       Acme Docs       4 active              missing

  ⚠ acmedocs.io has no description. Its mentions are not scored.
    fix: redreplier site analyze --url https://acmedocs.io
  Listing sites activates any PENDING keyword that fits your plan's free headroom.
  3 keywords still PENDING, there was no free slot. Price an upgrade: redreplier keyword plan
```

Reading the site list promotes `PENDING` keywords that fit free headroom, which is a server-side effect of the endpoint. The response carries no before-and-after, so the CLI states the rule and how many keywords are still `PENDING` rather than claiming a number was just promoted.

### keyword

| Command | Key flags | Notes |
|---|---|---|
| `keyword add <siteId> <keyword...>` | | Trimmed, lowercased and de-duplicated before sending, so the preview matches what the server stores |
| `keyword edit <id>` | `--value` | Free and unlimited, and it keeps the paid slot. A case-only change is a no-op |
| `keyword disable <id>` | | Stops collecting, keeps the mentions, never charges |
| `keyword enable <id>` | | Lands `PENDING` when no slot is free |
| `keyword delete <id>` | `--yes` | Deletes every mention the keyword produced. Type DELETE to confirm |
| `keyword activate-pending` | | Promotes pending keywords into free slots. Overflow stays pending |
| `keyword plan` | `--count` | `--count` is an account-wide total of active keywords, not an increment |
| `keyword usage` | | Keyword edits are unlimited on every current plan, and the output says that rather than drawing a meter |

`keyword` also answers to `keywords` and `kw`.

### mention

| Command | Key flags | Notes |
|---|---|---|
| `mention list` | `--site`, `--status`, `--bucket`, `--include-low`, `--keyword`, `--source`, `--sort`, `--from`, `--to`, `--limit`, `--offset`, `--all` | Repeat `--status`, `--bucket`, `--keyword` and `--source` for several values |
| `mention count` | The same filters | `{"total": N}` in machine mode, the API payload unchanged |
| `mention show <id>` | `--explain`, plus the filters | Pages the list to find the id, or fetches it through `explain` |
| `mention status <id> <status>` | | `NEW`, `APPROVED` or `REJECTED`, case-insensitive. Reversible, so no confirmation |
| `mention explain <id>` | | The first call generates and is slow, later calls are instant reads |
| `mention tail` | `--min-score`, `--interval`, `--since`, `--exec`, `--approve-on-exec-success`, plus the filters | `--interval` has a floor of 30 s |

Enums, in full:

| Flag | Values |
|---|---|
| `--status` | `NEW`, `APPROVED`, `REJECTED` |
| `--bucket` | `VERY_LOW`, `LOW`, `MEDIUM`, `HIGH`, `VERY_HIGH` |
| `--source` | `REDDIT_POST`, `REDDIT_COMMENT`, `TWITTER`, `BLUESKY`, `HACKERNEWS`, `FACEBOOK`, `FACEBOOK_GROUP` |
| `--sort` | `RELEVANCE`, `RECENT` |

Two rows are hidden by default and both are surfaced in the footer when they could be biting: `REJECTED` mentions need `--status REJECTED`, and mentions below the site's minimum score need `--include-low`. `--limit` runs from 1 to 500 and is validated before the request. `--from` and `--to` filter ingestion time, not the time the thread was posted.

`mention` also answers to `mentions`.

### alerts

| Command | Key flags | Notes |
|---|---|---|
| `alerts get` | | Whether alerts are on, the cadence, and the cadences this plan allows |
| `alerts set` | `--on` or `--off`, `--cadence` | `PUT /alert-settings` is a full replace, so the CLI reads the current cadence and resends it unless `--cadence` is given |

```
$ redreplier alerts get
  enabled   yes
  cadence   60m
  fastest   30m on this plan
  options   30, 60, 120, 180, 240, 720, 1440
```

`--cadence` accepts 15, 30, 60, 120, 180, 240, 720 or 1440 minutes and an unlisted value is rejected with exit 2 before the request, because the server's 400 for this is generic. `availableCadences` in the response is what your plan allows, which is a subset of those eight.

### Everywhere else

| Command | Key flags | Notes |
|---|---|---|
| `login` | `--token-stdin`, `--profile`, `--api-url`, `--name` | |
| `logout` | `--profile`, `--all` | |
| `whoami` | | Prints which source each of the token and the API URL came from |
| `config list \| get \| set \| unset \| path` | | Reads and writes `config.json` |
| `open [what] [id]` | | `dashboard`, `mentions`, `mention <id>`, `sites`, `site <id>`, `keywords`, `tokens`, `billing` |
| `doctor` | `--json` | Node version, files, permissions, token, API reachability, rate limit |
| `completion <shell>` | | `bash`, `zsh`, `fish`, `powershell` |
| `mcp` | `--client`, `--local`, `--install` | Prints or names the file for the MCP client config |
| `api <method> <path>` | `-q/--query`, `-d/--data`, `-H/--header`, `-i/--include` | Raw authenticated request |

`api` is the escape hatch. A command we have not written yet never blocks you:

```bash
redreplier api GET /mentions -q limit=5 -q statuses=NEW
redreplier api PATCH /mentions/8f2c1b0e/status -d '{"status":"APPROVED"}'
redreplier api PUT /alert-settings -d @alerts.json
```

Repeat `-q` with the same key for an array parameter. `-d @-` reads the body from stdin. An `Authorization` header is rejected, because the token comes from the resolved profile and the CLI never sends it anywhere but the configured API host.

`mean-marketer` exists, is experimental, and rides on four endpoints that are in no OpenAPI document. It is hidden from `--help` and listed under `--help-all`, and every line it prints carries that warning.

## Global flags

Accepted at any position.

| Flag | Default | Meaning |
|---|---|---|
| `-p, --profile <name>` | `current` | Credential profile |
| `--json` | auto | Force machine mode |
| `-q, --quiet` | false | No spinners, hints or notices |
| `--no-color` | auto | Strip ANSI |
| `--debug` | false | Request log to stderr, token redacted |
| `--api-url <url>` | production | Override the base URL, for staging |
| `--token <token>` | resolved | One-shot token, highest precedence |
| `-y, --yes` | false | Skip confirmation prompts |
| `--no-input` | auto | Never prompt; fail with exit 2 instead |
| `--lang <code>` | unset | `en`, `fr`, `de`, `es`, `pt` |
| `--full-ids` | false | Print identifiers in full instead of truncating |
| `-V, --version` | | Prints `redreplier/1.3.2 node-v22.14.0 darwin-arm64` |
| `-h, --help` | | `--help-all` adds the experimental commands |

`--no-input` is implied when stdin is not a TTY.

## JSON output

Output mode is chosen for you. Human tables when stdout is a TTY, one JSON document when it is not, when `--json` is passed, when `CI` is set, or when `REDREPLIER_JSON=1`. So `redreplier mention list | jq '.data[0].id'` works with no flag.

```json
{
  "ok": true,
  "command": "mention.list",
  "data": [{ "id": "8f2c1b0e", "relevanceScore": 92, "...": "..." }],
  "meta": {
    "total": 213,
    "limit": 50,
    "offset": 0,
    "hasMore": true,
    "rateLimit": { "limit": 600, "remaining": 598, "resetSeconds": 41 }
  }
}
```

Four rules that will not change without a major version:

1. `data` is the API's payload unmodified. No renamed keys, no computed fields.
2. `data` is an array for list commands, an object for single-object commands, `null` for commands with no payload.
3. `meta` carries paging and rate-limit information and nothing else.
4. Errors go to stderr as `{ "ok": false, "command": "...", "error": { "code", "status", "message", "details" } }` and the process exits non-zero. stdout stays clean.

`mention tail` is the one exception to rule 1's document shape: it streams newline-delimited JSON, one mention per line, because a tail has no end at which to close a document.

In human mode every spinner, prompt, hint, warning and notice goes to stderr, so a pipe never swallows them and never receives them. `REDREPLIER_FORCE_TTY=1` keeps human output when piped, which is how the tables in this file were captured.

Add `--json` to a list command and the available field names are printed to stderr, so `redreplier mention list --json 2>&1 >/dev/null` documents the shape.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Generic failure, including 5xx |
| 2 | Usage error: bad flag, missing argument, unknown enum, prompt needed under `--no-input` |
| 3 | Auth failure: 401, 403, missing or malformed token |
| 4 | Not found: 404, or a mention that is not visible in this workspace |
| 5 | Validation or other 400 |
| 6 | Conflict: 409 |
| 7 | Rate limited: 429 after retries |
| 8 | Network failure or timeout |
| 9 | Quota or plan limit: 402, no AI generations left |
| 130 | Interrupted with Ctrl-C |

## Configuration and profiles

Two files, on macOS and Linux under `${XDG_CONFIG_HOME:-$HOME/.config}/redreplier/` and on Windows under `%APPDATA%\RedReplier\`:

- `credentials.json`, mode 0600, tokens only. Written to a temp file and renamed over the target, so a crash never leaves a half-written or world-readable file. The CLI refuses to read it when the mode is group or world readable and prints the `chmod 600` line.
- `config.json`, mode 0644, preferences only. Safe to commit to a dotfiles repo.

A profile is a token plus the API URL it belongs to. Use them for several workspaces or for staging:

```bash
redreplier login --profile acme --name "Acme workspace"
redreplier mention list --profile acme
export REDREPLIER_PROFILE=acme
```

Profile resolution: `--profile`, then `REDREPLIER_PROFILE`, then `current` in `credentials.json`, then `default`.

Token resolution, highest first: `--token`, `REDREPLIER_API_TOKEN`, `REDREPLIER_API_KEY`, the resolved profile.

Base URL resolution, highest first: `--api-url`, `REDREPLIER_API_URL`, the profile's stored `apiUrl`, the compiled-in default. A base URL is only ever read from your own flags, environment or config file. The CLI never takes a host from an API response.

`config` keys:

| Key | Meaning |
|---|---|
| `defaultSite` | Default for `--site` |
| `language` | Default `x-language` header |
| `updateCheck` | Set false to turn off the daily version check |
| `workspaceId` | The workspace this profile talks to |

```bash
redreplier config set defaultSite ws_4f21
redreplier config set language en
redreplier config list
redreplier config path
```

Run `redreplier doctor` when something is off. It checks the Node version, both files and their permissions, the token, API reachability and latency, the OpenAPI document, the rate-limit budget and any proxy variables, and prints the fix for each failure. It exits 1 when any check fails and supports `--json`.

## Environment variables

| Variable | Meaning |
|---|---|
| `REDREPLIER_API_TOKEN` | API token. Read first |
| `REDREPLIER_API_KEY` | Same thing, accepted for compatibility with the MCP server and skills |
| `REDREPLIER_API_URL` | Base URL. Defaults to `https://ai.redreplier.com/ai-app/api/v1` |
| `REDREPLIER_PROFILE` | Profile name |
| `REDREPLIER_DEBUG` | Set to `1` for the request log on stderr |
| `REDREPLIER_JSON` | Set to `1` to force machine output |
| `REDREPLIER_FORCE_TTY` | Set to `1` to keep human output when piped |
| `REDREPLIER_NO_UPDATE_CHECK` | Set to any value to skip the daily registry check |
| `REDREPLIER_INSTALL_DIR` | Destination for the curl installer. Defaults to `~/.local/bin` |
| `NO_COLOR`, `FORCE_COLOR` | Honoured as usual |
| `CI` | When set, machine output and no update check |

Both token spellings work and `doctor` names the one in use. There is no third spelling; if you find one in older docs, it is wrong.

## Shell completion

The script is generated from the live command tree at runtime, so it cannot go stale. Installation instructions print to stderr, which is why `eval` on the stdout works directly.

```bash
# zsh
eval "$(redreplier completion zsh)"

# bash
eval "$(redreplier completion bash)"

# fish
redreplier completion fish | source

# powershell
redreplier completion powershell | Out-String | Invoke-Expression
```

Add the line to your shell rc file to keep it. The Homebrew formula installs completions for you.

## Links

- Dashboard: <https://redreplier.com/dashboard>
- API tokens: <https://redreplier.com/api-tokens>
- MCP server, for Claude, Cursor, VS Code and Windsurf: <https://mcp.redreplier.com/mcp>. Run `redreplier mcp` to print the client config, or `redreplier mcp --install` to name the file it belongs in.
- AdaptlyPost CLI, for scheduling and publishing social posts: <https://github.com/adaptlypost/adaptlypost-cli>
- Flowsery CLI, for web analytics, session replay and issue triage: <https://github.com/Flowsery/flowsery-cli>
- Issues: <https://github.com/RedReplier/redreplier-cli/issues>

`Formula/redreplier.rb` in this repo is a reference copy of the Homebrew formula. Homebrew installs from the tap repo, `RedReplier/homebrew-tap`, and the release workflow rewrites the copy there with the real checksums. Editing the file in this repo changes nothing that users install.

Releases are tagged with a leading `v`, as in `v1.2.3`. The binary asset URLs, the install script and the formula all embed that tag.

## License

MIT. See [LICENSE](./LICENSE).
