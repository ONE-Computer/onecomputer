/**
 * JSON Canonicalization Scheme (RFC 8785) — minimal in-tree implementation.
 *
 * Used by the eddsa-jcs-2022 Data Integrity cryptosuite (see
 * `vti-credential-signer.ts`) to produce a deterministic byte serialization of
 * a JSON document prior to SHA-256 hashing and Ed25519 signing.
 *
 * This is NOT a custom crypto primitive: it is the deterministic
 * serialization mandated by RFC 8785 (sort object keys by UTF-16 code unit,
 * serialize numbers with minimal representation, RFC 8785 string escaping, no
 * insignificant whitespace). The signature itself is delegated to
 * `@noble/ed25519` (audited, audited Rust port).
 *
 * Reference: https://www.w3.org/TR/vc-di-eddsa-1.1/ (eddsa-jcs-2022 suite
 * Section 3.3 explicitly calls for "the JSON Canonicalization Scheme [RFC8785]").
 */

// ─── RFC 8785 string escaping ─────────────────────────────────────────────────
// Control chars and the mandatory-escape set. RFC 8785 §3.2.3.
const ESCAPE_MAP: Record<string, string> = {
  '"': '\\"',
  "\\": "\\\\",
  "\b": "\\b",
  "\f": "\\f",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
};

/**
 * Escape a JS string per RFC 8785 §3.2.3. Control characters < 0x20 are emitted
 * as lower-case `\u00XX`. The 8 mandatory escapes go through `ESCAPE_MAP`.
 * Non-ASCII printable code points pass through verbatim (the JCS consumer is
 * expected to handle UTF-8 bytes downstream — `Buffer.from(str, "utf8")`).
 */
const escapeString = (s: string): string => {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? "";
    const code = ch.charCodeAt(0);
    const escaped = ch !== "" ? ESCAPE_MAP[ch] : undefined;
    if (escaped !== undefined) {
      out += escaped;
    } else if (code < 0x20) {
      out += "\\u" + code.toString(16).padStart(4, "0").toLowerCase();
    } else {
      out += ch;
    }
  }
  return out;
};

// ─── Number serialization (RFC 8785 §3.2.2.3) ─────────────────────────────────
//
// JCS requires the *shortest* round-trip representation of a number. JS's
// `Number.prototype.toString()` already yields the shortest round-trip form for
// IEEE-754 doubles (ECMAScript ToString on numbers uses the shortest
// representation that round-trips, per the spec since ES2018 / V8's
// implementation of David Gay's grisu + shortest). Two special cases:
// integer-valued numbers must not carry a trailing ".0", and -0 serializes as
// "0" (JCS treats -0 as equal to 0 for serialization; ECMAScript's
// String(-0) === "0" already does the right thing). NaN/Infinity are not
// representable in JSON and must be rejected upstream (we throw below).
const serializeNumber = (n: number): string => {
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    throw new Error(
      "JCS: NaN and Infinity are not representable in canonical JSON (RFC 8785)",
    );
  }
  // `String(n)` yields the shortest round-trip representation. For integer
  // values it never appends ".0"; for very large/small magnitudes it uses
  // exponential notation in the *minimum-exponent* form JCS requires
  // (e.g. 1e+21 → "1e+21"). ECMAScript's scientific form matches RFC 8785's
  // required form for the magnitudes that can occur in a VC payload.
  return String(n);
};

// ─── Key sorting (RFC 8785 §3.2.3) ────────────────────────────────────────────
//
// Keys are sorted by UTF-16 code unit (i.e. the JS `<` on strings), NOT by
// Unicode scalar value / code point. RFC 8785 §3.2.3 is explicit: "the key
// sorting is performed using a UTF-16 code unit comparison". `Array.prototype.sort`
// with the default lexicographic comparator on strings does exactly this.
const sortedKeys = (obj: Record<string, unknown>): string[] =>
  Object.keys(obj).sort();

// ─── Recursive serializer ─────────────────────────────────────────────────────
const serializeValue = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "null"; // JSON drops undefined; treat as null.

  const t = typeof value;
  switch (t) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value as number);
    case "string":
      return '"' + escapeString(value as string) + '"';
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map(serializeValue).join(",") + "]";
      }
      // Plain object. (We do not handle class instances; VC payloads are
      // JSON-native POJOs from JSON.parse, so this is sufficient.)
      const obj = value as Record<string, unknown>;
      const keys = sortedKeys(obj);
      const members = keys.map(
        (k) => '"' + escapeString(k) + '":' + serializeValue(obj[k]),
      );
      return "{" + members.join(",") + "}";
    }
    default:
      throw new Error(`JCS: unsupported value of type ${t}`);
  }
};

/**
 * Canonicalize a JSON-serializable value per RFC 8785 and return its UTF-8
 * byte representation. This is what `eddsa-jcs-2022` hashes with SHA-256.
 */
export const canonicalizeJson = (value: unknown): Uint8Array => {
  const serialized = serializeValue(value);
  return Buffer.from(serialized, "utf8");
};
