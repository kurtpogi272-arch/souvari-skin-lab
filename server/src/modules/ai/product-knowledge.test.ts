import { describe, it, expect } from 'vitest';
import {
  normalizeQuery,
  mentionsProduct,
  isCatalogBrowseQuery,
  isNonProductTopic,
  isReferentialProductFollowUp,
  looksLikeProductLookup,
  matchProducts,
  detectIntents,
  renderProductAnswer,
  renderAmbiguousReply,
  renderCatalogReply,
  renderNoMatchReply,
  renderRelatedProductsReply,
  productsForService,
  recommendProducts,
  type ProductRecord,
} from './product-knowledge';

/**
 * Every fixture below is invented and shares no words with the real catalog, so
 * this suite proves the retrieval logic is generic rather than tuned to whatever
 * happens to be in the database today.
 */
const p = (name: string, extra: Partial<ProductRecord> = {}): ProductRecord => ({
  id: extra.id ?? Math.abs(name.length * 7 + name.charCodeAt(0)),
  name,
  description: extra.description ?? null,
  purpose: extra.purpose ?? null,
  benefits: extra.benefits ?? null,
  sku: `SKU-${name.length}`,
  unit: extra.unit ?? 'piece',
  unit_price: extra.unit_price ?? 500,
  current_stock: extra.current_stock ?? 10,
  category: extra.category ?? 'Skincare Products',
  related_services: extra.related_services ?? [],
});

const RESET_FACIAL = 'Signature Reset Facial';
const WAX_SESSION = 'Sculpting Wax Session';

const CATALOG: ProductRecord[] = [
  p('Nimbus Cloud Lotion', { id: 1, unit_price: 1800, related_services: [RESET_FACIAL] }),
  p('Quartz Radiance Serum', { id: 2, unit_price: 1600 }),
  p('Ember Radiance Clay Mask', { id: 3, unit_price: 1200, current_stock: 0 }),
  p('Zephyr Breeze Gel', {
    id: 4,
    unit_price: 500,
    description: 'A soothing gel for cooling and hydration.',
    related_services: [WAX_SESSION, RESET_FACIAL],
  }),
  p('Coral Soothing Gel', { id: 5, unit_price: 650 }),
  p('Onyx Midnight Balm', { id: 6, unit_price: 1400 }),
];

const GEL = CATALOG[3];
const SERUM = CATALOG[1];
const OUT_OF_STOCK = CATALOG[2];
const BALM = CATALOG[5];

describe('normalizeQuery', () => {
  it('collapses whitespace and lowercases for matching', () => {
    const q = normalizeQuery('  Quartz   Radiance Serum  ');
    expect(q.text).toBe('Quartz Radiance Serum');
    expect(q.lower).toBe('quartz radiance serum');
  });

  it('treats a bare product name as a bare name', () => {
    expect(normalizeQuery('Zephyr Breeze Gel').isBareName).toBe(true);
    expect(normalizeQuery('radiance').isBareName).toBe(true);
  });

  it('does not treat a question as a bare name', () => {
    expect(normalizeQuery('how much is midnight balm?').isBareName).toBe(false);
    expect(normalizeQuery('what are the benefits of this').isBareName).toBe(false);
  });

  it('drops question and filler words from tokens', () => {
    expect(normalizeQuery('how much is the zephyr breeze gel').tokens).toEqual([
      'zephyr',
      'breeze',
      'gel',
    ]);
  });
});

