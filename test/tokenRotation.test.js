import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { TokenStore } from "../src/store.js";
import {
  digestSecret,
  openFamily,
  closeFamily,
  exchange,
} from "../src/tokenRotation.js";

let store;
beforeEach(() => {
  store = new TokenStore();
});

describe("digestSecret", () => {
  it("gives the same digest for the same token", () => {
    assert.equal(digestSecret("abc"), digestSecret("abc"));
  });

  it("returns 64 hex characters", () => {
    assert.match(digestSecret("abc"), /^[0-9a-f]{64}$/);
  });

  it("throws on an empty string", () => {
    assert.throws(() => digestSecret(""), /non-empty/);
  });
});

describe("openFamily", () => {
  it("keeps only the digest in the table, not the token itself", async () => {
    const { secret } = await openFamily(store, 1);
    const rows = store.all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].digest, digestSecret(secret));
    assert.notEqual(rows[0].digest, secret);
  });

  it("throws when the owner id is not a positive integer", async () => {
    await assert.rejects(() => openFamily(store, 0), /positive integer/);
  });
});

describe("exchange", () => {
  it("writes a successor and retires the presented row", async () => {
    const { secret } = await openFamily(store, 1);
    const result = await exchange(store, secret);
    assert.ok(result.data, "rotation should succeed");

    const previous = store.findByDigest(digestSecret(secret));
    assert.ok(previous.retiredAt, "predecessor must be revoked");
    assert.equal(
      previous.successorDigest,
      digestSecret(result.data.secret),
      "predecessor must point at its successor",
    );
  });

  it("puts the successor in the same family", async () => {
    const { secret, familyId } = await openFamily(store, 1);
    const result = await exchange(store, secret);
    assert.equal(result.data.familyId, familyId);
  });

  it("answers UNKNOWN_TOKEN for a token it never issued", async () => {
    const result = await exchange(store, "not-a-real-token");
    assert.equal(result.err.code, "UNKNOWN_TOKEN");
  });

  it("closes the family when a retired token comes back", async () => {
    const { secret } = await openFamily(store, 1);
    await exchange(store, secret); // the normal exchange
    const replay = await exchange(store, secret); // same token, second time

    assert.equal(replay.err.code, "REPLAY_DETECTED");
    for (const row of store.all()) {
      assert.ok(row.familyClosedAt, "every row in the chain must be revoked");
    }
  });

  it("refuses every exchange once the family is closed", async () => {
    const { secret } = await openFamily(store, 1);
    const next = await exchange(store, secret);
    await exchange(store, secret); // makes the next use a replay
    const after = await exchange(store, next.data.secret);
    assert.equal(after.err.code, "FAMILY_CLOSED");
  });
});

describe("closeFamily", () => {
  it("closes every row in the family", async () => {
    const { secret } = await openFamily(store, 1);
    await exchange(store, secret);

    assert.equal(await closeFamily(store, secret), true);
    for (const row of store.all()) {
      assert.ok(row.familyClosedAt);
    }
  });

  it("returns false when no row has this token", async () => {
    assert.equal(await closeFamily(store, "nope"), false);
  });

  // TODO: no test yet for a family that is already closed. A second call
  // should return false, since the return value tells the caller whether
  // this call was the one that closed it.
});
