export function normalizeNumber(value: string): string {
  const trimmed = (value || "").trim();
  const digits = [...trimmed].filter((character) => /\d/.test(character)).join("");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  throw new Error("Use a valid phone number, preferably in E.164 format (for example +15551234567).");
}

export function utcNow(): string {
  return new Date().toISOString();
}
