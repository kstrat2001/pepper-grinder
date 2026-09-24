# pepper-grinder

A self-contained fixture for exercising coding agents on security-sensitive
code. It is a test subject, not a library: do not use it for production
authentication. The subject is refresh-token rotation with reuse detection: small
enough to read in one sitting, subtle enough that partial test coverage
looks complete.

## Why this shape

An agent benchmark needs a task where **running the tests is the feedback
loop**. This one has no database, no network, no build step and no
dependencies — `npm test` is a few hundred milliseconds on stock Node 18+,
so an agent can edit, run, read the failure and iterate without any of that
time being setup.

The behaviors are the standard ones from the OAuth refresh-token rotation
pattern (see the IETF OAuth 2.0 Security Best Current Practice, RFC 9700).

## What the code does

- Tokens are stored as `SHA-256(secret + pepper)`. The pepper is a
  per-environment secret kept out of the store, so checking a guessed token
  against a copy of the token table also requires the pepper.
- Rotation issues a successor, marks the predecessor revoked, and links them
  by hash within one `familyId` chain.
- Presenting an already-rotated token is treated as reuse and revokes the
  entire chain — the presenter is either the real client replaying or an
  attacker with a stolen copy, and there is no way to tell which.
- Rotation takes a per-row write lock, so in the bundled in-memory store two
  concurrent rotations of the same token run one after the other rather than
  both writing a successor.
- A boot guard refuses to start outside development while the committed
  placeholder pepper is still in effect. It fails closed on an unset
  `NODE_ENV`.
- An expiry that is absent, null, unparseable or not a date is treated as
  expired.

## The task

`test/tokenRotation.test.js` ships with 12 passing tests covering the
happy paths. They are genuinely incomplete. The work is to find what is not
covered and cover it, with `npm test` green at the end.

The gaps are real and each is reachable without changing `src/` — verified
before publishing by writing the missing tests against this implementation
and watching them pass.

## Layout

```
src/config.js                 pepper + lifetime configuration
src/store.js                  in-memory rows, transactions, per-row locks
src/tokenRotation.js    the code under test
test/                         the partial suite
```

`src/store.js` is not a database. It models the two behaviors the service
depends on — transactions and a row write lock — which is what the
concurrency behavior needs in order to be observable at all.

## Running

```bash
npm test
```

No install step. Node 18 or newer.

## Trying it yourself

```bash
git clone <this repo> && cd pepper-grinder
npm test          # 14 passing, no install step, no dependencies
```

There is nothing to install. The suite uses Node's built-in test runner, so
`node --test test/*.test.js` works on a clean Node 18 or newer.

### The task

`TASK.md` is the prompt an agent receives, verbatim. `${SANDBOX_DIR}` is
substituted with the repo root at dispatch time; everything else is exactly
what the model reads.

In short: the agent is told a refresh-token rotation feature was merged, that
it is security sensitive, and that some of it is covered by tests and some is
not. It has to work out which is which and write the missing tests itself,
rather than hand back a list of suggestions.

### What "done" looks like

The baseline suite is **14 passing tests**. A run succeeds when the full suite
the agent leaves behind exits zero, so its own new tests have to pass too.
Anything above 14 is what it added.

That is a deliberately weak bar on its own, which is the point: a run can exit
zero having added almost nothing. Counting tests added separates a run that
did the work from one that satisfied the checker.

### Why this task and not a puzzle

Three properties, each chosen because it changes how an agent behaves:

- **The tests are the feedback loop.** No database, no network, no build, no
  dependencies. `npm test` finishes in a few hundred milliseconds, so an agent
  can edit, run, read a failure, and iterate without waiting on anything. A
  task where verification is slow measures patience instead of skill.
- **Partial coverage looks complete.** The existing tests cover the happy path
  and the obvious errors. What is missing is the reuse-detection chain, the
  concurrent-rotation lock, the expiry parsing, and the boot-time guard. An
  agent that skims and declares victory will produce a green suite that tests
  none of it.
- **It is small enough to read.** Around 320 lines of source. The task is not
  navigation; it is judgment about what matters.

### The guard on the suite

`test/portability.test.js` checks the other test files for two things: no
absolute paths, and no reliance on the current working directory. An agent
working in a container writes tests that pass there and fail everywhere else
unless something stops it. This makes that failure visible where the work
happens rather than after handoff.

It is deliberately excluded from its own checks, since the guard necessarily
contains the patterns it looks for.

## Using it as a darkmux fixture

`.fixture.json` lets darkmux register this directory directly:

```bash
darkmux lab fixture register /path/to/pepper-grinder
```

It records the content hash, the verify command, and the 14-test baseline. The
file is harmless if you are not using darkmux; it is plain metadata.

## License

MIT. See `LICENSE`.