describe('mentionsProduct', () => {
  it('accepts a bare name or an explicit product question', () => {
    expect(mentionsProduct(normalizeQuery('Zephyr Breeze Gel'))).toBe(true);
    expect(mentionsProduct(normalizeQuery('radiance'))).toBe(true);
    expect(mentionsProduct(normalizeQuery('do you have any products?'))).toBe(true);
  });

  it('rejects a message with nothing to look up', () => {
    expect(mentionsProduct(normalizeQuery('   '))).toBe(false);
    expect(mentionsProduct(normalizeQuery('???'))).toBe(false);
  });

  it('is only a gate: an unrelated phrase is rejected by matching, not here', () => {
    // The gate stays permissive so short catalog keywords are still looked up,
    // but an unrelated phrase must never become a product answer.
    const q = normalizeQuery('what is the capital of France');
    if (mentionsProduct(q)) {
      expect(matchProducts(CATALOG, q).kind).toBe('none');
    }
  });
});

describe('matchProducts', () => {
  it('matches a full product name exactly', () => {
    const m = matchProducts(CATALOG, 'Zephyr Breeze Gel');
    expect(m.kind).toBe('single');
    if (m.kind === 'single') expect(m.product.name).toBe('Zephyr Breeze Gel');
  });

  it('matches case-insensitively', () => {
    const m = matchProducts(CATALOG, 'zEpHyR bReEzE gEl');
    expect(m.kind).toBe('single');
    if (m.kind === 'single') expect(m.product.name).toBe('Zephyr Breeze Gel');
  });

  it('matches a partial name', () => {
    const m = matchProducts(CATALOG, 'midnight');
    expect(m.kind).toBe('single');
    if (m.kind === 'single') expect(m.product.name).toBe('Onyx Midnight Balm');
  });

  it('matches a multi-word fragment', () => {
    const m = matchProducts(CATALOG, 'radiance serum');
    expect(m.kind).toBe('single');
    if (m.kind === 'single') expect(m.product.name).toBe('Quartz Radiance Serum');
  });

  it('matches a name embedded in a question', () => {
    const m = matchProducts(CATALOG, 'how much is the zephyr breeze gel?');
    expect(m.kind).toBe('single');
    if (m.kind === 'single') expect(m.product.name).toBe('Zephyr Breeze Gel');
  });

  it('tolerates a minor spelling difference', () => {
    const m = matchProducts(CATALOG, 'breeze jell');
    expect(m.kind).toBe('single');
    if (m.kind === 'single') expect(m.product.name).toBe('Zephyr Breeze Gel');
  });

  it('returns ambiguous for a keyword shared by several products', () => {
    const m = matchProducts(CATALOG, 'radiance');
    expect(m.kind).toBe('ambiguous');
    if (m.kind === 'ambiguous') {
      expect(m.products.map((x) => x.name).sort()).toEqual([
        'Ember Radiance Clay Mask',
        'Quartz Radiance Serum',
      ]);
    }
  });

  it('returns ambiguous for a shared product type word', () => {
    const m = matchProducts(CATALOG, 'gel');
    expect(m.kind).toBe('ambiguous');
    if (m.kind === 'ambiguous') expect(m.products.length).toBe(2);
  });

  it('narrows an ambiguous keyword with extra words', () => {
    const m = matchProducts(CATALOG, 'radiance clay mask');
    expect(m.kind).toBe('single');
    if (m.kind === 'single') expect(m.product.name).toBe('Ember Radiance Clay Mask');
  });

  it('returns none for an unknown name', () => {
    expect(matchProducts(CATALOG, 'Hydroquinone Booster').kind).toBe('none');
  });

  it('returns none when the catalog is empty', () => {
    expect(matchProducts([], 'Zephyr Breeze Gel').kind).toBe('none');
  });

  it('returns none for an empty message', () => {
    expect(matchProducts(CATALOG, '   ').kind).toBe('none');
  });
});

