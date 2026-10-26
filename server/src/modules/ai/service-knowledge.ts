/**
 * General educational descriptions, researched 2026-10-25. These describe a
 * treatment family, NOT a claim that the clinic owns a particular branded device
 * or follows a manufacturer's complete protocol. Prices/inclusions stay in DB.
 */
import { detectTreatmentInfo } from './clinic-faq';
import { firstSentence } from './reply-style';

export const SERVICE_SOURCES = {
  hair: 'https://www.aad.org/public/cosmetic/hair-removal/laser-hair-removal-overview',
  contour: 'https://www.fda.gov/medical-devices/aesthetic-cosmetic-devices/non-invasive-body-contouring-technologies',
  facial: 'https://www.hydrafacial.com/',
  peel: 'https://www.aad.org/public/cosmetic/younger-looking/chemical-peels-overview',
  botox: 'https://www.aad.org/public/cosmetic/wrinkles/botulinum-toxin-overview',
  needles: 'https://www.fda.gov/medical-devices/aesthetic-cosmetic-devices/microneedling-devices',
  nails: 'https://www.fda.gov/cosmetics/cosmetic-products/nail-care-products',
  eyes: 'https://www.fda.gov/cosmetics/cosmetic-products/eye-cosmetic-safety',
  pmu: 'https://www.fda.gov/cosmetics/cosmetic-products/tattoos-permanent-makeup-fact-sheet',
} as const;

export interface ChatService {
  id: number;
  name: string;
  description: string | null;
  category: string;
  price: unknown;
  duration_minutes: number;
  vip_price?: unknown;
  non_member_price?: unknown;
  treatment_type?: string | null;
  inclusions?: unknown;
  group?: { slug: string; name: string } | null;
  variants?: Array<{ label: string; variant_key: string; duration_minutes: number | null }>;
  packages?: { sessions_included: number; inclusions: unknown } | null;
}

export interface ServiceKnowledge {
  summary: string;
  concerns: string[];
  sources: string[];
  provenance: 'clinic-description' | 'general-reference' | 'catalog-label' | 'needs-confirmation';
  consultationRequired: boolean;
}

export function conciseText(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const sentence = clean.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (sentence && sentence.length <= max) return sentence;
  const words = clean.slice(0, max - 3).replace(/\s+\S*$/, '');
  return `${words}...`;
}

function entry(summary: string, concerns: string[], source?: string, consultationRequired = false): ServiceKnowledge {
  return { summary, concerns, sources: source ? [source] : [], provenance: source ? 'general-reference' : 'catalog-label', consultationRequired };
}

