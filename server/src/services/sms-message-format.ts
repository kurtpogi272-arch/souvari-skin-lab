/** Use the saved first-name field (including compound names), never a full-name split. */
export function smsFirstName(value?: string | null): string {
  return (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function buildSmsGreeting(firstName?: string | null): string {
  const name = smsFirstName(firstName);
  return name ? `Hi ${name}, this is Souvari Skin Lab.` : 'Hi, this is Souvari Skin Lab.';
}

/** Fit an optional note without splitting a Unicode surrogate pair. */
export function shortenSmsNote(text: string, maxUnits: number): string {
  if (maxUnits < 4) return '';
  if (text.length <= maxUnits) return text;
  let result = '';
  for (const character of text) {
    if (result.length + character.length > maxUnits - 3) break;
    result += character;
  }
  return `${result.trimEnd()}...`;
}