describe('detectIntents', () => {
  it('defaults to an overview for a bare name', () => {
    expect(detectIntents('Zephyr Breeze Gel')).toEqual(['overview']);
  });

  it('detects price', () => {
    expect(detectIntents('how much is the zephyr breeze gel?')).toContain('price');
  });

  it('detects purpose', () => {
    expect(detectIntents('what is the zephyr breeze gel used for?')).toContain('purpose');
  });

  it('detects benefits', () => {
    expect(detectIntents('what are the benefits of midnight balm?')).toContain('benefits');
  });

  it('detects usage', () => {
    expect(detectIntents('how do I use the zephyr breeze gel?')).toContain('usage');
  });

  it('detects ingredients', () => {
    expect(detectIntents('what are the ingredients of radiance serum?')).toContain('ingredients');
  });

  it('detects availability', () => {
    expect(detectIntents('do you have zephyr breeze gel in stock?')).toContain('availability');
  });

  it('answers every intent in a compound question', () => {
    const intents = detectIntents('what is midnight balm used for and how much is it?');
    expect(intents).toContain('purpose');
    expect(intents).toContain('price');
    expect(intents).not.toContain('overview');
  });

  it('answers all three parts of a three-part question', () => {
    const intents = detectIntents(
      'what is zephyr breeze gel used for, how much is it, and how do I use it?',
    );
    expect(intents).toContain('purpose');
    expect(intents).toContain('price');
    expect(intents).toContain('usage');
  });

  it('detects related services', () => {
    expect(detectIntents('which service uses midnight balm?')).toContain('related_services');
  });
});

