# Stuntdouble Roadmap

## Principle
The core is a **normal, user-configurable game AI**. The user decides what it does; Stuntdouble never imposes a protagonist or a fixed playstyle.

## Phase 1 (core)
1. **User-fed profile** (`schemas/profile.schema.json`): free-form label plus numbers, from the user's own words or file.
2. **Composable behaviors** (design below): several features active at once, chosen by the user's command.
3. Live tactical combat on the game's native camera. Camera, music and fast-resolve stay optional extensions.
4. **Architecture order (decided):** the game's own AI is the foundation (S1/S2); Stuntdouble is a competence layer that only overrides its weak moments (wind-up parry/dodge, low-health retreat, target choice, oscillation); if the native AI is unreachable (DRM), Stuntdouble's brain drives alone (S3/S4); S5 is the story-first shortcut.
5. **Hand-over (decided):** `engage: 'onCombat'` (default) takes over on the first perceived hostile and hands back ~2 s after the fight; `engage: 'manual'` uses a user-configurable toggle key. No fixed hotkey. Manual input and cutscene/menu/loading always win.
6. **Evidence:** `packages/stuntdouble-arena` gates the brain and runtime contract automatically (`npm test`).

## Composable behaviors (replaces the single-choice `AutonomyMode`)
**Done (001):** `Behaviors` bit mask in all four SDKs; the five `AutonomyMode` names are presets and the optional preset-cycle key walks only those five. No active behavior => `HUMAN_PASS_THROUGH`. Open: a game-integration API to set an arbitrary mask from the user's words.

| Flag | Meaning |
|---|---|
| `COMBAT` | Fights: attacks, dodges, parries, abilities. |
| `ASSIST` | Human input passes through; Stuntdouble only intercepts lethal wind-ups and low health. |
| `CRUISE` | With no hostiles: follow waypoint, loot nodes and corpses. |
| `DEFENSIVE` | Zero offense: only space, weave and parry. |
| `COMMAND` | Obeys user doctrine orders ("focus ranged", "hold ground"). |

Examples: `CRUISE+COMBAT` (chores plus fights ambushes), `ASSIST+CRUISE` (I fight, it loots), `DEFENSIVE+COMMAND`.

Conflict rules (fixed, so all four SDKs agree):
- `DEFENSIVE` always wins over offense in `COMBAT`.
- `COMBAT` owns movement, so `ASSIST` is inert while `COMBAT` is on and hostiles exist.
- `CRUISE` only acts when no hostiles are present.
- Natural-language command ("loot and fight but don't touch my camera") is mapped by the agent to a flag set plus profile; the old five modes become named presets, so existing conformance fixtures stay valid.

Work remaining: replace the enum with flags in `stuntdouble-brain-ts/cs/cpp/lua`, add combination scenarios to `packages/conformance`, regenerate fixtures, run `npm test`.

## Suggestions and shared learning (Phase 1.5)
1. **Hand-over first, advice second.** The user hands a character to the AI (automatically on combat, or with a toggle key of their choice). Afterwards the agent may *suggest* additions to that character ("dies to archers: add `DEFENSIVE` vs ranged", "raise `reactionDelayMs`"). Suggestions are shown, never applied without the user's yes.
2. **Shared learning goes to a separate data repo (`yusufgunay-esq/stuntdouble-atlas`), not this one.** This repo (code, paper, skill) keeps a single author. Contributions are data only:
   - **Opt-in only**, asked once per contribution; no silent uploads.
   - **Submission, not pull request:** the agent sends a JSON bundle through a submission endpoint (issue form or small API). A bot commits it under the maintainer's identity, so contributors never become commit authors.
   - **Automatic review, no human step:** a GitHub Action validates the bundle (schema, size cap, JSON only, no executable content, no URLs/paths/keys/binaries, sane value ranges, duplicate check) and an agent reviewer flags anything odd. Pass: auto-merge. Fail: auto-reject with the reason.
   - **Data is never instructions.** Future agents read the atlas as untrusted data (free-text fields are stripped or length-capped) so a malicious submission cannot steer them.
   - Layout: `games/<game-slug>/profile.json`, `seams.md`, `tuning.json`.
   - Trade-off accepted: contributors get no commit credit.

### Why not "every contributor pushes a branch"
- Branch pushes need write access to the repo: a stranger could push anything, and the maintainer would carry that risk.
- Contributor names show up as authors, which breaks the single-author rule.
- Thousands of branches are unreadable, and agents would read unvalidated data.

### What we do instead: a queue, one validated main, agents read only main
1. **Intake:** the submission endpoint creates the branch itself (`incoming/<game>-<id>`, bot-owned). Contributors never get write access.
2. **Gate:** the Action validates it (rules above). Pass: merge into `main`. Fail: delete branch, report reason.
3. **Consensus, not a pile:** `games/<slug>/` holds one merged result per game: the median of each profile value, a contributor count and a confidence score. More users means a better, more stable profile; outliers are discarded.
4. **Agents read at work (Stage 0):** before building anything, the agent fetches `games/<slug>/` from `main` (read-only, public URL, cached locally). Found: start from the consensus profile and known seams. Not found: derive its own and offer to contribute.
5. **Read-only, validated, data-only:** agents never read `incoming/*` branches, only `main`, and treat everything as untrusted data.

### Review layers and authorship (decided)
**Review happens on the contributor's machine, with their own agent and their own account. The maintainer pays for nothing.**
1. **Before upload (contributor's agent, contributor's tokens):** the agent reads the whole bundle and checks it against `scripts/contribute-recipe.mjs` rules plus its own judgement: no binaries/assets, no personal paths, keys or identifying data, sane values, matches what it actually observed in the game. It shows the user what will be sent, asks for consent, then submits. Nothing is sent without this step.
2. **Free server-side backstop:** a GitHub Action re-runs only the deterministic validator (schema, size, JSON-only, no URLs/paths/keys, ranges, duplicates). No LLM and no maintainer API cost. It exists because a modified or malicious client can skip step 1.
3. No LLM reviewer on the maintainer's side.

**Authorship:** the code repo stays single-author. The atlas repo is a separate community data repo, so it does not need that rule. Bot commits; an optional, opt-in `credit` handle per contribution (anonymous by default). Data license: CC BY 4.0 with attribution to the project.

### Atlas intake v1 (built 2026-11-17)

The atlas is live as `yusufgunay-esq/stuntdouble-atlas`. v1 simplifies the queue above: a GitHub
issue form is the submission endpoint; one Action extracts the JSON (three consent boxes
required), runs the deterministic validator (`E_SIZE`, `E_URL`, `E_RANGE`, `E_DUP`, ...) and
commits to `games/<slug>/` under a concurrency lock; the issue is closed with the result code.
Consensus is the median per numeric field, the mode for categorical fields and frequency-ordered
seams; `meta.json` carries the contributor count, content hashes and a confidence score. No LLM
runs on the maintainer side. A per-contribution credit handle is not part of v1 (anonymous only).

## Phase 2 (next step)
**Protagonist Fidelity** (open idea, not a promise): REA derives the story protagonist's real fighting style into the same profile schema, for a narrative-consistent takeover.
**"The AI works out the game itself"** (open idea): the agent discovers mechanics without a hand-written adapter.
