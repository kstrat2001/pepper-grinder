QA REVIEW REQUEST — refresh-token rotation feature

A refresh-token rotation feature was recently merged. This is a security-sensitive surface — auth tokens, replay protection, persistent storage of secrets — and it needs adequate test coverage before deployment.

What changed:

- Refresh tokens are hashed at rest (SHA-256 + a per-environment pepper)
- Rotation creates a new token, marks the predecessor revoked, and links the chain by hash
- Replay detection: presenting an already-rotated token revokes the entire chain
- A per-row write lock during rotation, so two concurrent rotations cannot both succeed
- A boot-time guard that refuses to start in non-development environments if the dev placeholder pepper is still configured
- Defensive parsing of expiry timestamps (NaN-safe, handles Date and ISO-string variations)

The implementation lives at:

- ${SANDBOX_DIR}/src/tokenRotation.js
- ${SANDBOX_DIR}/src/config.js (pepper + lifetime configuration)
- ${SANDBOX_DIR}/src/store.js (in-memory rows, transactions, per-row locks)

Existing tests:

- ${SANDBOX_DIR}/test/tokenRotation.test.js
- ${SANDBOX_DIR}/test/portability.test.js (a guard on the suite itself; leave it alone)

Some coverage is already in place. Some isn't. Your job is to figure out the difference, decide what matters, and write the tests yourself.

## Your task

Read the implementation. Read the existing tests. Decide which behaviors of the change aren't covered and would matter to you in a real code review. Then write those tests — don't hand them back as a list of suggestions.

Treat this as a real PR review where you have commit access: if you'd want a test to exist before approving, write it.

## Constraints

- Repo root: ${SANDBOX_DIR}.
- Your tests must run in a DIFFERENT environment than this one, where that
  path does not exist. Resolve anything path-dependent from
  `import.meta.url` (e.g. `new URL("../src/x.js", import.meta.url)`) and use
  `process.execPath` rather than the string "node" if you spawn a process.
  `test/portability.test.js` enforces both and will tell you immediately.
- Do not modify existing tests — only add new ones.
- Do not modify source code under src/. Tests only.
- Match the existing test file style: `node:test` with `describe`/`it` and `node:assert/strict`. There are no mocking libraries and no build step.
- Iterate by running the suite:
  cd ${SANDBOX_DIR} && npm test
- Final verification is the same command:
  cd ${SANDBOX_DIR} && npm test

## When you're done

You're done when the tests you've added are sufficient for you to approve this PR. Quality over quantity. Stop when adding more tests would be padding rather than risk reduction.

Most reviewers would land somewhere between 5 and 15 new test cases for a change of this surface area. If you're well outside that range in either direction, mention it in your reply.

## Reply format

Keep it tight:

- Gaps you identified: behaviors that needed coverage, one-line rationale per gap
- What you wrote: number of new tests, which files
- What you decided NOT to test, and why: the negative space matters
- Test result: the `# pass N` line from your final run
- Confidence: would you sign off on this PR after your additions?

