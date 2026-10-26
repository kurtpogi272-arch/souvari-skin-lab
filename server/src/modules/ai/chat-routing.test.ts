import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { db, modelCreate, modelConstructor } = vi.hoisted(() => ({
  db: {
    chat_sessions: { findUnique: vi.fn(), create: vi.fn() },
    chat_messages: { create: vi.fn(), findMany: vi.fn() },
    services: { findMany: vi.fn() }, products: { findMany: vi.fn() },
    appointments: { findMany: vi.fn() }, system_settings: { findMany: vi.fn() },
    transaction_items: { groupBy: vi.fn() },
  },
  modelCreate: vi.fn(), modelConstructor: vi.fn(),
}));
vi.mock('../../config/database', () => ({ default: db }));
vi.mock('../../config/env', () => ({ env: { AI_API_KEY: 'test-ai-key', AI_MODEL: 'test-model', AI_BASE_URL: 'https://example.invalid/v1' } }));
vi.mock('openai', () => ({ default: class {
  chat = { completions: { create: modelCreate } };
  constructor(options: unknown) { modelConstructor(options); }
} }));

import { AiService } from './ai.service';
import { clinicInfoIntent } from './clinic-info';
import { serviceKnowledge, renderServiceAnswer, namedServices } from './service-knowledge';
import { UNRECOGNIZED_REPLY } from './fallback-responses';

const services = [
  { id: 1, name: 'Abdomen', description: null, price: 500, duration_minutes: 30, category: 'body', group: { slug: 'diode-laser', name: 'DIODE LASER' } },
  { id: 2, name: 'Abdomen', description: null, price: 900, duration_minutes: 45, category: 'body', group: { slug: 'radio-frequency', name: 'RADIO FREQUENCY' } },
  { id: 3, name: '10 in 1 HydraFacial', description: null, price: 1299, duration_minutes: 60, category: 'facial' },
];
let ai: AiService;

beforeEach(() => {
  vi.clearAllMocks();
  ai = new AiService();
  db.chat_sessions.findUnique.mockResolvedValue({ id: 1, session_token: 'server-session' });
  db.chat_sessions.create.mockResolvedValue({ id: 1, session_token: 'server-session' });
  db.chat_messages.create.mockResolvedValue({});
  db.chat_messages.findMany.mockResolvedValue([]);
  db.services.findMany.mockResolvedValue(services);
  db.products.findMany.mockResolvedValue([]);
  db.appointments.findMany.mockResolvedValue([]);
  db.transaction_items.groupBy.mockResolvedValue([]);
  db.system_settings.findMany.mockResolvedValue([
    { setting_key: 'clinic_address', setting_value: JSON.stringify('2nd Floor, District Mall, Cavite') },
    { setting_key: 'clinic_phone', setting_value: JSON.stringify('+63 981 689 9909') },
    { setting_key: 'business_hours_start', setting_value: JSON.stringify('10:00') },
    { setting_key: 'business_hours_end', setting_value: JSON.stringify('20:00') },
  ]);
});
afterEach(() => vi.useRealTimers());

