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
| Mac disk `946ac2d43a7040c7ab6453c719ba56b18af20937` | not in this clone | Reported as six commits above GitHub main. Not incorporated. The loaded process SHA was not proven. |

GitHub main is six commits ahead of the PR 15 merge-base (Laura gordita readback, then the Nati merges through `8b9fe526`). Those commits are not in this branch. PR 13's merge on GitHub main is `1a3a3c8` (branch head `3340bca`). Later Nati tip `74c357c` is on `origin/cursor/nati-vapor-enchilada-f6d4` and is not in GitHub main. This run does not cherry-pick it and does not push anything from the Mac.

## Commands

From the repo root, after `npm install`:

```bash
# Candidate (current checkout). Exit 1 only if a known-correct control fails.
npm run offline:evidence --workspace @cocina-elvis/api -- --out services/api/test/offline/results/candidate.json

# Controls plus the "inferred is not asserted" check.
npm run offline:evidence:test --workspace @cocina-elvis/api

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
