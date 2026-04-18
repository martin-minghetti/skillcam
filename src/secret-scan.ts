export interface SecretMatch {
  type: string;
  snippet: string;
  location: string;
}

interface Pattern {
  type: string;
  regex: RegExp;
}

const PATTERNS: Pattern[] = [
  { type: "anthropic-api-key", regex: /sk-ant-[a-zA-Z0-9_-]{20,}/g },
  { type: "openai-project-key", regex: /sk-proj-[a-zA-Z0-9_-]{20,}/g },
  { type: "openai-api-key", regex: /sk-[a-zA-Z0-9]{32,}/g },
  { type: "github-pat", regex: /gh[pousr]_[A-Za-z0-9]{36,}/g },
  { type: "github-fine-grained", regex: /github_pat_[A-Za-z0-9_]{80,}/g },
  { type: "google-api-key", regex: /AIza[0-9A-Za-z_-]{35}/g },
  { type: "aws-access-key", regex: /\b(?:AKIA|ASIA|AIDA|AGPA)[0-9A-Z]{16}\b/g },
  { type: "aws-secret-key", regex: /\baws_secret_access_key["'\s:=]+[A-Za-z0-9/+]{40}\b/gi },
  { type: "stripe-live-key", regex: /\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}\b/g },
  { type: "stripe-test-key", regex: /\b(?:sk|rk)_test_[0-9a-zA-Z]{24,}\b/g },
  { type: "slack-token", regex: /xox[baprs]-[0-9A-Za-z-]{10,}/g },
  { type: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { type: "pem-private-key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { type: "generic-password", regex: /\b(?:password|passwd|pwd)\s*[:=]\s*["']([^\s"']{8,})["']/gi },
];

function redactValue(value: string): string {
  if (value.length <= 8) return "[REDACTED]";
  return `[REDACTED:${value.slice(0, 4)}...${value.slice(-2)}]`;
}

export interface ScanResult {
  matches: SecretMatch[];
  redacted: string;
}

/**
 * Normalize text to defeat common scanner bypass classes (Sprint 2 / audit C2).
 *
 *  - B2 NFKC: fullwidth Unicode code points (e.g. `ｓｋ－ｐｒｏｊ－…`) are
 *    NFKC-equivalent to ASCII, so an LLM reads them as a normal secret even
 *    though the raw code points dodge a plain ASCII regex.
 *  - B3 Zero-width: U+200B/200C/200D/FEFF/00AD inserted between characters
 *    break the regex match but are ignored by the LLM tokenizer.
 *  - B4 URL-encoded: `%73%6b%2d%61%6e%74…` decodes back to `sk-ant…`. We try
 *    `decodeURIComponent` as best-effort; malformed input falls back to the
 *    post-stripped text.
 *  - B5 Unicode escape: `\u0073\u006b\u002d…` inside JSON strings — we expand
 *    these to their char equivalents.
 */
export function normalizeForScan(text: string): string {
  // B2 — fullwidth and other compatibility forms
  let out = text.normalize("NFKC");
  // B3 — strip zero-width space, joiner, non-joiner, BOM, and soft hyphen
  out = out.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "");
  // B4 — URL-decode; best effort, on malformed input keep the stripped text
  try {
    out = decodeURIComponent(out);
  } catch {
    // leave `out` as-is
  }
  // B5 — decode `\uXXXX` escape sequences (common inside JSON string literals)
  out = out.replace(/\\u([0-9A-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
  return out;
}

/**
 * Bonus — base64 heuristic (Sprint 2, audit C2 "nice-to-have").
 *
 * Looks for suspiciously long base64-ish substrings, attempts `atob`, and
 * re-scans the decoded payload with every pattern. Matches get a synthetic
 * type prefix (`base64-encoded-<original-type>`) so consumers can distinguish
 * them from direct matches.
 *
 * Trade-off: base64 is a common format for legitimate binary payloads (image
 * data-urls, cached JSON blobs, etc.), so false positives are possible. We
 * require min length 40 + length divisible by 4 to keep the noise manageable.
 */
function scanBase64Candidates(normalized: string, location: string): SecretMatch[] {
  const hits: SecretMatch[] = [];
  // match base64-alphabet runs of 40+ chars. We accept URL-safe variants too.
  // `=` is only allowed as trailing padding (at most 2) — otherwise it would
  // glue neighbouring non-base64 chars (e.g. `config=...`) into the match.
  const candidateRe = /[A-Za-z0-9+/_-]{40,}={0,2}/g;
  for (const m of normalized.matchAll(candidateRe)) {
    const candidate = m[0];
    // base64 standard alphabet is length % 4 === 0 (with = padding).
    // URL-safe base64 is sometimes unpadded; allow that too by also trying
    // length % 4 === 2 or 3 after padding.
    const core = candidate.replace(/[_-]/g, (c) => (c === "-" ? "+" : "/"));
    let padded = core;
    while (padded.length % 4 !== 0) padded += "=";
    let decoded: string;
    try {
      decoded = Buffer.from(padded, "base64").toString("utf8");
    } catch {
      continue;
    }
    // Basic sanity: decoded must be mostly-printable ASCII to avoid every
    // random long token being reported.
    const printable = decoded.replace(/[^\x20-\x7e]/g, "").length;
    if (printable / Math.max(decoded.length, 1) < 0.9) continue;
    // Now run the standard patterns over the decoded payload.
    for (const { type, regex } of PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      for (const inner of decoded.matchAll(re)) {
        hits.push({
          type: `base64-encoded-${type}`,
          snippet: redactValue(inner[0]),
          location,
        });
      }
    }
  }
  return hits;
}

/**
 * Scan `text` for secrets and return the matches plus a redacted version.
 *
 * IMPORTANT — Sprint 2 trade-off on redaction: we scan over a *normalized*
 * form of the text to defeat the bypass classes documented in
 * `normalizeForScan`. When matches are found, the `redacted` return is also
 * produced from the normalized text (we don't attempt to map offsets back to
 * the original byte stream, which would be fragile in the presence of
 * zero-width insertion, URL-encoding, fullwidth chars, etc.).
 *
 * In practice this means: if a secret is detected, the callers using the
 * `redact` policy will send the normalized-and-redacted text to the LLM, not
 * the original. That is the safe choice — the original bytes still contain
 * the obfuscated secret. When there are zero matches we return the original
 * text unchanged to preserve the user's output verbatim.
 */
export function scanAndRedact(text: string, location: string = "input"): ScanResult {
  const normalized = normalizeForScan(text);

  const matches: SecretMatch[] = [];
  let redacted = normalized;

  for (const { type, regex } of PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    const found = normalized.matchAll(re);
    for (const m of found) {
      matches.push({
        type,
        snippet: redactValue(m[0]),
        location,
      });
    }
    redacted = redacted.replace(re, (match) => redactValue(match));
  }

  // Bonus — base64 pre-scan. Run over normalized text so URL-encoded or
  // NFKC-wrapped base64 still gets caught.
  const b64Matches = scanBase64Candidates(normalized, location);
  matches.push(...b64Matches);
  // We do not rewrite the base64 substring in `redacted` — the decoded secret
  // is not literally present in the text, only its base64 form. Flagging in
  // `matches` is enough for abort/policy purposes.

  if (matches.length === 0) {
    // No matches: return the original text verbatim to preserve user output.
    return { matches, redacted: text };
  }

  return { matches, redacted };
}

/**
 * Scan `text` for secrets, then truncate to `maxLen` characters.
 *
 * Audit C2 / B1 fix: the old code path in `distiller-prompt.ts` did
 * `m.content.slice(0, 500)` *before* the scanner saw it. An attacker could
 * pad 495 chars of junk and tuck a real secret at position 496 so the slice
 * cut the secret below the regex min-length threshold. Scanning first and
 * truncating the result ensures detection regardless of where in the field
 * the secret sits.
 */
export function scanAndRedactTruncate(
  text: string,
  maxLen: number,
  location: string = "input"
): ScanResult {
  const { matches, redacted } = scanAndRedact(text, location);
  return {
    matches,
    redacted: redacted.slice(0, maxLen),
  };
}

export function summarize(matches: SecretMatch[]): string {
  if (matches.length === 0) return "";
  const byType = new Map<string, number>();
  for (const m of matches) {
    byType.set(m.type, (byType.get(m.type) ?? 0) + 1);
  }
  return Array.from(byType.entries())
    .map(([type, count]) => `  - ${type}: ${count}`)
    .join("\n");
}