describe('reported brightening conversation regression', () => {
  beforeEach(() => {
    db.services.findMany.mockResolvedValue([
      ...services,
      { id: 4, name: 'Diamond Glow Classic', description: 'Cosmetic facial exfoliation for dull-looking skin.', price: 499, duration_minutes: 60, category: 'facial' },
      { id: 5, name: 'Underarms - Carbon Laser Whitening', description: null, price: 799, duration_minutes: 30, category: 'body', group: { slug: 'body-whitening', name: 'BODY WHITENING' } },
      { id: 6, name: 'Face', description: null, price: 900, duration_minutes: 45, category: 'body', group: { slug: 'radio-frequency', name: 'RADIO FREQUENCY' } },
      { id: 7, name: 'Full Lips Pigmentation', description: null, price: 9299, duration_minutes: 60, category: 'other', group: { slug: 'permanent-makeup', name: 'PERMANENT MAKE UP' } },
      { id: 8, name: 'Flanks', description: null, price: 7990, duration_minutes: 45, category: 'skin_rejuvenation', group: { slug: 'ultratight-hifu', name: 'UltraTight HIFU' } },
    ]);
    db.products.findMany.mockResolvedValue([
      { id: 10, name: 'Post Healing Cream (Aftercare for Warts/Skin Tag Removal)', description: 'Post-procedure aftercare cream.', purpose: 'For moisturising small treated areas after a removal procedure.', benefits: 'Supports comfort after the procedure.', sku: 'HEAL', unit: 'bottle', unit_price: 150, current_stock: 10, category: null, service_inventory_items: [] },
      { id: 11, name: 'Vitamin C Serum', description: 'A cosmetic serum.', purpose: 'Supports brightening for dull, uneven tone.', benefits: 'Supports a brighter-looking complexion.', sku: 'VITC', unit: 'bottle', unit_price: 500, current_stock: 10, category: null, service_inventory_items: [] },
      { id: 12, name: 'Aloe Vera Gel', description: 'A soothing topical gel.', purpose: 'Used to hydrate and soothe dry, irritated or sun-exposed skin.', benefits: 'Helps support hydration.', sku: 'ALOE', unit: 'bottle', unit_price: 500, current_stock: 10, category: null, service_inventory_items: [] },
      { id: 13, name: 'Bump Eraiser (Aftercare for Hot Waxing)', description: 'A concentrated aftercare solution.', purpose: 'Used after waxing to help manage ingrown hairs, redness and small bumps.', benefits: 'Supports smoother-looking skin.', sku: 'BUMP', unit: 'bottle', unit_price: 250, current_stock: 10, category: null, service_inventory_items: [] },
    ]);
  });

  const send = (message: string) => ai.processMessage({ message, session_token: 'server-session' });

  it('handles the exact sequence without returning the cream or repeating a generic clarification', async () => {
    expect((await send('where can I locate your store?')).response).toContain('District Mall');
    const ambiguous = (await send('I have dark skin')).response;
    expect(ambiguous).toContain('natural skin tone, dark spots, or uneven tone');
    expect(ambiguous).not.toContain('Post Healing Cream');

    const goal = (await send('I want to brighten my skin')).response;
    expect(goal).toContain('Is this for your face or body?');
    expect(goal).not.toContain('main skin concern');

    for (const message of ['brighten my skin', 'Can you recommend service that can brighten my skin?']) {
      const result = (await send(message)).response;
      expect(result).toContain('10 in 1 HydraFacial');
      expect(result).not.toContain('Post Healing Cream');
      expect(result).not.toContain('Full Lips Pigmentation');
      expect(result).not.toContain('Flanks');
      expect(result).not.toContain('main skin concern');
      expect(result).not.toContain('Is this for your face or body?');
      expect(result.split('\n').filter((line) => line.startsWith('- ')).length).toBeLessThanOrEqual(3);
    }
    const area = (await send('face')).response;
    expect(area).toContain('10 in 1 HydraFacial');
    expect(area).not.toContain('Underarms');
    expect(area).not.toContain('RADIO FREQUENCY');
    expect(area).not.toContain('main skin concern');
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it('does not let an earlier product topic capture a new service request containing "that"', async () => {
    expect((await send('Tell me about Post Healing Cream (Aftercare for Warts/Skin Tag Removal)')).response).toContain('Post Healing Cream');
    const request = (await send('Can you recommend service that can brighten my skin?')).response;
    expect(request).toContain('Is this for your face or body?');
    expect(request).not.toContain('Post Healing Cream');
    const response = (await send('face')).response;
    expect(response).toContain('10 in 1 HydraFacial');
    expect(response).not.toContain('Post Healing Cream');
  });

  it('keeps the goal when the customer answers only with a body area', async () => {
    await send('I want to brighten my skin');
    const result = (await send('underarms')).response;
    expect(result).toContain('Underarms - Carbon Laser Whitening');
    expect(result).not.toContain('main skin concern');
    expect(result).not.toContain('10 in 1 HydraFacial');
  });

  it('handles a greeting plus a specific concern without replying only with a greeting', async () => {
    const result = (await send('Hi, I want to brighten my skin')).response;
    expect(result).toContain('face or body');
    expect(result).not.toContain('Hello! Welcome');
  });

  it.each(['I have oily skin', 'I want help with acne', 'recommend a service for dryness'])(
    'answers the stated concern before generic skin prompts: "%s"', async (message) => {
      const result = (await send(message)).response;
      expect(result).not.toContain('Post Healing Cream');
      expect(result).not.toContain('main skin concern');
      if (message.includes('acne')) {
        expect(result).toBe('Is the acne on your face or body?');
        expect((await send('face')).response).toContain('₱');
      } else expect(result).toContain('₱');
    },
  );

  it.each(['Recommend products for brightening and uneven tone', 'Recommend a product to brighten my skin', 'Suggest products for uneven skin tone'])(
    'still answers explicit product recommendations and real follow-ups: "%s"', async (message) => {
    const products = (await send(message)).response;
    expect(products).toContain('Vitamin C Serum');
    expect(products).not.toContain('Post Healing Cream');
    const followUp = (await send('How much is it?')).response;
    expect(followUp).toContain('Vitamin C Serum');
    expect(followUp).toContain('₱500');
  });

  it('asks for the body part instead of suggesting arbitrary bikini or buttock services', async () => {
    await send('I have dark skin');
    await send('uneven tone');
    const body = (await send('for my body')).response;
    expect(body).toContain('Which part of your body');
    expect(body).not.toContain('₱');
    expect(body).not.toContain('Bikini');
    const newConcern = (await send('I have dark spots')).response;
    expect(newConcern).toBe('Where on your body are the dark spots?');
    expect(newConcern).not.toContain('Underarms - Carbon');
    expect((await send('I have acne')).response).toBe('Is the acne on your face or body?');
  });

  it('remembers the specific body part for a same-concern follow-up', async () => {
    await send('uneven tone');
    await send('body');
    const selected = (await send('underarms')).response;
    expect(selected).toContain('Underarms - Carbon Laser Whitening');
    const followUp = (await send('Can you recommend a service?')).response;
    expect(followUp).toContain('Underarms - Carbon Laser Whitening');
    expect(followUp).not.toContain('Which part');
  });

  it.each([
    ['What is aloe vera gel?', 'Aloe Vera Gel helps hydrate and soothe dry, irritated or sun-exposed skin.'],
    ['What is the use of Bump eraiser?', 'Bump Eraiser is used after waxing to help manage ingrown hairs, redness and small bumps.'],
  ])('answers "%s" in one complete, conversational sentence', async (message, expected) => {
    const reply = (await send(message)).response;
    expect(reply).toBe(expected);
    expect(reply).not.toMatch(/Category:|Description:|Purpose:|Benefits:|Price:|Availability:|\.\.\./);
    expect(reply).not.toContain('Please consult');
    expect(reply.split(/\s+/).length).toBeLessThan(40);
  });

  it('answers best-selling products using sales quantities rather than alphabetic catalog order', async () => {
    db.transaction_items.groupBy.mockResolvedValue([
      { product_id: 12, _sum: { quantity: 10 } }, { product_id: 13, _sum: { quantity: 3 } },
    ]);
    const reply = (await send('What are your best selling products?')).response;
    expect(reply).toBe('Our top products by recorded paid sales are Aloe Vera Gel, Bump Eraiser.');
    expect(db.transaction_items.groupBy).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        quantity: { gt: 0 }, transaction: { deleted_at: null, payment_status: 'paid', type: 'sale' },
      }),
      orderBy: [{ _sum: { quantity: 'desc' } }, { product_id: 'asc' }],
    }));
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it('does not invent best sellers when there are no product sales', async () => {
    const reply = (await send('What are your best selling products?')).response;
    expect(reply).toContain("don't have enough recorded product sales");
    expect(reply).not.toContain('Post Healing Cream');
    expect(reply).not.toContain('Vitamin C Serum');
    expect(reply).not.toContain('and 8 more');
  });

  it('does not substitute a catalog list when checking sales fails', async () => {
    db.transaction_items.groupBy.mockRejectedValue(new Error('Database unavailable'));
    const reply = (await send('most popular products?')).response;
    expect(reply).toContain("can't check product sales");
    expect(reply).not.toContain('Vitamin C Serum');
    expect(reply).not.toContain('We currently carry');
  });
});