describe('renderProductAnswer', () => {
  it('keeps price-only answers focused rather than repeating the full product overview', () => {
    const out = renderProductAnswer(GEL, detectIntents('How much is Zephyr Breeze Gel?'));
    expect(out).toContain('Price: ₱500');
    expect(out).not.toContain('Description:');
    expect(out).not.toContain('Related services:');
  });
  it('renders a bare-name overview with only stored facts', () => {
    const out = renderProductAnswer(GEL, ['overview']);
    expect(out).toContain('Zephyr Breeze Gel');
    expect(out).toContain('Description: A soothing gel for cooling and hydration.');
    expect(out).toContain('Category: Skincare Products');
    expect(out).toContain('Price: ₱500 per piece');
    expect(out).toContain('Availability: In stock');
    expect(out).toContain(`Related services: ${WAX_SESSION}, ${RESET_FACIAL}`);
  });

  it('never invents a field the clinic has not recorded', () => {
    const out = renderProductAnswer(GEL, ['overview']);
    // This fixture stores a description but no purpose, benefits, ingredients or usage.
    expect(out).toMatch(/^Description:/m);
    expect(out).not.toMatch(/^Purpose:/m);
    expect(out).not.toMatch(/^Benefits:/m);
    expect(out).not.toMatch(/^Ingredients:/m);
    expect(out).not.toMatch(/^Usage:/m);
  });

  it('renders stored purpose and benefits in an overview', () => {
    const detailed = p('Aurora Repair Cream', {
      id: 11,
      description: 'A calming repair cream.',
      purpose: 'Used to soothe dry, irritated skin.',
      benefits: 'Commonly used to support the moisture barrier.',
    });
    const out = renderProductAnswer(detailed, ['overview']);
    expect(out).toContain('Description: A calming repair cream.');
    expect(out).toContain('Purpose: Used to soothe dry, irritated skin.');
    expect(out).toContain('Benefits: Commonly used to support the moisture barrier.');
  });

  it('answers a purpose question from stored data without a missing note', () => {
    const detailed = p('Aurora Repair Cream', {
      id: 11,
      purpose: 'Used to soothe dry, irritated skin.',
    });
    const out = renderProductAnswer(detailed, detectIntents('what is aurora repair cream used for?'));
    expect(out).toContain('Purpose: Used to soothe dry, irritated skin.');
    expect(out).not.toContain('what it is used for');
  });

  it('answers a benefits question from stored data', () => {
    const detailed = p('Aurora Repair Cream', {
      id: 11,
      benefits: 'Commonly used to support the moisture barrier.',
    });
    const out = renderProductAnswer(detailed, detectIntents('what are the benefits of aurora repair cream?'));
    expect(out).toContain('Benefits: Commonly used to support the moisture barrier.');
  });

  it('reports only the missing field when its counterpart is present', () => {
    const partial = p('Aurora Repair Cream', {
      id: 11,
      purpose: 'Used to soothe dry, irritated skin.',
    });
    const out = renderProductAnswer(partial, ['overview', 'purpose', 'benefits']);
    expect(out).toContain('Purpose: Used to soothe dry, irritated skin.');
    expect(out).toContain('its benefits');
    expect(out).not.toContain('what it is used for');
  });

  it('still never invents ingredients or usage even when other content exists', () => {
    const detailed = p('Aurora Repair Cream', {
      id: 11,
      description: 'A calming repair cream.',
      purpose: 'Used to soothe dry, irritated skin.',
      benefits: 'Commonly used to support the moisture barrier.',
    });
    const out = renderProductAnswer(detailed, ['overview', 'ingredients', 'usage']);
    expect(out).not.toMatch(/^Ingredients:/m);
    expect(out).not.toMatch(/^Usage:/m);
    expect(out).toContain('its ingredients');
    expect(out).toContain('usage instructions');
  });

  it('says the catalogue holds only name and price when nothing is recorded', () => {
    const bare = p('Wisp Undescribed Balm', { id: 9 });
    const out = renderProductAnswer(bare, ['overview']);
    expect(out).toContain('not on file yet');
    expect(out).not.toMatch(/^Description:/m);
  });

  it('does not claim a missing-data note when a description exists', () => {
    // The catalogue genuinely holds a description here, so a "name and price
    // only" disclaimer would be inaccurate.
    expect(GEL.description).toBeTruthy();
    expect(renderProductAnswer(GEL, ['overview'])).not.toContain('name and price only');
  });

  it('says so explicitly when asked about missing details', () => {
    const out = renderProductAnswer(GEL, ['ingredients']);
    expect(out).toContain('its ingredients');
    expect(out).toContain('do not have those details on file');
  });

  it('answers a price question with the stored price', () => {
    const out = renderProductAnswer(SERUM, detectIntents('how much is quartz radiance serum?'));
    expect(out).toContain('Price: ₱1,600 per piece');
  });

  it('reports out of stock as a state, never as a count', () => {
    const out = renderProductAnswer(OUT_OF_STOCK, ['availability']);
    expect(out).toContain('Availability: Currently out of stock');
    expect(out).not.toMatch(/\b0 (in stock|units)\b/i);
  });

  it('omits related services when none are recorded', () => {
    const out = renderProductAnswer(SERUM, ['related_services']);
    expect(out).toContain('Related services:');
    expect(out).toContain('do not have those details on file');
  });

  it('answers every part of a multi-intent question', () => {
    const out = renderProductAnswer(BALM, detectIntents('what is midnight balm used for and how much is it?'));
    expect(out).toContain('Onyx Midnight Balm');
    expect(out).toContain('Price: ₱1,400 per piece');
    expect(out).toContain('what it is used for');
  });

  it('does not repeat a field when overview and price are both requested', () => {
    const out = renderProductAnswer(GEL, ['overview', 'price', 'availability']);
    const priceLines = out.split('\n').filter((l) => l.startsWith('Price:'));
    const availLines = out.split('\n').filter((l) => l.startsWith('Availability:'));
    expect(priceLines).toHaveLength(1);
    expect(availLines).toHaveLength(1);
  });

  it('always ends with the consult-a-professional note', () => {
    expect(renderProductAnswer(CATALOG[0], ['overview'])).toMatch(/clinic professionals/);
  });

  it('formats a zero price as free rather than ₱0', () => {
    const free = p('Vellum Complimentary Sample', { id: 10, unit_price: 0 });
    expect(renderProductAnswer(free, ['price'])).toContain('Price: Free');
  });
});

