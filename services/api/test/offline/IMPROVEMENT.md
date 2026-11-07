# Controlled improvement format

Elvi can keep improving on this isolated branch. Live order-taking stays off until a separate approval. Nothing here trains a model or rewrites itself.

## What a change is

One measured batch:

1. A versioned cart and catalog schema. Item id, quantity, modifier group, and option are explicit. Provenance on every asserted field is `transcript`, `staff-readback`, `pos-verified`, `inferred`, `synthetic`, `catalog-default`, or `catalog-required`. Inferred and catalog fields are not promoted to ground truth.
2. Verified correction examples stay separate from held-out cases. A held-out case is not used to invent the fix.
3. The same replay command runs on a pinned parent SHA and on the candidate. Results are files in `results/`, named with the SHA.
4. Property checks sit next to the examples: counts, a correction that does not leak onto another line, and a second pass that does not change the cart.
5. Uncertainty stays visible. `transcript-final` means the call is done and a person still has to look. `validation-complete` means the catalog check passed. `staff-accepted` means a person explicitly approved and the catalog check still passes. A guessed Square match is only an association. Unresolved validation cannot be stored as phase `final`.
6. The batch records a rollback plan: the parent SHA and the files touched. Rollback is `git revert` of that batch, not a reset of published history.

## What this batch does not add

No new learning framework, no fine-tuning, and no automatic edit of the parser from a failed case. A proposal can name a later capture batch. It does not start that batch.

## Acceptance words

| Word | Meaning |
| --- | --- |
| `listening` | Explicit status, cancel, or in-call state. Unchanged. |
| `review` / `transcript-final` | Transcript is done. Catalog validation is open. Lines stay. Not a non-order. Not accepted. |
| `final` / `validation-complete` | Catalog check passed. Ready for a person. Not staff-accepted. |
| `staff-accepted` | An explicit human approval, stored as `explicitlyApproved` on the ticket, and the catalog check still passes. A Square match by phone, name, items, or time is only an association and never sets that flag. The flag survives a later clear rewrite and a later guessed link. An unresolved rewrite still returns to review with the lines kept; the next clear rewrite returns to `staff-accepted`. |

## Rollback for the acceptance batch

Parent: `49f85aec23d2582dca07e233f6ef136bee982f32`.

Touched: `services/api/src/offline-evidence.ts`, `services/api/src/call-scoring.ts`, `services/api/src/twilio.ts`, `apps/web/phone.html`, `services/api/data/_elvi-ticket-preview/preview-v5.html`, and the offline tests under `services/api/test/offline/`.

`git revert` the acceptance commits. Do not rebase onto GitHub main. The eight commits on `origin/main` after `6cffbb9`, and Mac disk `946ac2d`, stay out of this branch.
