# Offline order evidence

This compares the post-call order path on one code revision. It is not a live menu, not the Mac disk, and not permission to deploy.

## What it runs

`shadowOrderFromTurns` in `services/api/src/call-scoring.ts`, with:

- the phone menu built from `services/api/data/site-catalog.json`
- an empty model stub (`actions: []`, `reply: ""`)
- no Square, Twilio, SMS, caller-memory file, or other network call

The cart is whatever the existing repair passes build. Confirmed fields (`transcript`, `staff-readback`, `synthetic`) are the only pass/fail assertions. `inferred`, `catalog-default`, `catalog-required`, and `pos-verified` stay in `unresolved` and are not promoted.

Page's original acceptance names are not this suite. Every result sets `pageNamedGateSatisfied` to false.

## Baseline used for this branch

Remote-accessible code only.

| Ref | SHA | Role |
| --- | --- | --- |
| `origin/main` | `8b9fe526b7c828adf5683a83d5ecc26d4cbeb048` | GitHub main. Not the Mac disk. |
| PR 15 merge-base | `6cffbb91640547d08f866ac47cc1b8092e935b7a` | Last shared commit with GitHub main. |
| PR 15 tip before this milestone | `30575e9807daa3e30e518900c4da564e9bd6215e` | Replay baseline for the matrix in `results/baseline-before-order-state.json`. |
| Mac disk `946ac2d43a7040c7ab6453c719ba56b18af20937` | not in this clone | Not incorporated. The loaded process SHA was not proven. An earlier operator note said this disk was six commits above GitHub main; that disk count cannot be rechecked from this clone. |

`git rev-list --count 6cffbb91640547d08f866ac47cc1b8092e935b7a..origin/main` is **8**. An earlier note on this branch said six. That count was wrong. The eight commits are `44f0e47`, `64dba35`, `130b36b`, `9609200`, `3340bca`, `1a3a3c8`, `6438ae0`, and `8b9fe52` (Nati vapor/toppings merges, then the Laura gordita repair). They are not in this branch, and this run does not merge or rebase them in. PR 13's merge on GitHub main is `1a3a3c8` (branch head `3340bca`). Later Nati tip `74c357c` is on `origin/cursor/nati-vapor-enchilada-f6d4` and is not in GitHub main.

## Commands

From the repo root, after `npm install`:

```bash
# Candidate (current checkout). Exit 1 only if a known-correct control fails.
npm run offline:evidence --workspace @cocina-elvis/api -- --out services/api/test/offline/results/candidate.json

# Controls plus the "inferred is not asserted" check.
npm run offline:evidence:test --workspace @cocina-elvis/api

# Menu-validator unit + integration (shadow auto-accept and ticket lines). Exit 1 on any failed check.
npm run offline:menu-validation --workspace @cocina-elvis/api -- --out services/api/test/offline/results/menu-validation-candidate.json
npm run offline:menu-validation:test --workspace @cocina-elvis/api

# Existing replay suite. gustavo-qd1 and juan-qd1 need the gitignored POS cache and fail closed without it.
npm run replay --workspace @cocina-elvis/api
```

`results/baseline-before-order-state.json` was captured by this harness while the order path was still `30575e9`, before soup declines and missing required groups changed. The file is committed so the comparison does not require checking that SHA out. Re-running the harness writes a new file and does not refresh the baseline.

## How to read a row

Captured with the tightened deluxe check (a regular dorada is not deluxe):

| Run | Controls | Candidates |
| --- | --- | --- |
| Baseline order path `30575e9` | 4/4 pass | 1/12 pass (`S04`), 11 fail |
| Candidate | 4/4 pass | 2/12 pass (`C05`, `S04`), 10 fail |

`C05` is the case this change moves. The declined menudo is gone and the three deluxe bistec quesadillas remain. `S04` passes on both runs because the empty model never added the soup. The planted-line test in `evidence.test.ts` is what shows a soup already on the cart is removed after "¿Tienes pozole?" / "No, okay."

## Menu validation

`results/menu-validation-baseline-96ffd20.json` is this suite against the validator at `96ffd20`. `results/menu-validation-candidate.json` is the same suite after the repair. Unit rows call `flagUnresolvedRequired`. Integration rows call `shadowOrderFromTurns` and then `buildTicketLines`. They are not the C01–C12 capture replay.

At `96ffd20` the suite was 4/15 unit pass and 3/5 integration pass. A line with no selection was already blocked inside `shadowOrderFromTurns`. Duplicate options, choices that are not in the group, unknown SKUs, sold-out items, bad quantities, and an absent, empty, malformed, or unavailable menu stayed clear. The ticket builder also dropped `confirmar` notes.

The acceptance batch runs the same command against parent `49f85ae` (`results/menu-validation-baseline-49f85ae.json`): 17/21 unit pass and 5/9 integration pass. Failures there are the nameless required group, the missing acceptance gate, a missing `run.menu` left `validation: clear`, a throwing loader aborted the replay, and `upsertTicket` was not on the persistence path. The candidate at `03d03ee` / tip `e5bbe494` passes 21/21 unit and 9/9 integration of that older suite.

The approval revision runs the expanded suite against parent `e5bbe494` (`results/menu-validation-baseline-e5bbe494.json`): 23/26 unit pass and 10/16 integration pass. The nine failures are a guessed Square link counted as `staff-accepted`, an explicit approval ignored, and recovery still hardcoding phase `final` with no loader attachment. Controls that already failed closed (unresolved stays review, a later clear write stays `validation-complete`, contradictory approval stays review) stay green on that parent. The candidate at `22e46e8` passes 26/26 unit and 16/16 integration. See `IMPROVEMENT.md`. A passing check is not a live-readiness claim.

## Conversation intent

`data/conversation-intent.json` is loaded into the ordering instructions and into the phone turn before the legacy repairs. A missing number does not become 1. The identical 24-case harness writes `conversation-intent-suite-baseline-9bef511.json` (0/24) and `conversation-intent-suite-candidate.json` at `760292e` (24/24). Plumbing counts are separate. The model row stays unverified. From `services/api`:

```bash
../../node_modules/.bin/tsx test/offline/run-conversation-intent.ts --out test/offline/results/conversation-intent-candidate.json
```

The model row is unverified. A stub pass does not show that the model follows the examples. The acceptance baselines, including `menu-validation-baseline-e5bbe494.json`, stay as captured.

- `pass` / `fail` uses confirmed fields only.
- `unresolved` lists fields that must stay unasserted.
- `ticket.complete` is true only for a final, auto-accepted cart with no `confirmar` note and no `noOrder` flag.
- Candidate failures are remaining findings. The suite does not claim 12/12.

## Limits

- Live model actions are not replayed. An empty stub cannot reproduce a wrong model add that the repairs then delete, or a line that only the model would add.
- Staff-handled calls: internal replies in the original incidents were not spoken to the caller. This harness does not synthesize those replies.
- No independently verified POS totals are available. `pos-verified` is unused.
- The site catalog is the phone menu. The gitignored POS cache is not required here and is absent on this machine.
- Runtime parity with the Mac process is unknown. GitHub main and the Mac disk SHA are different, and this branch contains neither the six GitHub-main commits after `6cffbb9` nor `946ac2d`.
