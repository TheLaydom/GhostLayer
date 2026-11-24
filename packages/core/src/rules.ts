export type RuleCategory =
  | 'EMAIL' | 'PHONE' | 'IP_ADDRESS' | 'API_KEY' | 'AUTH_TOKEN' | 'PRIVATE_KEY'
  | 'CONNECTION_STRING' | 'PASSWORD' | 'FILE_PATH' | 'CREDIT_CARD' | 'ENV'
  | 'INTERNAL_URL' | 'SSN';

type Rule = readonly [RuleCategory, RegExp, ((value: string) => boolean)?];

function passesLuhn(value: string): boolean {
  const digits = value.replace(/[ -]/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    const digit = Number(digits[i]);
    const doubled = (digits.length - i) % 2 === 0 ? digit * 2 : digit;
    sum += doubled > 9 ? doubled - 9 : doubled;
  }
  return sum % 10 === 0;
}

function isIPv6(value: string): boolean {
  const [address, zone, extra] = value.split('%');
  if (extra !== undefined || zone === '' || (zone && !/^[\w.-]+$/.test(zone))) return false;
  const halves = address.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap(half => half ? half.split(':') : []);
  let units = 0;
  for (const [index, group] of groups.entries()) {
    if (/^[\da-f]{1,4}$/i.test(group)) {
      units++;
    } else {
      const bytes = group.split('.');
      if (index !== groups.length - 1 || !address.endsWith(group) || bytes.length !== 4 ||
          bytes.some(byte => !/^(?:0|[1-9]\d{0,2})$/.test(byte) || Number(byte) > 255)) return false;
      units += 2;
    }
  }
  return halves.length === 2 ? units < 8 : units === 8;
}

function hasTokenEntropy(value: string): boolean {
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[_+\/=-]/];
  if (classes.filter(pattern => pattern.test(value)).length < 3) return false;
  const frequencies = new Map<string, number>();
  for (const character of value) frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy >= 3.5;
}

const rules: readonly Rule[] = [
  ['PRIVATE_KEY', /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]{0,40}PRIVATE KEY-----/g],
  ['CONNECTION_STRING', /\b[a-z][a-z0-9+.-]{0,15}:\/\/[^\s\/:@]{1,160}:[^\s\/@]{1,160}@[^\s<>"']+/gi],
  ['API_KEY', /(?<![\w-])(?:(?:AKIA|ASIA)[A-Z0-9]{16}|(?:AIza|sk-(?:proj-)?)[A-Za-z0-9_-]{16,})(?![\w-])/g],
  ['AUTH_TOKEN', /(?<![\w-])(?:(?:gh[pousr]_|github_pat_)[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}|Bearer[ \t]+[A-Za-z0-9._~+\/=-]{8,})(?![\w-])/g],
  ['PASSWORD', /\b(?:password|passwd|api[_-]?key|access[_-]?token|secret)[ \t]*[:=][ \t]*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi],
  ['ENV', /(?<![\w-])(?:[A-Z_][A-Z0-9_]*|password|passwd|api[_-]?key|access[_-]?token|secret)[ \t]*=[ \t]*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/g],
  ['FILE_PATH', /(?:\b[A-Z]:[\\/]Users[\\/][^\\/\r\n<>:"|?*]+(?:[\\/][^\s<>:"|?*]+)?|\/(?:home|Users)\/[^\/\s<>"']+(?:\/[^\s<>"']+)?)/gi],
  ['EMAIL', /(?<![\p{L}\p{N}_.%+-])[\p{L}\p{N}_.%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.[\p{L}]{2,}(?![\p{L}\p{N}-])/gu],
  ['CREDIT_CARD', /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g, passesLuhn],
  ['SSN', /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g],
  ['PHONE', /(?<![\w.])(?:\+\d{1,3}[ .-]?(?:\(\d{2,4}\)|\d{2,4})(?:[ .-]?\d{2,4}){2,3}|(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\d{3})[ .-]?\d{3}[ .-]?\d{4})(?!\w|[ .-]\d)/g],
  ['INTERNAL_URL', /\bhttps?:\/\/(?:localhost|[a-z\d-]+(?:\.[a-z\d-]+)*\.(?:internal|local|corp))(?::\d+)?(?:[/?#][^\s<>"']*)?(?![\w.-])/gi],
  ['IP_ADDRESS', /(?<![\w:.])(?=[\da-f:.]{0,48}:)[\da-f:.]{1,48}[\da-f:](?:%[\w.-]{1,64})?(?![\w:]|\.[\da-f])/gi, isIPv6],
  ['IP_ADDRESS', /(?<![\w.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?!\w|\.\d)/g],
  ['AUTH_TOKEN', /(?<![A-Za-z0-9_+\/=-])[A-Za-z0-9_+\/=-]{24,}(?![A-Za-z0-9_+\/=-])/g, hasTokenEntropy],
];

export function ruleMatches(text: string, enabled: Readonly<Record<string, boolean>> | undefined) {
  return rules.flatMap(([type, pattern, validate]) => {
    if (enabled?.[type] === false) return [];
    return Array.from(text.matchAll(pattern))
      .filter(match => !validate || validate(match[0]))
      .map(match => ({
        type, start: match.index!, end: match.index! + match[0].length,
        confidence: 1, source: 'rule' as const,
      }));
  });
}
