/** Deterministic last line of defence before conversation text becomes durable
 * compact memory or leaves the box for the RAG index. This intentionally keeps
 * service/account names while replacing credential values. */

const REDACTED = '[redacted secret]';
const REDACTED_SENTINEL = 'RIVENDELL_REDACTED_SECRET_VALUE';

function preserveFence(value: string): string {
  if (value.startsWith('`') && value.endsWith('`')) return `\`${REDACTED}\``;
  if (value.startsWith('"') && value.endsWith('"')) return `"${REDACTED}"`;
  if (value.startsWith("'") && value.endsWith("'")) return `'${REDACTED}'`;
  return REDACTED;
}

function redactOpaqueToken(token: string, offset: number, source: string): string {
  // A 64-char hex string is a credential unless nearby context positively
  // identifies a checksum/object digest. Ordinary 40-char Git SHAs never
  // reach this matcher; they remain useful references by default.
  const context = source.slice(Math.max(0, offset - 96), offset);
  if (/(?:\b(?:commit|sha(?:-?256)?|checksum|digest|git hash|object hash|revision|rev)\b\s*(?::|=|is|was|at)?\s*|\/commit\/)$/i.test(context)) {
    return token;
  }
  return REDACTED;
}

/** Redact common credentials in prose, Markdown, env assignments, JSON/YAML,
 * command lines, URLs, and pasted key material. Idempotent by design. */
export function redactSecrets(text: string): string {
  if (!text) return text;

  let out = text
    .replace(/\[redacted secret\]/gi, REDACTED_SENTINEL)
    .replace(
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
      '[redacted private key]',
    )
    // Header values are opaque and may use arbitrary schemes or contain many
    // semicolon-delimited cookies. Redact the entire remainder of the line;
    // token-shaped matching alone is not safe for short credentials.
    .replace(
      /(\b(?:authorization|proxy-authorization|cookie|set-cookie)\b["']?\s*:\s*)[^\r\n]*/gi,
      (_all, prefix: string) => `${prefix}${REDACTED}`,
    )
    .replace(
      /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/?#@]+:)[^\s/@?#]+(@)/gi,
      `$1${REDACTED}$2`,
    )
    .replace(
      /([?&#](?:x-amz-(?:signature|credential|security-token)|x-goog-(?:signature|credential)|awsaccesskeyid|signature|sig|token|access_token|auth|api_key|apikey|key|secret|password|code)=)[^&#\s]*/gi,
      `$1${REDACTED}`,
    )
    .replace(/\b(Bearer|Basic)(\s+)[A-Za-z0-9._~+/=-]{8,}/gi, (_all, scheme: string, gap: string) => `${scheme}${gap}${REDACTED}`)
    .replace(
      /(\b(?:[A-Z][A-Z0-9_]*_)?(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|PASSCODE|PASS|PWD|COOKIE|CREDENTIAL)(?:_[A-Z0-9_]+)*\s*=\s*)(`[^`\r\n]+`|"[^"\r\n]+"|'[^'\r\n]+'|[^\r\n]+)/gi,
      (_all, prefix: string, value: string) => `${prefix}${preserveFence(value)}`,
    )
    .replace(
      /(\b(?:password|passcode|passwd|pwd|api[_ -]?key|access[_ -]?token|auth(?:entication|orization)?[_ -]?token|bearer token|client[_ -]?secret|refresh[_ -]?token|private[_ -]?key|credential|cookie|session token|otp|one[- ]time (?:password|code)|verification code|recovery code)\b[^:\r\n=]{0,80}(?::|=)\s*)(`[^`\r\n]+`|"[^"\r\n]+"|'[^'\r\n]+'|[^\s,;]+)/gi,
      (_all, prefix: string, value: string) => `${prefix}${preserveFence(value)}`,
    )
    .replace(
      /(\b(?:password|passcode|passwd|pwd|api[_ -]?key|access[_ -]?token|auth(?:entication|orization)?[_ -]?token|bearer token|client[_ -]?secret|refresh[_ -]?token|private[_ -]?key|credential|session token|otp|one[- ]time (?:password|code)|verification code|recovery code)\b\s+(?:is|was)\s+)(`[^`\r\n]+`|"[^"\r\n]+"|'[^'\r\n]+'|[^\s,;]+)/gi,
      (_all, prefix: string, value: string) => `${prefix}${preserveFence(value)}`,
    )
    .replace(
      /((?:--?)(?:(?:api-?)?key|token|secret|password))(=|\s+)(`[^`\r\n]+`|"[^"\r\n]+"|'[^'\r\n]+'|[^\s,;]+)/gi,
      (_all, flag: string, separator: string, value: string) => `${flag}${separator}${preserveFence(value)}`,
    )
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted jwt]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED)
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, REDACTED)
    .replace(/\b(?:sk-(?:live|test)-|sk_|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|dop_v1_|dpl_|rk_|sbp_)[A-Za-z0-9_=-]{12,}\b/gi, REDACTED);

  out = out.replace(
    /\b[A-Za-z0-9+/_=-]{64,}\b/g,
    (token: string, offset: number, source: string) => redactOpaqueToken(token, offset, source),
  );
  return out.replaceAll(REDACTED_SENTINEL, REDACTED);
}
