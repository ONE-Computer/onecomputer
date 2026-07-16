/**
 * Multibase base58-btc encode/decode — minimal in-tree implementation.
 *
 * Used by the `eddsa-jcs-2022` Data Integrity cryptosuite to encode the
 * 64-byte Ed25519 signature (`proofValue`) and the 32+2-byte Multikey public
 * key (`publicKeyMultibase`). The multibase prefix `z` selects the base58-btc
 * alphabet (Bitcoin base58), per the W3C Controlled Identifiers v1.0 spec.
 *
 * Reference: https://www.w3.org/TR/vc-di-eddsa-1.1/ §2.2.1 — "encoded using
 * the base-58-btc header and alphabet".
 *
 * This is a deterministic byte encoding (not crypto): base58 is a well-known
 * big-integer-to-alphabet mapping. Implementing it here avoids the deprecated
 * `multibase` npm package and keeps the dependency surface minimal.
 */

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/**
 * Encode bytes as a multibase base58-btc string (prefixed with `z`).
 * `0x00`-leading bytes carry their leading-zero count as `1`-chars, per the
 * Bitcoin base58 convention.
 */
export const encodeBase58Btc = (bytes: Uint8Array): string => {
  // Count leading zeros.
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

  // Big-endian base58 conversion on the non-zero remainder. `num` holds the
  // big-integer in little-endian base-58 digit order; we accumulate each input
  // byte (big-endian) by multiplying the running value by 256 and adding the
  // byte, then carry-propagating in base 58.
  const input = bytes.slice(zeros);
  const num: number[] = [];
  for (const b of input) {
    let carry = b;
    for (let i = 0; i < num.length; i++) {
      carry += (num[i] ?? 0) * 256;
      num[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      num.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  const out: string[] = [];
  const zeroChar = ALPHABET[0] ?? "";
  for (let i = 0; i < zeros; i++) out.push(zeroChar);
  for (let i = num.length - 1; i >= 0; i--)
    out.push(ALPHABET[num[i] ?? 0] ?? "");

  return "z" + out.join("");
};

/**
 * Decode a multibase base58-btc string (`z`-prefixed) into raw bytes. Inverse
 * of `encodeBase58Btc`.
 */
export const decodeBase58Btc = (s: string): Uint8Array => {
  if (!s || s[0] !== "z") {
    throw new Error("multibase base58-btc string must be 'z'-prefixed");
  }
  const body = s.slice(1);

  let zeros = 0;
  const zeroChar = ALPHABET[0] ?? "";
  while (zeros < body.length && body[zeros] === zeroChar) zeros++;

  const lookup = (ch: string): number => {
    const idx = ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`invalid base58-btc char: ${ch}`);
    return idx;
  };

  // Big-integer decode into a little-endian byte array.
  const bytes: number[] = [];
  for (let i = 0; i < body.length; i++) {
    let carry = lookup(body[i] ?? "");
    for (let j = 0; j < bytes.length; j++) {
      carry += (bytes[j] ?? 0) * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Reverse (little-endian → big-endian) and prepend leading zeros.
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[zeros + bytes.length - 1 - i] = bytes[i] ?? 0;
  }
  return out;
};
