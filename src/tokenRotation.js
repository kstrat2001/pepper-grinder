import crypto from "node:crypto";
import {
  LOCAL_PEPPER_STANDIN,
  readTtlMs,
  readPepper,
} from "./config.js";

/**
 * Single-use tokens that are exchanged for a new one on every use.
 *
 * Each stored row keeps a digest of the token (SHA-256 of the token followed
 * by the pepper) and a familyId shared by every token descended from one
 * sign-in. An exchange happens in one transaction: the presented row is
 * marked retired and its successor is written.
 *
 * Presenting a token that was already exchanged closes its whole family.
 * Whoever sent it is either the real client repeating itself or someone
 * holding a copy, and the server cannot tell them apart, so neither keeps
 * the family.
 */

/**
 * Call at startup. Throws if the committed stand-in pepper is in use outside
 * local development.
 *
 * A missing NODE_ENV counts as "not development": the stand-in is public, so
 * an environment that has not declared itself is treated as one that must
 * not use it.
 */
export function requireRealPepper() {
  const pepper = readPepper(); // throws when missing or empty
  const env = process.env.NODE_ENV;
  const inDevMode = env === "development";
  if (!inDevMode && pepper === LOCAL_PEPPER_STANDIN) {
    const reason =
      env == null
        ? "NODE_ENV is not set (set NODE_ENV=development for local work)"
        : `NODE_ENV is '${env}'`;
    throw new Error(
      `the committed stand-in pepper cannot be used here: ${reason}. ` +
        "Provide TOKEN_PEPPER for this environment.",
    );
  }
}

/** Same input, same digest: a presented token is found by its digest alone. */
export function digestSecret(secret) {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error("expected a non-empty token string");
  }
  return crypto
    .createHash("sha256")
    .update(secret + readPepper())
    .digest("hex");
}

export function mintSecret() {
  return crypto.randomBytes(32).toString("hex");
}

/** Start a new family at sign-in and return the first token to hand to the client. */
export async function openFamily(store, ownerId, now = new Date()) {
  if (!Number.isInteger(ownerId) || ownerId <= 0) {
    throw new Error("owner must be a positive integer id");
  }
  const secret = mintSecret();
  const familyId = crypto.randomUUID();
  const expiry = new Date(now.getTime() + readTtlMs());
  store.insert({ digest: digestSecret(secret), familyId, ownerId, expiry });
  return { secret, familyId, expiry };
}

/**
 * Trade a presented token for its successor.
 *
 * Order of checks, inside one transaction:
 *   - take the row lock for this digest, so two exchanges of the same token
 *     run one after the other
 *   - family already closed            -> FAMILY_CLOSED
 *   - this token already retired       -> REPLAY_DETECTED, and the family is closed
 *   - owner given and different        -> OWNER_MISMATCH
 *   - expiry absent or not a real date -> EXPIRED_TOKEN
 *   - otherwise write the successor and retire this row
 *
 * The lock matters because the retired check and the write are separate
 * steps. Two exchanges racing without it could both see the row as live and
 * both write a successor, leaving the family with two usable tokens, and a
 * later replay of either would no longer be caught.
 */
export async function exchange(store, secret, claimedOwner) {
  if (typeof secret !== "string" || secret.length === 0) {
    return { err: { code: "UNKNOWN_TOKEN" } };
  }
  // The token is already known to be a non-empty string, so digestSecret can
  // only fail here if the pepper is misconfigured. That error is allowed to
  // escape: answering UNKNOWN_TOKEN would make a server fault look like a bad
  // token from the client.
  const digest = digestSecret(secret);

  return store.transaction(async (trx) => {
    const row = await trx.lockByDigest(digest);
    if (!row) return { err: { code: "UNKNOWN_TOKEN" } };

    // Read the clock once. Every check and write below uses this value, so a
    // transaction that runs slowly still sees one consistent time.
    const now = new Date();

    if (row.familyClosedAt) return { err: { code: "FAMILY_CLOSED" } };

    if (row.retiredAt) {
      trx.updateByFamily(row.familyId, { familyClosedAt: now });
      return { err: { code: "REPLAY_DETECTED" } };
    }

    if (
      typeof claimedOwner === "number" &&
      claimedOwner > 0 &&
      row.ownerId !== claimedOwner
    ) {
      return { err: { code: "OWNER_MISMATCH" } };
    }

    // Treat anything that does not parse as a date in the future as expired:
    // absent, null, an unparseable string, or a non-date value. Depending on
    // the database driver, expiry may come back as a Date or as a string, and
    // a value that silently fails to parse must not become a token that never
    // expires.
    if (!row.expiry) return { err: { code: "EXPIRED_TOKEN" } };
    const expiryMs = new Date(row.expiry).getTime();
    if (!Number.isFinite(expiryMs) || expiryMs <= now.getTime()) {
      return { err: { code: "EXPIRED_TOKEN" } };
    }

    const nextSecret = mintSecret();
    const nextDigest = digestSecret(nextSecret);
    const nextExpiry = new Date(now.getTime() + readTtlMs());

    trx.insert({
      digest: nextDigest,
      familyId: row.familyId,
      ownerId: row.ownerId,
      expiry: nextExpiry,
    });
    trx.updateByDigest(digest, {
      retiredAt: now,
      successorDigest: nextDigest,
    });

    return {
      data: {
        secret: nextSecret,
        familyId: row.familyId,
        expiry: nextExpiry,
        ownerId: row.ownerId,
      },
    };
  });
}

/**
 * Sign-out: close the family the presented token belongs to.
 *
 * Returns true only when this call did the closing. A token that matches no
 * row, or whose family was already closed, returns false.
 */
export async function closeFamily(store, secret) {
  if (typeof secret !== "string" || secret.length === 0) return false;
  let digest;
  try {
    digest = digestSecret(secret);
  } catch {
    return false;
  }
  const row = store.findByDigest(digest);
  if (!row || row.familyClosedAt) return false;
  store.updateByFamily(row.familyId, { familyClosedAt: new Date() });
  return true;
}
