import prisma from '../../config/database';
import { roundPeso } from '../../services/pricing-engine.core';
import { conciseText } from './service-knowledge';

/**
 * Database-driven product knowledge for the clinic assistant.
 *
 * Design rules that this module exists to enforce:
 *
 * 1. The database is the single source of truth. There is no second, manually
 *    maintained product list anywhere in the chatbot, and no `if (name === ...)`
 *    branch for any individual product. Adding a product to the catalog makes it
 *    answerable with no code change.
 * 2. Nothing is ever invented. Every rendered line comes from a stored column. A
 *    field the clinic has not filled in is reported as "not currently on file"
 *    rather than guessed at, which is why the renderer is table-driven: a field
 *    exists only if the loader produced a value for it.
 * 3. Only customer-relevant products are visible. Internal consumables and
 *    equipment (`is_retail = false`) and unpriced items are excluded by the
 *    loader, so their names, costs and injectable stock can never leak into a
 *    public conversation.
 *
 * The pure helpers below take their data as arguments and touch no database, so
 * the matching, intent detection and rendering logic is unit-testable without
 * one.
 */

export interface ProductRecord {
  id: number;
  name: string;
  description: string | null;
  purpose: string | null;
  benefits: string | null;
  sku: string;
  unit: string;
  unit_price: number;
  current_stock: number;
  category: string | null;
  /** Services this product is consumed or applied in, when recorded. */
  related_services: string[];
}

export type ProductIntent =
  | 'overview'
  | 'purpose'
  | 'benefits'
  | 'usage'
  | 'ingredients'
  | 'price'
  | 'availability'
  | 'related_services';

export type ProductMatch =
  | { kind: 'none' }
  | { kind: 'single'; product: ProductRecord }
  | { kind: 'ambiguous'; products: ProductRecord[] };

export interface NormalizedQuery {
  /** Original message, trimmed and whitespace-collapsed. */
  text: string;
  lower: string;
  /** Lowercased message split into tokens, minus question/filler words. */
  tokens: string[];
  /** True when the message is just a name or keyword with no question around it. */
  isBareName: boolean;
}

/**
 * Question and filler words carry no matching signal. They are removed before
 * token comparison so "how much is <product>" and "<product>" tokenize identically.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'to', 'of', 'in', 'on', 'at', 'by',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did',
  'you', 'your', 'yours', 'our', 'ours', 'us', 'it', 'its', 'this', 'that', 'these',
  'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how', 'can', 'could',
  'will', 'would', 'should', 'may', 'might', 'must', 'not', 'no', 'yes', 'please',
  'tell', 'about', 'want', 'need', 'have', 'has', 'had', 'get', 'got', 'good',
  'i', 'me', 'my', 'we', 'any', 'some', 'there', 'here', 'am',
  'much', 'many', 'long', 'like', 'them', 'they',
]);

/**
 * Words that make a message a question rather than a bare name. Matched against
 * the raw lowercased text, not the token list, because the tokenizer strips
 * exactly these words and would otherwise report every question as a bare name.
 */
const QUESTION_WORDS = /\b(what|whats|how|why|when|where|which|who|whom|whose|do|does|did|is|are|was|were|can|could|will|would|should|tell|explain|describe|recommend|wondering|curious)\b/;

const INTENT_CUE_WORDS = /\b(much|many|price|pricing|cost|costs|fee|fees|rate|rates|used|use|uses|using|apply|ingredient|ingredients|benefit|benefits|purpose|available|availability|stock|related|suitable|recommendation)\b/;

export function normalizeQuery(message: string): NormalizedQuery {
  const text = message.trim().replace(/\s+/g, ' ');
  const lower = text.toLowerCase();
  const tokens = tokenize(text);
  const hasQuestion = text.includes('?') || QUESTION_WORDS.test(lower);
  const hasIntentCue = INTENT_CUE_WORDS.test(lower);
  return {
    text,
    lower,
    tokens,
    isBareName: tokens.length > 0 && !hasQuestion && !hasIntentCue,
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Levenshtein distance, bounded for short catalog names. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 3) return 99;
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let last = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const temp = prev[j];
      prev[j] = Math.min(
        prev[j] + 1,
        prev[j - 1] + 1,
        last + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      last = temp;
    }
  }
  return prev[b.length];
}