describe('product recommendations from recorded purposes', () => {
  it('matches a concern to stored descriptions rather than guessing from a product name', () => {
    const hydrating = p('Invented Moisture Product', { id: 50, purpose: 'Supports hydration for dry skin.' });
    const other = p('Acne Miracle', { id: 51, purpose: 'Adds color to nails.' });
    expect(recommendProducts([hydrating, other], 'Recommend products for dry skin')).toEqual([hydrating]);
    expect(recommendProducts([hydrating, other], 'Recommend products for acne')).toEqual([]);
  });

  it('does not recommend unavailable products or a purpose that explicitly excludes the concern', () => {
    const unavailable = p('Moisture Product', { purpose: 'Hydration for dry skin.', current_stock: 0 });
    const excluded = p('Other Product', { purpose: 'Not intended for acne.' });
    expect(recommendProducts([unavailable], 'Products for dry skin')).toEqual([]);
    expect(recommendProducts([excluded], 'Products for acne')).toEqual([]);
  });

  it('caps recommendations at three matching products', () => {
    const products = Array.from({ length: 8 }, (_, i) => p(`Moisture ${i}`, { id: i, purpose: 'Helps with dry skin hydration.' }));
    expect(recommendProducts(products, 'Products for dry skin')).toHaveLength(3);
  });
});

describe('looksLikeProductLookup', () => {
  it('catches a thing-question that never says "product"', () => {
    // These are the queries that would otherwise reach the model and get invented.
    expect(looksLikeProductLookup(normalizeQuery('what is hydroquinone booster used for'))).toBe(true);
    expect(looksLikeProductLookup(normalizeQuery('how do i use zephyr breeze gel'))).toBe(true);
    expect(looksLikeProductLookup(normalizeQuery('is it safe to use midnight balm'))).toBe(true);
    expect(looksLikeProductLookup(normalizeQuery('what are the ingredients in radiance serum'))).toBe(true);
    expect(looksLikeProductLookup(normalizeQuery('do you sell a cooling gel'))).toBe(true);
  });

  it('does not hijack clinic-operational questions of the same shape', () => {
    expect(looksLikeProductLookup(normalizeQuery('what are your clinic hours'))).toBe(false);
    expect(looksLikeProductLookup(normalizeQuery('what is your address'))).toBe(false);
    expect(looksLikeProductLookup(normalizeQuery('how do I cancel my appointment'))).toBe(false);
    expect(looksLikeProductLookup(normalizeQuery('what are your side effects'))).toBe(false);
    expect(looksLikeProductLookup(normalizeQuery('how much is the membership'))).toBe(false);
    expect(looksLikeProductLookup(normalizeQuery('what payment methods do you accept'))).toBe(false);
  });

  it('does not hijack service questions, which share the same question shape', () => {
    // "do you ...?" matches the lookup shape, so services must be excluded
    // explicitly or the catalog swallows the service menu.
    expect(looksLikeProductLookup(normalizeQuery('what services do you offer'))).toBe(false);
    expect(looksLikeProductLookup(normalizeQuery('do you have acne treatments'))).toBe(false);
    expect(looksLikeProductLookup(normalizeQuery('what treatment packages do you sell'))).toBe(false);
  });

  it('ignores a bare name, which the gate already covers', () => {
    expect(looksLikeProductLookup(normalizeQuery('zephyr breeze gel'))).toBe(false);
  });

  it('ignores unrelated chatter', () => {
    expect(looksLikeProductLookup(normalizeQuery('who are you'))).toBe(false);
    expect(looksLikeProductLookup(normalizeQuery('   '))).toBe(false);
  });
});