export function serviceKnowledge(service: Pick<ChatService, 'name' | 'category' | 'description'> & Partial<ChatService>): ServiceKnowledge {
  const name = service.name.toLowerCase();
  const group = service.group?.slug ?? '';
  const doctor = group === 'doctors-procedures' || /\b(botox|injection|injectable|tirzepatide|infusion|exosome|pdrn|rejuran|lipolysis|threads?)\b/.test(name);
  let knowledge: ServiceKnowledge;

  // Group metadata is essential: "Abdomen" occurs under several different technologies.
  if (['diode-laser', 'diode-7-sessions'].includes(group) || /diode|laser hair removal/.test(name) || service.category === 'hair_removal') {
    knowledge = entry('Laser hair removal targets unwanted hair to reduce regrowth in the named treatment area; results and the session plan vary.', ['unwanted hair', 'hair removal', 'shaving'], SERVICE_SOURCES.hair);
  } else if (['ultratight-hifu', 'ultratight-3'].includes(group) || /\bhifu\b/.test(name)) {
    knowledge = entry('Focused ultrasound treatments use sound-wave energy for cosmetic tightening or contouring of the named area. The effect depends on the device and treatment plan.', ['loose skin', 'firming', 'contouring', 'sagging'], SERVICE_SOURCES.contour);
  } else if (['radio-frequency', 'rf-7-sessions'].includes(group) || /\brf\b|radiofrequency|radio frequency/.test(name)) {
    knowledge = entry('Radiofrequency treatments use controlled heating for cosmetic tightening and contouring; improvements may be temporary and depend on the treated area.', ['loose skin', 'firming', 'contouring', 'cellulite'], SERVICE_SOURCES.contour);
  } else if (/\b(botox|botulinum)\b/.test(name)) {
    knowledge = entry('Botulinum toxin relaxes targeted muscles and is used for certain expression lines; some clinician-directed uses address excessive sweating.', ['expression lines', 'fine lines'], SERVICE_SOURCES.botox, true);
  } else if (/microneedling|dermapen/.test(name)) {
    knowledge = entry('Microneedling uses fine needles to create controlled punctures and may improve the appearance of acne scars and wrinkles after professional assessment.', ['acne scars', 'texture', 'fine lines'], SERVICE_SOURCES.needles, true);
  } else if (group === 'doctors-procedures' || doctor) {
    // Proprietary mixtures, doses and marketing names do not establish efficacy or formulation.
    const purpose = /lipolysis|fat dissolving|contouring/.test(name) ? 'localized body or facial contouring'
      : /tirzepatide|metabolic/.test(name) ? 'clinician-supervised weight-management discussion'
      : /thread/.test(name) ? 'cosmetic lifting or shaping of the named area'
      : /pimple/.test(name) ? 'clinician assessment of individual inflamed blemishes'
      : /scar|rejuran s/.test(name) ? 'the appearance of scars'
      : /scalp|hair/.test(name) ? 'scalp and hair concerns'
      : /under.?eye|rejuran i/.test(name) ? 'under-eye appearance'
      : /underarm|axillary/.test(name) ? 'underarm appearance'
      : /lip revitalization/.test(name) ? 'lip appearance'
      : /infusion|vitamin|booster|lumiere|l-carnitine|placenta|alpha lipoic|nad\+/.test(name) ? 'an IV infusion or booster consultation'
      : 'skin appearance and rejuvenation';
    knowledge = entry(`The catalog lists this procedure for ${purpose}. Its formulation, expected benefits and suitability must be confirmed by a clinician; the listing alone does not establish results.`, [], undefined, true);
  } else if (group === 'permanent-makeup' || /microblading|micropigmentation|powder brows|machine brows|combi brows|\bpmu\b/.test(name)) {
    knowledge = /tattoo removal/.test(name)
      ? entry('This appointment concerns removal of existing brow tattoo pigment; the technique and likely outcome need a professional assessment.', ['brow tattoo removal'], SERVICE_SOURCES.pmu, true)
      : entry('Permanent makeup places pigment in the skin to enhance the appearance of brows, eyeliner or lips; touch-up entries maintain or adjust existing pigment.', ['brow definition', 'lip color', 'eyeliner'], SERVICE_SOURCES.pmu);
  } else if (group === 'lashes-brows' || /eyelash|lash lift|brow lamination/.test(name)) {
    knowledge = entry(/removal/.test(name)
      ? 'This service removes existing eyelash extensions; the clinic can confirm the removal method.'
      : 'This cosmetic service changes lash or brow appearance through the lift, tint, lamination or extension option named in the listing.', ['lash appearance', 'brow grooming'], SERVICE_SOURCES.eyes);
  } else if (['nail-essential', 'nail-gel', 'nail-extensions'].includes(group) || /manicure|pedicure|\bbiab\b|nail|polish|dual form/.test(name)) {
    knowledge = entry(/removal/.test(name)
      ? 'This service removes the gel, polish or nail enhancement named in the listing; it is not a nail-disease treatment.'
      : /repair/.test(name)
        ? 'This cosmetic repair addresses the nail or enhancement named in the listing; it is not treatment for infection or nail disease.'
        : 'This is a cosmetic nail-grooming or nail-enhancement service; the listing identifies manicure, pedicure, polish, extension or add-on type.', ['nail grooming', 'nail appearance'], SERVICE_SOURCES.nails);
  } else if (group === 'threading' || /threading/.test(name)) {
    knowledge = entry('Threading is a cosmetic hair-removal service for the area named in the listing; it can shape brows or remove facial hair.', ['unwanted facial hair', 'brow grooming']);
  } else if (group === 'hot-wax' || /\bwax(ing)?\b/.test(name)) {
    knowledge = entry('Waxing removes unwanted hair from the named area for temporary smoothness; the clinic can confirm its product and technique.', ['unwanted hair', 'hair removal']);
  } else if (group === 'foot-hand-spa' || /hand spa|foot spa/.test(name)) {
    knowledge = entry('This is a cosmetic hand or foot care appointment. Essential, Deluxe and Luxe are separate catalog options; ask for the recorded inclusions to compare them.', ['hand care', 'foot care', 'dry hands', 'dry feet']);
  } else if (service.category === 'consultation' || /consultation/.test(name)) {
    knowledge = entry('A consultation lets clinic professionals discuss your concerns and help you choose an appropriate service and treatment plan.', []);
  } else if (['body-whitening', 'body-whitening-7'].includes(group) || /carbon laser|carbon peel/.test(name)) {
    // An exact carbon-laser protocol cannot be established from a marketing name.
    knowledge = entry('This catalog entry is intended for cosmetic skin appearance in the named area. The clinic needs to confirm the exact carbon-laser or brightening protocol and expected benefits.', ['uneven tone'], undefined, true);
  } else if (/chemical peel/.test(name)) {
    knowledge = entry('Chemical peels exfoliate skin and may improve uneven tone, rough texture and certain fine lines or acne concerns, depending on peel type and professional assessment.', ['uneven tone', 'rough texture', 'fine lines'], SERVICE_SOURCES.peel, true);
  } else if (/hydrafacial|hydra facial/.test(name)) {
    knowledge = entry('Hydrating facial treatments generally combine cleansing, exfoliation and hydration for dull or dehydrated-looking skin. Ask the clinic to confirm the steps in its named package.', ['dryness', 'dehydration', 'dullness', 'clogged pores'], SERVICE_SOURCES.facial);
  } else if (/diamond|dermaclear|acne.*mask|facial/.test(name) || service.category === 'facial' || service.category === 'signature_facial') {
    knowledge = entry('This is a facial-care appointment; the named option indicates its cleansing, cosmetic exfoliation or acne-care focus. Exact steps, products and expected benefits need clinic confirmation.', /acne|dermaclear/.test(name) ? ['acne', 'clogged pores', 'oily skin'] : ['dullness', 'skin texture']);
  } else {
    knowledge = { summary: 'This service is listed in our catalog, but its purpose and benefits are not on file yet. Please ask the clinic for those details.', concerns: [], sources: [], provenance: 'needs-confirmation', consultationRequired: doctor };
  }

  if (/^test(?: service)?$/i.test(service.name.trim())) {
    return { summary: 'This catalog entry has no confirmed service description. Please ask the clinic to clarify it.', concerns: [], sources: [], provenance: 'needs-confirmation', consultationRequired: true };
  }
  if (service.description?.trim()) {
    return { ...knowledge, summary: conciseText(service.description, 260), provenance: 'clinic-description' };
  }
  return knowledge;
}