/**
 * Typo tolerance. The first letter must agree, which keeps short words from
 * matching unrelated names ("serum"/"cream" are not typos of each other).
 */
function fuzzyMatch(token: string, reference: string): boolean {
  if (token === reference) return true;
  if (token[0] !== reference[0]) return false;
  const tolerance = token.length <= 4 ? 1 : token.length <= 8 ? 2 : 3;
  return levenshtein(token, reference) <= tolerance;
}

/**
 * Cheap pre-check for "is this worth looking up in the catalog?".
 *
 * This is deliberately permissive: a bare two-word phrase like "vitamin c" carries
 * no explicit product word but is exactly the kind of query that must be looked
 * up. It is a gate, not a decision — `matchProducts` decides whether a real
 * product matched, and anything that fails to match there never becomes a product
 * answer.
 */
export function mentionsProduct(normalized: NormalizedQuery): boolean {
  if (normalized.tokens.length === 0) return false;
  return (
    normalized.isBareName ||
    normalized.lower.includes('product') ||
    normalized.lower.includes('products') ||
    normalized.lower.includes('item') ||
    normalized.lower.includes('items') ||
    normalized.lower.includes('stock') ||
    normalized.lower.includes('available')
  );
}

/**
 * Clinic-operational topics. These are handled by other parts of the assistant,
 * so a question about them must never be turned into a product answer.
 */
const NON_PRODUCT_TOPICS = [
  'service', 'services', 'treatment', 'treatments', 'package', 'packages',
  'hour', 'hours', 'open', 'close', 'closed', 'location', 'address', 'direction',
  'parking', 'contact', 'phone', 'email', 'call', 'number', 'payment', 'pay',
  'pricing', 'refund', 'cancel', 'cancellation', 'reschedule', 'appointment', 'book',
  'booking', 'booked', 'reserve', 'reservation', 'reservations', 'schedule',
  'membership', 'voucher', 'promo',
  'promotion', 'discount', 'warranty', 'return', 'shipping', 'delivery', 'branch',
  'therapist', 'staff', 'doctor', 'nurse', 'age', 'pregnant',
  'pregnancy', 'breastfeeding', 'allergic', 'allergy', 'diabetes', 'surgery',
  'downtime', 'side effect', 'side effects',
  // Service/category words and one-word clinic topics. None of these are ever a
  // retail product ("waxing", "manicure", "facial", "laser", ...), so they must
  // not be reported as "no product found" — they belong to the service side of
  // the assistant.
  'facial', 'facials', 'laser', 'peel', 'peels', 'botox', 'filler', 'fillers',
  'injection', 'injectables', 'nail', 'nails', 'manicure', 'pedicure', 'biab',
  'hifu', 'wax', 'waxing', 'hydrafacial', 'glow', 'whitening', 'microdermabrasion',
  'microneedling', 'dermapen', 'menu', 'body contour', 'lipo', 'lipolysis',
  'slimming', 'threading', 'thread', 'hand spa', 'foot spa',
  'gel polish', 'gel nails', 'lash', 'lashes', 'eyelash', 'brow', 'eyebrow',
  'microblading', 'lamination', 'pmu', 'permanent makeup', 'rf', 'meso',
  'rejuran', 'pdrn', 'exosome', 'glutathione', 'gluta', 'vitamin c', 'nad',
  'infusion', 'drip', 'scalp', 'hair loss', 'hairfall', 'tattoo removal',
  'skin tag', 'skincare', 'skin care', 'scrub', 'gua sha', 'massage',
  'offer', 'offers', 'offering', 'offerings',
  // Everyday skincare-routine words. These are answered as clinic topics
  // (service/concern side), not looked up as retail products.
  'cleanser', 'toner', 'moisturizer', 'moisturiser',
  // Treatment names that are services, never retail products.
  'dermaplaning', 'dermabrasion', 'lymphatic', 'micropigmentation', 'liposuction',
  // Eye-area concerns. Include spelling variants (eye bags / eyebags / the
  // common "eyeabags" typo) so a concern question is never reported as a missing
  // product.
  'eye bag', 'eye bags', 'eyebag', 'eyebags', 'eyeabag', 'eyeabags',
  'under eye', 'under-eye', 'undereye', 'dark circle', 'dark circles',
  'puffy eye', 'puffy eyes', 'eye area', 'eye puffiness', 'tired eye', 'tired eyes',
  // Concern and treatment vocabulary across every catalog category. None of these
  // is ever a retail product, so a question about one must be handled by the
  // service side of the assistant rather than reported as a missing product.
  'blackhead', 'blackheads', 'black head', 'black heads', 'whitehead', 'whiteheads',
  'white head', 'white heads', 'comedone', 'comedones', 'extraction', 'extractions',
  'dermaclear', 'derma clear', 'microdermabrasion', 'pdt',
  'redness', 'rosacea', 'vascular', 'sensitive', 'sensitivity', 'irritated', 'irritation',
  'eczema', 'dermatitis', 'rash', 'allergic', 'allergy',
  'stretch mark', 'stretch marks', 'striae', 'keloid', 'keloids', 'scar revision',
  'jowl', 'jowls', 'jawline', 'jaw line', 'double chin', 'loose skin', 'laxity', 'saggy',
  'tighten', 'tightening', 'nasolabial', 'marionette', 'smile lines', 'forehead lines',
  "crow's feet", 'crows feet', 'collagen',
  'cellulite', 'body fat', 'fat body', 'belly fat', 'love handle', 'love handles',
  'bra fat', 'flabby', 'flab', 'stubborn fat', 'weight loss', 'lose weight', 'overweight',
  'obese', 'chubby', 'body contour', 'body contouring', 'body shaping',
  'underarm', 'underarms', 'armpit', 'armpits', 'under arm', 'body odor', 'body odour',
  'hyperhidrosis', 'excessive sweat', 'sweat', 'sweating', 'sweaty',
  'chapped', 'cracked lip', 'cracked lips', 'dry lip', 'dry lips', 'lip balm', 'lip care',
  'lip scrub', 'lip gloss', 'lip tint', 'dark lip', 'dark lips',
  'shave', 'shaving', 'hair removal', 'unwanted hair', 'body hair', 'facial hair',
  'hair growth', 'hirsutism', 'mustache', 'moustache', 'beard', 'sideburns', 'hairline',
  'hairy', 'acrylic', 'cuticle', 'ingrown', 'nail fungus', 'nail art', 'nail polish',
  'keratin', 'wart', 'warts', 'skin tag', 'skin tags', 'mole', 'moles', 'milia',
];

