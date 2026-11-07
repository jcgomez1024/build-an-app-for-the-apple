# Release blockers

This milestone does not change deployment, restarts, or busy-call handling.

Live use stays blocked until Carlos gives a separate explicit approval after all of the following:

1. Independent review of this PR.
2. Parity validation against the machine that is actually serving calls. GitHub `origin/main` (`8b9fe526`) is not that disk. Mac commit `946ac2d43a7040c7ab6453c719ba56b18af20937` is not in this clone, and the process SHA loaded on Nov 6 was not proven.
3. Staff review of the sanitized fixtures. Inferred fields are not ground truth. No POS payment total in the supplied artifacts was independently verified.
4. Fail-closed behavior for a restart or deploy while a call is active, and for an unknown or busy call. That safety work was not done here. A restart that drops or double-writes an in-flight order is still an open blocker.

Passing `offline:evidence` or the replay suite is not that approval.
