/** Keep recorded facts intact instead of cutting a sentence in half with "...". */
export function firstSentence(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim() ?? text;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** Convert a stored field into a sentence without inventing a new product claim. */
export function productFact(name: string, value: string): string {
  const fact = firstSentence(value);
  if (/^used (?:on the skin )?to (?:help )?/i.test(fact)) {
    const action = fact.replace(/^used (?:on the skin )?to (?:help )?/i, '').replace(/(\band)\s+to\s+/gi, '$1 ');
    return `${name} helps ${action}`;
  }
  if (/^used\b/i.test(fact)) return `${name} is ${fact.charAt(0).toLowerCase()}${fact.slice(1)}`;
  if (/^commonly used to (?:help )?/i.test(fact)) return `${name} can help ${fact.replace(/^commonly used to (?:help )?/i, '')}`;
  if (/^(supports?|helps?|hydrates?|moisturi[sz]es?|soothes?|provides?|protects?|adds?|reduces?)\b/i.test(fact)) return `${name} ${fact.charAt(0).toLowerCase()}${fact.slice(1)}`;
  if (/^(a|an)\b/i.test(fact)) return `${name} is ${fact.charAt(0).toLowerCase()}${fact.slice(1)}`;
  return `${name}: ${fact}`;
}
