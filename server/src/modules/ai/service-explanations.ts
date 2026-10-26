import { detectTreatmentInfo } from './clinic-faq';
import { firstSentence } from './reply-style';
import { ChatService, serviceKnowledge, serviceLabel, servicePrice, SERVICE_SOURCES } from './service-knowledge';

/** An explanation request is different from asking us to choose a treatment. */
export function wantsServiceExplanation(message: string): boolean {
  return /\b(tell me about|explain|describe|give me (?:some |more )?(?:details|information)|overview of|details about)\b/i.test(message) &&
    !/\b(recommend|suggest|best for|which should i)\b/i.test(message);
}

export function explainNamedService(service: ChatService, question: string): string {
  const knowledge = serviceKnowledge(service);
  const purpose = knowledge.concerns.length
    ? `Generally discussed for ${knowledge.concerns.join(', ')}.`
    : 'Our team needs to confirm the specific benefits and intended use for this option.';
  const lines = [
    `Service: ${serviceLabel(service)}`,
    `What it is: ${firstSentence(knowledge.summary)}`,
    `What it's for: ${purpose}`,
  ];
  if (/\b(price|pricing|cost|how much|fees?)\b/i.test(question)) lines.push(servicePrice(service));
  if (/\b(duration|how long|minutes)\b/i.test(question)) lines.push(`Appointment length: ${service.duration_minutes} minutes.`);
  if (knowledge.consultationRequired) lines.push('Our clinician can confirm the details and whether it suits you.');
  return lines.join('\n');
}

/** Canonicalize a small, explicit vocabulary; do not rewrite arbitrary product names. */
export function isSkinRejuvenationExplanation(message: string): boolean {
  const text = message.toLowerCase().replace(/[_-]+/g, ' ')
    .replace(/\brejuv[ei]nat(?:ion|ing|e)\b/g, 'rejuvenation');
  if (!/\bskin\s+rejuvenation\b/.test(text)) return false;
  if (/\b(products?|creams?|serums?|sets?|ingredients?)\b/.test(text)) return false;
  if (detectTreatmentInfo(text)) return false;
  if (/\b(recommend|suggest|best for|which should i)\b/.test(text)) return false;
  const explanation = wantsServiceExplanation(text) || /\b(what is|what does .+ mean|what are)\b/.test(text);
  if (/\b(price|pricing|cost|how much|fees?)\b/.test(text) && !wantsServiceExplanation(text)) return false;
  return explanation;
}

export function explainSkinRejuvenation(services: ChatService[]): { response: string; discussed: ChatService[] } {
  const nonBundle = (s: ChatService) => !/\b(?:\d+\s*(?:sess|sessions)|package|bundle)\b/i.test(s.name);
  const faceArea = (s: ChatService) => /\b(face|facial|jaw|chin|cheek|eye|neck)\b/i.test(s.name);
  const eligible = services.filter((s) => nonBundle(s) && !/\b(test|removal|wax|whitening)\b/i.test(s.name));
  const hydration = eligible.find((s) => serviceKnowledge(s).sources.includes(SERVICE_SOURCES.facial));
  const rf = eligible.find((s) => faceArea(s) && /radio-frequency|rf-7/.test(s.group?.slug ?? ''));
  const ultrasoundOptions = eligible.filter((s) => faceArea(s) && /ultratight-hifu|ultratight-3/.test(s.group?.slug ?? ''));
  const ultrasound = ultrasoundOptions.find((s) => /full face/i.test(s.name)) ?? ultrasoundOptions[0];
  const discussed = [hydration, rf, ultrasound].filter((s): s is ChatService => !!s);
  const examples = discussed.length
    ? discussed.map((s) => `- ${serviceLabel(s)}: ${firstSentence(serviceKnowledge(s).summary)}`).join('\n')
    : 'I do not have a confirmed matching service list on file yet. Our team can explain the available options.';
  return {
    response: [
      'What it is:',
      'Skin rejuvenation is a broad term for cosmetic treatments that aim to improve the appearance of skin. It is not one specific procedure.',
      '',
      "What it's for:",
      'Depending on the method, the focus may be hydration, dullness, uneven-looking texture, or firmness. These methods have different purposes and are not interchangeable.',
      '',
      'Services at Souvari:',
      examples,
    ].join('\n'),
    discussed,
  };
}