describe('isNonProductTopic', () => {
  it('recognizes generic service and category words', () => {
    expect(isNonProductTopic('services')).toBe(true);
    expect(isNonProductTopic('what are your hours?')).toBe(true);
    expect(isNonProductTopic('do you have packages')).toBe(true);
    expect(isNonProductTopic('how much is a facial')).toBe(true);
    expect(isNonProductTopic('do you offer laser')).toBe(true);
  });

  it('recognizes one-word service and treatment topics', () => {
    const topics = [
      'waxing', 'manicure', 'pedicure', 'biab', 'gel nails', 'threading',
      'lash lift', 'microblading', 'pmu', 'hifu', 'rf', 'rejuran', 'pdrn',
      'exosome', 'glutathione', 'vitamin c', 'nad', 'meso', 'gua sha',
      'body scrub', 'scalp', 'botox', 'filler', 'chemical peel',
    ];
    for (const topic of topics) {
      expect(isNonProductTopic(topic)).toBe(true);
    }
  });

  it('does not treat retail product names as non-product topics', () => {
    expect(isNonProductTopic('radiance serum')).toBe(false);
    expect(isNonProductTopic('zephyr breeze gel')).toBe(false);
    expect(isNonProductTopic('midnight balm')).toBe(false);
  });

  it('does not fire on unrelated chatter', () => {
    expect(isNonProductTopic('pizza')).toBe(false);
    expect(isNonProductTopic('   ')).toBe(false);
  });

  it('recognizes eye-area concerns, including the common "eyeabags" typo', () => {
    expect(isNonProductTopic('i have eyeabags')).toBe(true);
    expect(isNonProductTopic('eye bags')).toBe(true);
    expect(isNonProductTopic('under eye bags')).toBe(true);
    expect(isNonProductTopic('dark circles')).toBe(true);
    expect(isNonProductTopic('puffy eyes')).toBe(true);
  });

  it('recognizes concern and treatment vocabulary across every catalog category', () => {
    const topics = [
      'blackheads', 'whiteheads', 'black heads', 'extraction', 'dermaclear',
      'redness', 'rosacea', 'sensitive skin', 'eczema', 'stretch marks', 'keloid',
      'double chin', 'jawline', 'tightening', 'body fat', 'belly fat', 'love handles',
      'bra fat', 'cellulite', 'weight loss', 'underarm', 'armpit', 'hyperhidrosis',
      'body odor', 'sweating', 'chapped lips', 'dry lips', 'lip balm', 'shaving',
      'hairy legs', 'body hair', 'facial hair', 'acrylic', 'keratin', 'nail fungus',
      'milia',
    ];
    for (const topic of topics) {
      expect(isNonProductTopic(topic)).toBe(true);
    }
  });
});

describe('isReferentialProductFollowUp', () => {
  it('accepts a message that points back with a pronoun', () => {
    expect(isReferentialProductFollowUp(normalizeQuery('how much is it'))).toBe(true);
    expect(isReferentialProductFollowUp(normalizeQuery('how do I use it'))).toBe(true);
    expect(isReferentialProductFollowUp(normalizeQuery('tell me about this product'))).toBe(true);
    expect(isReferentialProductFollowUp(normalizeQuery('is that good for acne'))).toBe(true);
  });

  it('accepts a message made only of intent words', () => {
    expect(isReferentialProductFollowUp(normalizeQuery('how much?'))).toBe(true);
    expect(isReferentialProductFollowUp(normalizeQuery('price?'))).toBe(true);
  });

  it('rejects a question that names a new product', () => {
    // This is the case that would otherwise be answered about the previous
    // product and look authoritative while being wrong.
    expect(isReferentialProductFollowUp(normalizeQuery('what is hydroquinone booster used for'))).toBe(false);
    expect(isReferentialProductFollowUp(normalizeQuery('how much is zephyr breeze gel'))).toBe(false);
    expect(isReferentialProductFollowUp(normalizeQuery('benefits of midnight balm'))).toBe(false);
  });
});

