// An in-memory table standing in for a database. It models only the two
// things the token module relies on: transactions, and a lock on a single row.
//
// The module's correctness depends on the order in which writes become
// visible, not on any storage engine, so a real database would add setup and
// nothing else. `lockByDigest` plays the part of a row lock taken inside a
// transaction: when two transactions ask for the same row, the second waits
// and then sees what the first wrote.

class Lock {
  #held = false;
  #waiters = [];

  async acquire() {
    if (!this.#held) {
      this.#held = true;
      return;
    }
    await new Promise((resolve) => this.#waiters.push(resolve));
  }

  release() {
    const next = this.#waiters.shift();
    if (next) next();
    else this.#held = false;
  }
}

export class TokenStore {
  #rows = [];
  #locks = new Map();
  #txLock = new Lock();

  /** Snapshot of all rows for tests; copies, so the table cannot be edited through it. */
  all() {
    return this.#rows.map((r) => ({ ...r }));
  }

  insert(row) {
    this.#rows.push({
      digest: row.digest,
      familyId: row.familyId,
      ownerId: row.ownerId,
      expiry: row.expiry,
      retiredAt: row.retiredAt ?? null,
      familyClosedAt: row.familyClosedAt ?? null,
      successorDigest: row.successorDigest ?? null,
    });
  }

  findByDigest(digest) {
    const row = this.#rows.find((r) => r.digest === digest);
    return row ? { ...row } : null;
  }

  updateByDigest(digest, patch) {
    let n = 0;
    for (const r of this.#rows) {
      if (r.digest === digest) {
        Object.assign(r, patch);
        n += 1;
      }
    }
    return n;
  }

  updateByFamily(familyId, patch) {
    let n = 0;
    for (const r of this.#rows) {
      if (r.familyId === familyId) {
        Object.assign(r, patch);
        n += 1;
      }
    }
    return n;
  }

  /**
   * Calls `fn` with a handle for one transaction. The handle offers the
   * store's read and write methods, plus `lockByDigest`, which waits until no
   * other transaction holds the lock on that row.
   */
  async transaction(fn) {
    await this.#txLock.acquire();
    const held = [];
    try {
      const handle = {
        lockByDigest: async (digest) => {
          let lock = this.#locks.get(digest);
          if (!lock) {
            lock = new Lock();
            this.#locks.set(digest, lock);
          }
          // Give up the store-wide lock while queued for the row, so another
          // transaction can run meanwhile. Without this the wait could never
          // overlap with other work, and a missing row lock would go unseen.
          this.#txLock.release();
          await lock.acquire();
          held.push(lock);
          await this.#txLock.acquire();
          return this.findByDigest(digest);
        },
        insert: (row) => this.insert(row),
        findByDigest: (h) => this.findByDigest(h),
        updateByDigest: (h, patch) => this.updateByDigest(h, patch),
        updateByFamily: (s, patch) => this.updateByFamily(s, patch),
      };
      return await fn(handle);
    } finally {
      for (const lock of held) lock.release();
      this.#txLock.release();
    }
  }
}