export function serviceLabel(service: Pick<ChatService, 'name' | 'group'>): string {
  return service.group?.name ? `${service.name} — ${service.group.name}` : service.name;
}

function normalizedName(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function namedServices(message: string, services: ChatService[]): ChatService[] {
  const query = ` ${normalizedName(message)} `;
  let found = services.filter((s) => {
    const name = normalizedName(s.name);
    return name.length >= 3 && query.includes(` ${name} `);
  });
  if (!found.length) return [];
  found = found.filter((s) => !found.some((other) => {
    const name = normalizedName(s.name);
    const longer = normalizedName(other.name);
    return name !== longer && ` ${longer} `.includes(` ${name} `);
  }));
  const technology = /\b(hifu|ultratight)\b/.test(message.toLowerCase()) ? /hifu|ultratight/
    : /\b(rf|radiofrequency|radio frequency)\b/.test(message.toLowerCase()) ? /radio-frequency|rf-7/
    : /\bdiode\b/.test(message.toLowerCase()) ? /diode/
    : /\bwax(ing)?\b/.test(message.toLowerCase()) ? /hot-wax/
    : null;
  if (technology) {
    found = found.filter((s) => {
      const sameName = found.filter((other) => normalizedName(other.name) === normalizedName(s.name));
      return sameName.length === 1 || !sameName.some((other) => technology.test(other.group?.slug ?? '')) || technology.test(s.group?.slug ?? '');
    });
  }
  return found;
}

export function renderServiceChoices(services: ChatService[]): string {
  return `Which treatment did you mean?\n${services.slice(0, 3).map((s, i) => `${i + 1}) ${serviceLabel(s)} (${servicePrice(s).replace('Price: ', '')})`).join('\n')}${services.length > 3 ? `\nThere are ${services.length - 3} more matching options; you can name the treatment type.` : ''}`;
}