/**
 * True when the message mentions a clinic topic that is handled by the rest of
 * the assistant rather than by the product catalog. Matching is a substring
 * check against the raw lowercased text (the tokenizer strips exactly these
 * kinds of words), so "what are your hours?" and a bare "waxing" both count.
 */
export function isNonProductTopic(lower: string): boolean {
  return NON_PRODUCT_TOPICS.some((topic) => lower.includes(topic));
}

/**
 * Detect a question that is shaped like a lookup of a *thing* the clinic sells,
 * even when the user never says the word "product".
 *
 * Without this, "What is Hydroquinone Booster used for?" fails the
 * `mentionsProduct` gate and falls through to the language model, which would
 * then happily invent facts about a product the clinic does not carry. The
 * caller is responsible for confirming that no known service matched first.
 *
 * This is the topic-agnostic half of `looksLikeProductLookup`: it is exposed
 * separately so the service layer can still attempt a catalog match when an
 * operational word appears only as part of a real product name (for example
 * "What is Acne Treatment Cream?").
 */
export function isThingLookupShape(normalized: NormalizedQuery): boolean {
  if (normalized.tokens.length === 0) return false;
  const lower = normalized.lower;

  return (
    /\bwhat is\b|\bwhat are\b|\bhow much is\b|\bhow do i\b|\bcan i use\b|\bis it\b|\btell me about\b/.test(lower) ||
    /\bdo you (have|sell|carry|stock|offer)\b/.test(lower) ||
    /\b(ingredients?|benefits?|purpose)\b/.test(lower) ||
    /\bgood for\b|\bmade of\b|\bcome in\b/.test(lower)
  );
}

/**
 * Same as `isThingLookupShape`, but yields to clinic-operational questions
 * ("what are your hours?") that would otherwise look like product lookups.
 */