describe('fast deterministic replies when AI is configured', () => {
  it.each(['Tell me about Skin Rejuvinating', 'Explain skin rejuvenation'])(
    'explains "%s" before considering recommendations or product matches', async (message) => {
      const result = await ai.processMessage({ message });
      expect(result.response).toContain('What it is:');
      expect(result.response).toContain("What it's for:");
      expect(result.response).toContain('Services at Souvari:');
      expect(result.response).toContain('10 in 1 HydraFacial');
      expect(result.response).not.toContain('you could ask about');
      expect(result.response).not.toContain('What would you like help with');
      expect(result.response).not.toContain('outside what I can help with');
      expect(modelCreate).not.toHaveBeenCalled();
    },
  );

  it.each([
    'How can I locate your store?', 'Hi, how can I find your clinic?', 'How do I get there?',
    'Where are you located?', 'Directions to your clinic', 'Can you show me a map of your store?',
  ])('answers "%s" with the saved address and map, without catalog or model calls', async (message) => {
    const result = await ai.processMessage({ message });
    expect(result.response).toContain('2nd Floor, District Mall, Cavite');
    expect(result.response).toContain('https://www.google.com/maps/search/?api=1&query=');
    expect(db.services.findMany).not.toHaveBeenCalled();
    expect(db.products.findMany).not.toHaveBeenCalled();
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it('does not turn a product storage question into a location reply', () => {
    expect(clinicInfoIntent('Where do I store my serum?')).toBeNull();
    expect(clinicInfoIntent('Where do you store your products?')).toBeNull();
    expect(clinicInfoIntent('What are the usage directions for sunscreen?')).toBeNull();
    expect(clinicInfoIntent('Can you address my acne concern?')).toBeNull();
    expect(clinicInfoIntent('Where do you apply the cream?')).toBeNull();
    expect(clinicInfoIntent('Can I use it after 24 hours?')).toBeNull();
  });

  it('does not invent a location when settings are empty', async () => {
    db.system_settings.findMany.mockResolvedValue([]);
    const result = await ai.processMessage({ message: 'How can I locate your store?' });
    expect(result.response).toContain('address is not on file');
    expect(result.response).not.toContain('google.com');
  });

  it('answers hours immediately without loading service or product catalogs', async () => {
    const result = await ai.processMessage({ message: 'What are your clinic hours?' });
    expect(result.response).toContain('10:00 AM - 8:00 PM');
    expect(db.services.findMany).not.toHaveBeenCalled();
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it('answers purpose and price directly from service evidence', async () => {
    const result = await ai.processMessage({ message: 'What is 10 in 1 HydraFacial used for and how much is it?' });
    expect(result.response).toContain('cleansing, exfoliation and hydration');
    expect(result.response).toContain('₱1,299');
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it.each(['Nimbus Face Mask', 'Nimbus Aftercare Gel (Aftercare for Waxing)'])(
    'answers the exact product "%s" before interpreting its name as a service or aftercare request', async (name) => {
      db.services.findMany.mockResolvedValue([...services, { ...services[0], id: 40, name: 'Face' }]);
      db.products.findMany.mockResolvedValue([{
        id: 10, name, description: 'A customer product.', purpose: 'Supports skin hydration.', benefits: 'Moisturizes dry skin.',
        sku: 'NIMBUS', unit: 'piece', unit_price: 500, current_stock: 10, category: null, service_inventory_items: [],
      }]);
      const result = await ai.processMessage({ message: `What is ${name} used for?` });
      expect(result.response).toContain(name.split(' (Aftercare')[0]);
      expect(result.response).toContain('supports skin hydration.');
      expect(result.response).not.toContain('specific aftercare');
      expect(result.response).not.toContain('Which treatment');
      expect(modelCreate).not.toHaveBeenCalled();
    },
  );

  it('clarifies identical service names rather than confusing treatment technologies', async () => {
    const choice = await ai.processMessage({ message: 'What is Abdomen?' });
    expect(choice.response).toContain('Which treatment did you mean?');
    expect(choice.response).toContain('DIODE LASER');
    expect(choice.response).toContain('RADIO FREQUENCY');
    const selected = await ai.processMessage({ message: 'What about the second one?', session_token: choice.session_token });
    expect(selected.response).toContain('Radiofrequency');
    const price = await ai.processMessage({ message: 'How much is it?', session_token: choice.session_token });
    expect(price.response).toContain('₱900');
    expect(price.response).not.toContain('₱500');
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it('keeps new named-service questions separate from a previous conversation topic', async () => {
    await ai.processMessage({ message: 'Tell me about Abdomen RF' });
    const result = await ai.processMessage({ message: 'Tell me about 10 in 1 HydraFacial', session_token: 'server-session' });
    expect(result.response).toContain('hydration');
    expect(result.response).not.toContain('Radiofrequency');
  });

  it('refreshes the service catalog after the short cache lifetime', async () => {
    vi.useFakeTimers();
    await ai.processMessage({ message: 'Tell me about 10 in 1 HydraFacial' });
    await ai.processMessage({ message: 'Tell me about 10 in 1 HydraFacial' });
    expect(db.services.findMany).toHaveBeenCalledTimes(1);
    db.services.findMany.mockResolvedValue([{ ...services[2], price: 1500 }]);
    vi.advanceTimersByTime(30001);
    const updated = await ai.processMessage({ message: 'How much is 10 in 1 HydraFacial?' });
    expect(updated.response).toContain('₱1,500');
    expect(db.services.findMany).toHaveBeenCalledTimes(2);
  });

  it('does not retry an unanswered model request and immediately uses the existing fallback on error', async () => {
    db.services.findMany.mockResolvedValue([]);
    modelCreate.mockRejectedValue(Object.assign(new Error('Provider unavailable'), { status: 429 }));
    const result = await ai.processMessage({ message: 'Can you explain dermaplaning terminology?' });
    expect(modelConstructor).toHaveBeenCalledWith(expect.objectContaining({ timeout: 8000, maxRetries: 0 }));
    expect(modelCreate).toHaveBeenCalledTimes(1);
    expect(result.response).toBe(UNRECOGNIZED_REPLY);
  });
});

describe('service knowledge precision', () => {
  it('uses group identity for body-area entries', () => {
    expect(serviceKnowledge(services[0]).summary).toContain('unwanted hair');
    expect(serviceKnowledge(services[1]).summary).toContain('Radiofrequency');
    expect(namedServices('How much is Abdomen RF?', services).map((s) => s.id)).toEqual([2]);
  });

  it('keeps clinic descriptions authoritative and does not invent brand formulations', () => {
    expect(serviceKnowledge({ ...services[2], description: 'Clinic-confirmed description.' }).summary).toBe('Clinic-confirmed description.');
    const brand = serviceKnowledge({ ...services[2], name: 'Luhilo Bio-Remodeling: Underarm Whitening', group: { slug: 'doctors-procedures', name: 'DOCTORS PROCEDURES' } });
    expect(brand.summary).toContain('underarm appearance');
    expect(brand.summary).toContain('confirmed by a clinician');
    expect(brand.consultationRequired).toBe(true);
  });

  it('answers compound purpose, price and duration questions', () => {
    const result = renderServiceAnswer(services[2], 'What is it used for, how much and how long?');
    expect(result).toContain('hydration');
    expect(result).toContain('₱1,299');
    expect(result).toContain('60 minutes');
  });

  it('does not confuse appointment length with how long treatment results last', () => {
    const result = renderServiceAnswer(services[2], 'How long do results from 10 in 1 HydraFacial last?');
    expect(result).toContain('appointment length is not the duration of results');
    expect(result).not.toContain('60 minutes');
  });

  it('does not invent service-specific risks when a treatment is named', () => {
    const result = renderServiceAnswer(services[2], 'What are the risks of 10 in 1 HydraFacial?');
    expect(result).toContain('not have confirmed details about risks and side effects');
  });

  it('keeps distinct services in a comparison instead of only selecting the longest name', async () => {
    const result = await ai.processMessage({ message: 'Compare Abdomen RF and 10 in 1 HydraFacial' });
    expect(result.response).toContain('Abdomen — RADIO FREQUENCY');
    expect(result.response).toContain('10 in 1 HydraFacial');
    expect(result.response).not.toContain('Which treatment');
    expect(modelCreate).not.toHaveBeenCalled();
  });

  it('answers price-only questions concisely and preserves VIP and non-member pricing', () => {
    const result = renderServiceAnswer({ ...services[2], vip_price: 1000, non_member_price: 1400 }, 'How much is it?');
    expect(result).toContain('VIP: ₱1,000');
    expect(result).toContain('Non-member: ₱1,400');
    expect(result).not.toContain('hydration');
    expect(result.split('\n')).toHaveLength(1);
  });
});
