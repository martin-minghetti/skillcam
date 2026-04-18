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

export function scanAndRedact(text: string, location: string = "input"): ScanResult {
  const matches: SecretMatch[] = [];
  let redacted = text;

  for (const { type, regex } of PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    const found = text.matchAll(re);
    for (const m of found) {
      const value = m[0];
      matches.push({
        type,
        snippet: redactValue(value),
        location,
      });
    }
    redacted = redacted.replace(re, (match) => redactValue(match));
  }

  return { matches, redacted };
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