export function looksLikeProductLookup(normalized: NormalizedQuery): boolean {
  if (!isThingLookupShape(normalized)) return false;

  // Operational questions look identical in shape but are not product questions.
  return !NON_PRODUCT_TOPICS.some((topic) => normalized.lower.includes(topic));
}

/**
 * True when the message only refers back to what was just discussed, rather than
 * naming something new.
 *
 * This is what separates a genuine follow-up ("how much?", "how do I use it?")
 * from a fresh question that happens to contain the same words ("what is
 * Hydroquinone Booster used for?"). Without this distinction a new product
 * question is answered about whatever was discussed previously, which is worse
 * than not answering at all because it looks authoritative.
 */
export function isReferentialProductFollowUp(normalized: NormalizedQuery): boolean {
  // A relative clause ("a service that can brighten my skin") is a new request,
  // not a reference to whichever product was discussed previously.
  if (/\b(recommend|suggest|looking for|i have|i want|i need)\b/.test(normalized.lower)) return false;
  const hasPronoun = /\b(it|that|this|these|those|them|they)\b/.test(normalized.lower);
  if (hasPronoun) return true;

  // With no pronoun, the message may only be made of intent/filler words. Any
  // leftover word is a candidate product name and forces a fresh lookup.
  // An empty token list ("how much?") is vacuously referential.
  return normalized.tokens.every((t) => INTENT_CUE_WORDS.test(` ${t} `));
}

/**
 * True for a request to see the catalog as a whole ("what products do you
 * have?") rather than to look up one product.
 *
 * Requires the word "product" or "item" so that a bare "what do you have?" is
 * left to the rest of the assistant instead of being answered with a product
 * list.
 */
export function isCatalogBrowseQuery(normalized: NormalizedQuery): boolean {
  const lower = normalized.lower;
  if (!/\b(products?|items?)\b/.test(lower)) return false;

  // A bare or lightly-qualified catalog request ("products", "your products",
  // "product list", "items available") is a browse even without a "what/which"
  // or a "have/sell" verb. Without this, a one-word "products" fell through the
  // relevance gate and was refused as off-topic.
  const BARE_CATALOG =
    /^\s*(please\s+)?(show|list|see|give|view)?\s*(me\s+)?(all\s+|any\s+|your\s+|our\s+|the\s+|available\s+)?(products?|items?)[\s?.!,]*$/;
  const CATALOG_PHRASE =
    /^\s*(products?|items?)\s+(list|available|in stock|inventory)[\s?.!,]*$|^\s*list\s+of\s+(products?|items?)[\s?.!,]*$/;
  if (BARE_CATALOG.test(lower) || CATALOG_PHRASE.test(lower)) return true;

  const asksAboutACategory =
    /\b(what|which|list|show|tell)\b/.test(lower) && /\b(products?|items?)\b/.test(lower);
  const asksAboutStock =
    /\b(have|has|sell|sells|selling|carry|carries|offer|offers|stock|available|in stock)\b/.test(lower);

  return asksAboutACategory || asksAboutStock;
}

/**
 * Render the whole catalog. Used only when nothing specific matched, so the user
 * gets a real answer instead of a misleading "we do not have that".
 */
export function renderCatalogReply(products: ProductRecord[], showAll = false): string {
  if (products.length === 0) return renderNoMatchReply();

  const MAX_LISTED = showAll ? products.length : 3;
  const shown = products.slice(0, MAX_LISTED);
  const list = shown.map((p) => `- ${p.name} (${peso(p.unit_price)})`).join('\n');
  const rest = products.length - shown.length;

  return (
    `We currently carry these ${products.length} products:\n${list}` +
    (rest > 0 ? `\n- and ${rest} more` : '') +
    `\n\nAsk about an item, a concern, or ask for all products.\n\n${DISCLAIMER}`
  );
}

/**
 * Score one product against the query. Mirrors the token/fuzzy scoring already
 * proven for services, with the catalog field being the product name.
 *
 * Returns 0 when the query shares nothing meaningful with the name.
 */
