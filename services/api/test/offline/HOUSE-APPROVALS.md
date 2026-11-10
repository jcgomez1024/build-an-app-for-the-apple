# House approvals

Standalone approvals from Carlos. None of these is an entry in `HOUSE_DEFAULTS`, and none of them is a general rule for every extras-versus-upgrade tie. The counted-hold trigger is unchanged. `spokenOrderReply` stays out of the live Twilio webhooks. A shadow cart stays off Square and the kitchen.

## Gordita con queso

Carlos, Nov 10, 2026, 6:46 PM EST: "Gordita con queso means the Queso Gordita option."

On a gordita line that already owns the upgrade group, "con queso" maps to `(QGD) Queso Gordita`, option id `WLHGZCJ422ECZZJ6FOCDMD7G`.

Every other extras-versus-upgrade tie stays `confirmar`. This approval does not choose an extras group, and it does not apply to any other dish.

## Which-dish cheese, parent `a755b68`

At `a755b68`, `(C) Con / With` listed two queso options, so that group was skipped and the attach path selected `**EXTRA SIDE Queso Fresco`.

`taco-con-queso-is-fresco-on-top` and `quesadilla-con-queso-adds-nothing` first pass at `9cad404`. `parent-failures.txt` in the `9cad404` evidence zip records both as FAIL on `a755b68` for that reason.
