// Settings for the token module.
//
// TOKEN_PEPPER is a server-side secret folded into every stored digest. Unlike
// a salt, which lives next to each row, the pepper lives only in the process
// environment, so a copy of the token table alone is not enough to check a
// guessed token against it: the attacker also needs the pepper.
//
// A stand-in value is committed so the project runs straight after cloning.
// Anywhere other than local development must supply its own TOKEN_PEPPER;
// `requireRealPepper()` refuses to start when the stand-in is still in place.

export const LOCAL_PEPPER_STANDIN =
  "local-dev-only::pepper-grinder-standin::set-TOKEN_PEPPER-before-deploying";

export const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function readPepper() {
  const value = process.env.TOKEN_PEPPER ?? LOCAL_PEPPER_STANDIN;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("TOKEN_PEPPER is empty; set it or unset it to use the local stand-in");
  }
  return value;
}

export function readTtlMs() {
  const raw = process.env.TOKEN_TTL_MS;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_MS;
}