function scoreProduct(product: ProductRecord, q: NormalizedQuery): number {
  const nameLower = product.name.toLowerCase();
  const nameTokens = tokenize(product.name);

  // Whole-query verbatim containment, e.g. a two-word fragment matching a
  // longer product name. Only trustworthy when the query is several words long; a
  // bare word matching a name is handled by the token pass so ambiguity can
  // still surface.
  if (q.tokens.length >= 2 && nameLower.includes(q.lower)) {
    return 100;
  }

  let score = 0;
  let firstTokenExact = false;

  for (const qt of q.tokens) {
    // A topic/body-area word alone does not identify a retail product.
    if (['skin', 'face', 'body', 'care', 'treatment', 'aftercare', 'product', 'products', 'service', 'services'].includes(qt)) continue;
    for (let i = 0; i < nameTokens.length; i += 1) {
      const nt = nameTokens[i];
      if (qt === nt) {
        score += 2;
        if (i === 0) firstTokenExact = true;
        break;
      }
      if (qt.length >= 5 && fuzzyMatch(qt, nt)) {
        score += 1;
        break;
      }
    }
  }

  // A single leading keyword can identify a product ("retinol" -> "Retinol Night
  // Cream"), but only for short queries and multi-word names, so that a bare
  // shared category word ("serum") does not silently pick one of several.
  const shortQuery = q.tokens.length <= 6;
  const singleLeadingHit = firstTokenExact && score >= 2 && nameTokens.length > 1 && shortQuery;

  if (score < 2 && !singleLeadingHit) return 0;

  // Reward a name that is largely consumed by the query, so "collagen face mask"
  // outranks a long unrelated product that happens to share one word.
  const coverage = q.tokens.length > 0 ? score / (q.tokens.length * 2) : 0;
  return score + Math.round(coverage * 2);
}

/**
 * Rank the catalog against a query.
 *
 * A tie at the top score is reported as ambiguous rather than resolved
 * arbitrarily, so the assistant asks which product was meant instead of
 * guessing. Ties prefer a name the query is a prefix of, then the shorter name.
 */
export function matchProducts(products: ProductRecord[], query: NormalizedQuery | string): ProductMatch {
  const q = typeof query === 'string' ? normalizeQuery(query) : query;
  if (products.length === 0 || q.tokens.length === 0) return { kind: 'none' };

  const scored = products
    .map((product) => ({ product, score: scoreProduct(product, q) }))
    .filter((c) => c.score > 0);

  if (scored.length === 0) return { kind: 'none' };

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aStarts = a.product.name.toLowerCase().startsWith(q.lower);
    const bStarts = b.product.name.toLowerCase().startsWith(q.lower);
    if (aStarts !== bStarts) return aStarts ? -1 : 1;
    return a.product.name.length - b.product.name.length;
  });

  const top = scored.filter((c) => c.score === scored[0].score);

  // One clear winner, or a single plausible candidate.
  if (top.length === 1) return { kind: 'single', product: top[0].product };

  // Several products tie: only answer if they are the same product reached by
  // different tokens, otherwise ask the customer to choose.
  const distinctNames = new Set(top.map((c) => c.product.name.toLowerCase()));
  if (distinctNames.size === 1) return { kind: 'single', product: top[0].product };

  return { kind: 'ambiguous', products: top.map((c) => c.product) };
}

/**
 * Which pieces of information is the customer asking for?
 *
 * Every cue found anywhere in the message is returned, so a compound question
 * such as "what is it used for and how much is it" yields both purpose and
 * price. Matching runs against the raw lowercased text because the tokenizer
 * strips question words.
 */
