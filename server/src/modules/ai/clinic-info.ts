/** Operational questions must bypass product matching and the language model. */
export function clinicInfoIntent(message: string): 'location' | 'hours' | 'contact' | null {
  const text = message.toLowerCase().replace(/[’]/g, "'").trim();
  const location =
    /\b(location|located)\b/.test(text) || /\b(your|clinic|store|shop|the)\s+address\b|^address\??$/.test(text) ||
    /\b(locate|find)\b[^?]*\b(your|the|this)\s+(store|shop|clinic|business|branch)\b/.test(text) ||
    /\b(find|locate)\s+(you|souvari)\b/.test(text) ||
    /\bwhere are you\b|\bwhere\b[^?]*\b(souvari|clinic|store|shop)\b/.test(text) ||
    /\b(get|go|come|travel)\s+(to\s+)?(there|your (clinic|store|shop)|the clinic|souvari)\b/.test(text) ||
    /\b(directions?|map|landmark)\s+(to|for|of|near)\s+(you|your|the clinic|souvari)\b/.test(text) ||
    /^(directions?|map|landmarks?)\??$/.test(text);
  // "Where do I store my serum?" asks about a product, not our physical store.
  if (location && !/\b(store|keep)\s+(my|a|the|this|your)\s+(serum|cream|products?|sunscreen|bottles?)\b/.test(text)) return 'location';
  if ((/\bhours?\b/.test(text) && /\b(your|clinic|business|opening|closing|operating|working|the hours)\b/.test(text)) ||
    /^(hours?|holiday)\??$/.test(text) || /\b(opening|closing)\b/.test(text) ||
    /\b(when|what time|are you)\b[^?]*\b(open|close|closed)\b/.test(text)) return 'hours';
  if ((/\b(contact|phone|telephone|mobile|call)\b/.test(text) &&
    /\b(you|your|clinic|souvari|contact|number)\b/.test(text)) || /^(phone|contact|number)\??$/.test(text)) return 'contact';
  return null;
}