describe('catalog browsing', () => {
  it('recognises a request for the whole catalog', () => {
    expect(isCatalogBrowseQuery(normalizeQuery('what products do you have'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('what items do you sell'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('list your products'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('do you sell products'))).toBe(true);
  });

  it('recognises a bare or lightly-qualified catalog request', () => {
    expect(isCatalogBrowseQuery(normalizeQuery('products'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('products?'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('product'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('items'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('your products'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('product list'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('items available'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('list of products'))).toBe(true);
    expect(isCatalogBrowseQuery(normalizeQuery('show me the products'))).toBe(true);
  });

  it('does not treat a specific product question as a browse', () => {
    expect(isCatalogBrowseQuery(normalizeQuery('how much is zephyr breeze gel'))).toBe(false);
    expect(isCatalogBrowseQuery(normalizeQuery('is zephyr breeze gel in stock'))).toBe(false);
  });

  it('requires the word product or item so it cannot hijack other questions', () => {
    expect(isCatalogBrowseQuery(normalizeQuery('what do you have'))).toBe(false);
    expect(isCatalogBrowseQuery(normalizeQuery('what services do you offer'))).toBe(false);
  });

  it('lists every product with its price when the customer explicitly asks for all', () => {
    const out = renderCatalogReply(CATALOG, true);
    expect(out).toContain(`We currently carry these ${CATALOG.length} products`);
    for (const prod of CATALOG) expect(out).toContain(prod.name);
  });

  it('caps how many products it lists', () => {
    const many = Array.from({ length: 30 }, (_, i) => p(`Kite Tonic ${i}`, { id: i + 1 }));
    expect(renderCatalogReply(many)).toContain('and 27 more');
  });

  it('falls back to the no-match reply when the catalog is empty', () => {
    expect(renderCatalogReply([])).toContain('could not find a product');
  });
});

describe('productsForService', () => {
  it('finds products linked to a service', () => {
    expect(productsForService(CATALOG, RESET_FACIAL).map((x) => x.name)).toEqual([
      'Nimbus Cloud Lotion',
      'Zephyr Breeze Gel',
    ]);
  });

  it('matches regardless of case', () => {
    expect(productsForService(CATALOG, RESET_FACIAL.toLowerCase()).length).toBe(2);
  });

  it('matches a partial service name', () => {
    expect(productsForService(CATALOG, 'Signature Reset').length).toBe(2);
  });

  it('returns nothing for a service with no linked product', () => {
    expect(productsForService(CATALOG, 'Laser Hair Removal')).toEqual([]);
  });

  it('returns nothing for an empty service name', () => {
    expect(productsForService(CATALOG, '   ')).toEqual([]);
  });
});

describe('renderRelatedProductsReply', () => {
  it('lists the products used with a service', () => {
    const out = renderRelatedProductsReply(WAX_SESSION, [GEL]);
    expect(out).toContain(`Products we use with ${WAX_SESSION}`);
    expect(out).toContain('Zephyr Breeze Gel');
    expect(out).toContain('₱500');
  });

  it('says so when no product is linked', () => {
    const out = renderRelatedProductsReply('Laser Hair Removal', []);
    expect(out).toContain('do not have a product on file');
    expect(out).not.toContain('₱');
  });
});

describe('ambiguous and no-match replies', () => {
  it('lists the matching options and asks which one was meant', () => {
    const m = matchProducts(CATALOG, 'radiance');
    if (m.kind !== 'ambiguous') throw new Error('expected ambiguous');
    const out = renderAmbiguousReply(m.products);
    expect(out).toContain('Which one did you mean?');
    expect(out).toContain('Quartz Radiance Serum');
    expect(out).toContain('Ember Radiance Clay Mask');
  });

  it('caps how many options it lists', () => {
    const many = Array.from({ length: 8 }, (_, i) => p(`Kite Zephyr Tonic ${i}`, { id: i + 1 }));
    const out = renderAmbiguousReply(many);
    expect(out).toContain('and 5 more');
  });

  it('does not describe a product it does not have', () => {
    const out = renderNoMatchReply();
    expect(out).toContain('could not find a product');
    expect(out).toContain('do not want to guess');
    expect(out).not.toContain('₱');
  });
});