export function detectIntents(query: NormalizedQuery | string): ProductIntent[] {
  const q = typeof query === 'string' ? normalizeQuery(query) : query;
  const text = q.lower;
  const found: ProductIntent[] = [];

  const add = (intent: ProductIntent) => {
    if (!found.includes(intent)) found.push(intent);
  };

  if (/\bhow much\b|\bprice\b|\bprices\b|\bpricing\b|\bcost\b|\bcosts?\b|\bfee\b|\brates?\b/.test(text)) {
    add('price');
  }

  if (/\bavailable\b|\bavailability\b|\bin stock\b|\bout of stock\b|\bdo you (have|sell|carry)\b|\bstock\b|\bselling\b/.test(text)) {
    add('availability');
  }

  if (/\bingredients?\b|\bcontains?\b|\bcomposition\b|\bmade of\b|\bwhat'?s in\b/.test(text)) {
    add('ingredients');
  }

  if (/\bhow (do|should|can) (i|we|you)?\s*(use|apply|wear|put)\b|\bhow to use\b|\busage\b|\bdirections?\b|\bapply\b|\bhow often\b/.test(text)) {
    add('usage');
  }

  if (/\bbenefits?\b|\bgood for\b|\bhelp(s)? with\b|\bwhy should\b|\bwhat does .* do\b|\badvantages?\b/.test(text)) {
    add('benefits');
  }

  if (/\bused for\b|\bfor what\b|\bwhat is .* for\b|\bpurpose\b|\bwhat does .* (do|target)\b|\bsuitable for\b|\bgood for\b|\bconcern\b/.test(text)) {
    add('purpose');
  }

  if (/\brelated\b|\bwhich service\b|\bwhat service\b|\bused in\b|\bwith which treatment\b|\bpaired\b/.test(text)) {
    add('related_services');
  }

  // A bare name, or a question with no specific cue, means give the overview.
  if (found.length === 0) add('overview');

  return found;
}

/** Availability as a state, never as an exact stock count. */
function availabilityLine(product: ProductRecord): string {
  return product.current_stock > 0 ? 'In stock' : 'Currently out of stock';
}

/**
 * Optional descriptive fields. Each entry is present only when the loader found
 * a value for it, so an unpopulated field can never be fabricated.
 */
function descriptiveFields(product: ProductRecord): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string | null }> = [
    { label: 'Description', value: product.description },
    { label: 'Purpose', value: product.purpose },
    { label: 'Benefits', value: product.benefits },
    { label: 'Ingredients', value: null },
    { label: 'Usage', value: null },
  ];

  return fields
    .map((f) => ({ label: f.label, value: f.value ? f.value.trim() : null }))
    .filter((f): f is { label: string; value: string } => f.value !== null && f.value.length > 0);
}

const MISSING_FIELD_NOTE =
  'We do not have those details on file yet; please ask our clinic staff.';

const DISCLAIMER =
  'Please consult with our clinic professionals for personalized advice.';

function peso(value: number): string {
  const n = Number(value);
  if (!n || Number.isNaN(n)) return 'Free';
  return `₱${n.toLocaleString()}`;
}

/**
 * Build the answer for one product. Only the requested sections are rendered,
 * and each one only when the underlying data exists.
 */
export function renderProductAnswer(product: ProductRecord, intents: ProductIntent[]): string {
  const requested = intents.length > 0 ? intents : ['overview'];
  const lines: string[] = [];
  const wantsOverview = requested.includes('overview');
  const narrowOnly = requested.every((i) => i === 'price' || i === 'availability');

  // Header carries the product name so a one-word reply still reads naturally.
  lines.push(wantsOverview ? product.name : `${product.name}:`);

  // Category belongs with the header, otherwise a question that also asked for
  // the price would print the price before the product is even described.
  if (wantsOverview && product.category) lines.push(`Category: ${product.category}`);

  const descriptive = descriptiveFields(product);

  if (wantsOverview) {
    if (descriptive.length > 0) {
      lines.push(...descriptive.map((f) => `${f.label}: ${conciseText(f.value, 120)}`));
    } else {
      lines.push(
        'We currently list this product by name and price only — fuller details are not on file yet.',
      );
    }
  }

  if (!wantsOverview) {
    for (const [intent, label] of [['purpose', 'Purpose'], ['benefits', 'Benefits']] as const) {
      const field = descriptive.find((f) => f.label === label);
      if (requested.includes(intent) && field) lines.push(`${label}: ${conciseText(field.value, 220)}`);
    }
  }

  // Explicit requests for details the clinic has not recorded must be answered
  // honestly rather than skipped or guessed.
  const askedButMissing: string[] = [];
  for (const intent of requested) {
    if (intent === 'purpose' && !descriptive.some((f) => f.label === 'Purpose')) askedButMissing.push('what it is used for');
    if (intent === 'benefits' && !descriptive.some((f) => f.label === 'Benefits')) askedButMissing.push('its benefits');
    if (intent === 'ingredients' && !descriptive.some((f) => f.label === 'Ingredients')) askedButMissing.push('its ingredients');
    if (intent === 'usage' && !descriptive.some((f) => f.label === 'Usage')) askedButMissing.push('usage instructions');
  }
  if (askedButMissing.length > 0) {
    lines.push(`About ${askedButMissing.join(', ')}: ${MISSING_FIELD_NOTE}`);
  }

  // Track which fields have already been emitted so an overview combined with an
  // explicit question never repeats a line.
  const emitted = new Set<string>();

  if (requested.includes('price')) {
    lines.push(`Price: ${peso(product.unit_price)} per ${product.unit}`);
    emitted.add('price');
  }

  if (requested.includes('availability')) {
    lines.push(`Availability: ${availabilityLine(product)}`);
    emitted.add('availability');
  }

  if (requested.includes('related_services')) {
    lines.push(
      product.related_services.length > 0
        ? `Related services: ${product.related_services.slice(0, 3).join(', ')}`
        : `Related services: ${MISSING_FIELD_NOTE}`,
    );
    emitted.add('related_services');
  }

  // A bare-name reply should still show price and availability when nothing more
  // specific was asked, since those are the two facts every shopper wants.
  if (wantsOverview && !narrowOnly) {
    if (!emitted.has('price')) {
      lines.push(`Price: ${peso(product.unit_price)} per ${product.unit}`);
    }
    if (!emitted.has('availability')) {
      lines.push(`Availability: ${availabilityLine(product)}`);
    }
    if (!emitted.has('related_services') && product.related_services.length > 0) {
      lines.push(`Related services: ${product.related_services.slice(0, 3).join(', ')}`);
    }
  }

  lines.push(DISCLAIMER);
  return lines.join('\n');
}