export function servicePrice(service: ChatService): string {
  const format = (value: unknown) => Number(value) === 0 ? 'Free' : `₱${Number(value).toLocaleString('en-PH')}`;
  const prices = [`Price: ${format(service.price)}`];
  if (service.non_member_price != null && Number(service.non_member_price) !== Number(service.price)) prices.push(`Non-member: ${format(service.non_member_price)}`);
  if (service.vip_price != null) prices.push(`VIP: ${format(service.vip_price)}`);
  return prices.join(' · ');
}

export function renderServiceAnswer(service: ChatService, question: string): string {
  const knowledge = serviceKnowledge(service);
  const text = question.toLowerCase();
  if (/\bhow long\b[^?]*\b(last|results?|effects?)\b/.test(text)) {
    return `${serviceLabel(service)}: How long results last is not confirmed in our catalog and can vary by person and treatment. Please ask our clinic professionals; the appointment length is not the duration of results.`;
  }
  const logistics = detectTreatmentInfo(text);
  if (logistics && logistics !== 'duration') {
    if (logistics === 'sessions' && service.packages) {
      return `${serviceLabel(service)} includes ${service.packages.sessions_included} sessions. Our clinic professionals can assess how many sessions are appropriate for you.`;
    }
    const field = { sessions: 'the number of sessions needed', pain: 'discomfort or pain', side_effects: 'risks and side effects', downtime: 'recovery or downtime' }[logistics];
    return `${serviceLabel(service)}: I do not have confirmed details about ${field} for this service. Please ask our clinic professionals for advice specific to your treatment.`;
  }
  const asksPrice = /\b(price|cost|how much|fee|pricing)\b/.test(text);
  const asksDuration = /\b(duration|how long|minutes)\b/.test(text);
  const asksExplanation = /\b(used for|purpose|benefits?|tell me|about|compare|explain|describe)\b/.test(text) || (!asksPrice && !asksDuration);
  const lines: string[] = [];
  if (asksExplanation) lines.push(`${service.name}: ${firstSentence(knowledge.summary)}`);
  if (asksPrice) lines.push(`${lines.length ? '' : `${service.name}: `}${servicePrice(service).replace(/^Price: /, '')}.`);
  if (asksDuration) lines.push(`${lines.length ? 'The appointment' : service.name} takes about ${service.duration_minutes} minutes.`);
  if (/\b(includ|package|sessions|bundle|variant|per nail|full set)/.test(text)) {
    const inclusions = service.packages?.inclusions ?? service.inclusions;
    if (Array.isArray(inclusions)) {
      const list = inclusions.filter((v): v is string => typeof v === 'string').slice(0, 4);
      if (list.length) lines.push(`Includes: ${list.join(', ')}.`);
    }
    if (service.packages) lines.push(`Package: ${service.packages.sessions_included} sessions.`);
    if (service.variants?.length) lines.push(`Options: ${service.variants.slice(0, 4).map((v) => v.label).join(', ')}.`);
  }
  if (knowledge.consultationRequired && asksExplanation) lines.push('Our clinician can confirm the details and whether it suits you.');
  return lines.join(' ');
}