/**
 * Reply when a query matches several products. Never picks one arbitrarily.
 */
export function renderAmbiguousReply(products: ProductRecord[], limit = 3): string {
  const shown = products.slice(0, limit);
  const list = shown.map((p) => `- ${p.name} (${peso(p.unit_price)})`).join('\n');
  const more = products.length > shown.length
    ? `\n…and ${products.length - shown.length} more.`
    : '';
  return `I found more than one product that matches. Which one did you mean?${more}\n${list}\n\n${DISCLAIMER}`;
}

/** Reply when no catalog product matches. Must not describe a product we lack. */
export function renderNoMatchReply(): string {
  return (
    'I could not find a product matching that in our current catalog, so I do not want to guess at its details. ' +
    'You can browse what we carry by asking what products we have, or contact the clinic and our staff will check for you.\n\n' +
    DISCLAIMER
  );
}

/**
 * Products recorded against a service. Derived from the stored
 * service_inventory_items relationship rather than any hardcoded pairing, so it
 * reflects whatever the clinic has actually linked.
 */
export function productsForService(products: ProductRecord[], serviceName: string): ProductRecord[] {
  const target = serviceName.trim().toLowerCase();
  if (!target) return [];
  return products.filter((p) =>
    p.related_services.some((s) => {
      const name = s.toLowerCase();
      return name.includes(target) || target.includes(name);
    }),
  );
}

/** Reply for "what product goes with <service>?" */
export function renderRelatedProductsReply(serviceName: string, products: ProductRecord[]): string {
  if (products.length === 0) {
    return (
      `I do not have a product on file that is linked to ${serviceName} right now. ` +
      `You can ask what products we carry, or contact the clinic and our staff can advise you.\n\n` +
      DISCLAIMER
    );
  }

  const list = products.slice(0, 3).map((p) => `- ${p.name} (${peso(p.unit_price)})`).join('\n');
  return (
    `Products we use with ${serviceName}:\n${list}\n\n` +
    `Ask me about any of these for details.\n\n${DISCLAIMER}`
  );
}

/** Recommendations use the recorded purpose/benefits, not invented ingredient claims. */
export function recommendProducts(products: ProductRecord[], message: string): ProductRecord[] {
  const concerns = [
    ['acne', 'pimple', 'breakout', 'blemish'], ['oily', 'oil control', 'excess oil', 'sebum'],
    ['dry', 'dryness', 'dehydrated', 'hydration', 'moisture'], ['dull', 'dullness', 'brighten', 'brightening', 'brighter'],
    ['dark spot', 'pigmentation', 'hyperpigmentation', 'uneven tone', 'uneven skin tone'], ['fine line', 'wrinkle', 'aging'],
    ['sun protection', 'sunscreen', 'uv', 'spf'], ['sensitive', 'soothing', 'barrier'],
    ['nail', 'polish', 'manicure', 'pedicure'],
  ];
  const text = message.toLowerCase();
  const hasTerm = (value: string, term: string) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:s|ness)?\\b`, 'i').test(value);
  const requested = concerns.filter((group) => group.some((term) => hasTerm(text, term)));
  if (!requested.length) return [];
  return products.filter((p) => p.current_stock > 0).map((product) => {
    const information = `${product.purpose ?? ''} ${product.benefits ?? ''} ${product.description ?? ''}`.toLowerCase();
    const score = requested.reduce((total, group) => {
      const matching = group.filter((term) => hasTerm(information, term));
      const excluded = matching.some((term) => new RegExp(`\\b(not|avoid|unsuitable)[^.]{0,45}\\b${term}\\b`, 'i').test(information));
      return total + (matching.length && !excluded ? 1 : 0);
    }, 0);
    return { product, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name))
    .slice(0, 3).map((item) => item.product);
}

export function renderProductRecommendations(products: ProductRecord[]): string {
  if (!products.length) return 'I do not have a product with a recorded purpose matching that concern. Our clinic staff can help you choose.';
  return `Options from our product catalog:\n${products.map((p) => `- ${p.name} (${peso(p.unit_price)}): ${conciseText(p.purpose || p.benefits || p.description || '', 105)}`).join('\n')}\n\n${DISCLAIMER}`;
}

/**
 * The columns every deployment of the schema is expected to have. Selecting
 * them explicitly rather than selecting all scalar columns means a database
 * that is running behind the code still answers product questions, and a column
 * added in some future migration can never silently break this read.
 */
const PRODUCT_CATALOG_SELECT = {
  id: true,
  name: true,
  description: true,
  sku: true,
  unit: true,
  unit_price: true,
  current_stock: true,
  category: { select: { name: true } },
  service_inventory_items: {
    select: { service: { select: { id: true, name: true, status: true, deleted_at: true } } },
  },
} as const;

/**
 * True when an error means an optional product content column is absent from the
 * database (for example because migration 20261004120000 has not run), as
 * opposed to the database being unreachable. Only the former is recoverable by
 * asking for fewer columns.
 */
function isMissingProductContentColumn(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  if (err?.code === 'P2022') return true;
  const message = String(err?.message ?? '').toLowerCase();
  return (
    message.includes('unknown column') &&
    (message.includes('purpose') ||
      message.includes('benefits') ||
      message.includes('research_sources'))
  );
}

/**
 * Load the customer-visible catalog. The visibility rules live here and nowhere
 * else, so every consumer of product knowledge agrees on what is answerable.
 *
 * The optional content columns (`purpose`, `benefits`) are read best-effort. If
 * they are missing the catalog is still returned without them, so a database
 * that is a migration behind keeps answering product questions instead of
 * reporting that it has nothing on file.
 */
export async function loadRetailProducts(): Promise<ProductRecord[]> {
  const where = {
    deleted_at: null,
    status: 'active' as const,
    is_retail: true,
    unit_price: { gt: 0 },
  };

  let rows: any[];
  try {
    rows = await prisma.products.findMany({
      where,
      select: { ...PRODUCT_CATALOG_SELECT, purpose: true, benefits: true },
      orderBy: { name: 'asc' },
    });
  } catch (error) {
    if (!isMissingProductContentColumn(error)) throw error;
    console.warn(
      '[chat] products table is missing purpose/benefits columns; serving the catalog without them until migrations run',
    );
    rows = await prisma.products.findMany({
      where,
      select: PRODUCT_CATALOG_SELECT,
      orderBy: { name: 'asc' },
    });
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    purpose: row.purpose ?? null,
    benefits: row.benefits ?? null,
    sku: row.sku,
    unit: row.unit,
    unit_price: roundPeso(Number(row.unit_price)),
    current_stock: Number(row.current_stock),
    category: row.category?.name ?? null,
    related_services: row.service_inventory_items
      .map((si: any) => si.service)
      .filter((s: any) => !s.deleted_at && s.status === 'active')
      .map((s: any) => s.name),
  }));
}
