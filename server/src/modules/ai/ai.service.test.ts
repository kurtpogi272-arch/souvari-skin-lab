import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  findUnique,
  createSession,
  createMessage,
  servicesFindMany,
  productsFindMany,
  settingsFindMany,
} = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createSession: vi.fn(),
  createMessage: vi.fn(),
  servicesFindMany: vi.fn(),
  productsFindMany: vi.fn(),
  settingsFindMany: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../config/database', () => ({
  default: {
    chat_sessions: { findUnique, create: createSession },
    chat_messages: { create: createMessage },
    services: { findMany: servicesFindMany },
    products: { findMany: productsFindMany },
    system_settings: { findUnique: vi.fn(), findMany: settingsFindMany },
    appointments: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

// Force the deterministic engine so tests never attempt a real model call.
vi.mock('../../config/env', () => ({
  env: { AI_API_KEY: '', AI_MODEL: 'gpt-3.5-turbo', AI_BASE_URL: undefined },
}));

import { AiService } from './ai.service';

let aiService: AiService;
beforeEach(() => { aiService = new AiService(); });

const CATALOG = [
  { id: 1, name: '10 in 1 HydraFacial', description: 'Deep clean', price: 1500, duration_minutes: 60, category: 'facial' },
  { id: 2, name: 'Hollywood Carbon Laser Peel (Face)', description: 'Refine pores', price: 2000, duration_minutes: 45, category: 'laser' },
  { id: 3, name: 'Full Legs', description: 'Laser hair removal', price: 3000, duration_minutes: 60, category: 'hair_removal' },
  { id: 4, name: 'Free Skin Consultation', description: 'Consult', price: 0, duration_minutes: 15, category: 'consultation' },
  { id: 5, name: 'Signature Manicure (No polish)', description: 'Nails', price: 400, duration_minutes: 45, category: 'other' },
  { id: 6, name: 'Essential Hand Spa', description: 'Spa', price: 600, duration_minutes: 60, category: 'other' },
  { id: 7, name: 'Lemon Bio-Lipolysis: Body Focus', description: 'Fat', price: 2500, duration_minutes: 45, category: 'injection' },
];

describe('AiService.processMessage error handling', () => {
  beforeEach(() => {
    findUnique.mockReset();
    createSession.mockReset();
    createMessage.mockReset();

    findUnique.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: 1, session_token: 'sess' });
    createMessage.mockResolvedValue({});
    servicesFindMany.mockResolvedValue(CATALOG);
    productsFindMany.mockResolvedValue([]);
  });

  it('answers gracefully instead of throwing when the database fails', async () => {
    createSession.mockRejectedValue(new Error('database is down'));

    const result = await aiService.processMessage({ message: 'what are your hours?' });

    expect(result.response).toContain("I'm sorry, something went wrong");
    expect(typeof result.response).toBe('string');
  });

  it('echoes the incoming session token back when recovering from an error', async () => {
    findUnique.mockRejectedValue(new Error('database is down'));

    const result = await aiService.processMessage({
      message: 'services',
      session_token: 'keep-me',
    });

    expect(result.session_token).toBe('keep-me');
  });
});

describe('AiService concern routing', () => {
  beforeEach(() => {
    findUnique.mockReset();
    createSession.mockReset();
    createMessage.mockReset();
    servicesFindMany.mockReset();
    productsFindMany.mockReset();

    findUnique.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: 1, session_token: 'sess' });
    createMessage.mockResolvedValue({});
    servicesFindMany.mockResolvedValue(CATALOG);
    productsFindMany.mockResolvedValue([]);
  });

  it.each(['pores', 'oily', 'blackheads', 'dry lips', 'fat', 'spa', 'hairy legs'])(
    'answers the concern "%s" instead of reporting a missing product',
    async (message) => {
      const result = await aiService.processMessage({ message });

      expect(result.response).not.toContain('could not find a product');
      expect(result.response).not.toContain('outside what I can help with');
    },
  );

  it.each(['pizza', 'ufo', 'spaghetti recipe', 'the weather today'])(
    'still refuses off-topic chatter "%s"',
    async (message) => {
      const result = await aiService.processMessage({ message });

      expect(result.response).toContain('outside what I can help with');
    },
  );

  it('still answers a real retail product by name', async () => {
    productsFindMany.mockResolvedValue([
      {
        id: 1,
        name: 'Sunscreen SPF50+',
        description: 'Broad spectrum sun protection.',
        purpose: null,
        benefits: null,
        sku: 'SKU-1',
        unit: 'piece',
        unit_price: 500,
        current_stock: 10,
        category: { name: 'Retail Items' },
        service_inventory_items: [],
      },
    ]);

    const result = await aiService.processMessage({ message: 'sunscreen' });

    expect(result.response).toContain('Sunscreen SPF50+');
  });
});

describe('AiService medical safety and graceful errors', () => {
  beforeEach(() => {
    findUnique.mockReset();
    createSession.mockReset();
    createMessage.mockReset();
    servicesFindMany.mockReset();
    productsFindMany.mockReset();

    findUnique.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: 1, session_token: 'sess' });
    createMessage.mockResolvedValue({});
    servicesFindMany.mockResolvedValue(CATALOG);
    productsFindMany.mockResolvedValue([]);
  });

  it.each([
    'I am having an emergency',
    "I can't breathe",
    'my throat is swelling',
    'severe chest pain',
  ])('answers the emergency "%s" with emergency guidance', async (message) => {
    const result = await aiService.processMessage({ message });

    expect(result.response).toContain('911');
  });

  it('does not let a greeting swallow an emergency', async () => {
    const result = await aiService.processMessage({ message: "hi, I can't breathe" });

    expect(result.response).toContain('911');
  });

  it.each([
    'I am pregnant, can I get a facial?',
    'I take Accutane, can I do a peel?',
    'will it cure my acne permanently?',
  ])('refers the medical question "%s" to clinic professionals', async (message) => {
    const result = await aiService.processMessage({ message });

    expect(result.response).toContain('medical advice');
    expect(result.response).toContain('Free Skin Consultation');
    expect(result.response).not.toContain('911');
  });

  it('reports retrieval failure honestly when the catalog cannot be read', async () => {
    servicesFindMany.mockRejectedValue(new Error('database is down'));

    const result = await aiService.processMessage({ message: 'what services do you offer?' });

    expect(result.response).toContain('unable to retrieve');
  });

  it('still answers a normal service question after the safety checks', async () => {
    const result = await aiService.processMessage({ message: 'recommend something for acne' });

    expect(result.response).not.toContain('911');
    expect(result.response).not.toContain('medical advice');
    expect(result.response.length).toBeGreaterThan(0);
  });
});

describe('AiService relevance gate covers the concern vocabulary', () => {
  beforeEach(() => {
    findUnique.mockReset();
    createSession.mockReset();
    createMessage.mockReset();
    servicesFindMany.mockReset();
    productsFindMany.mockReset();

    findUnique.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: 1, session_token: 'sess' });
    createMessage.mockResolvedValue({});
    servicesFindMany.mockResolvedValue(CATALOG);
    productsFindMany.mockResolvedValue([]);
  });

  // Regression: the bot's own clarifying question lists concerns such as
  // "dryness", and short answers to it were being refused as off-topic because
  // the gate did not know the concern vocabulary.
  it.each([
    'dryness',
    'dull',
    'dullness',
    'flaky',
    'flakiness',
    'dehydrated',
    'oily',
    'uneven tone',
    'redness',
    'face',
    'body',
  ])('answers the concern answer "%s" instead of refusing it', async (message) => {
    const result = await aiService.processMessage({ message });

    expect(result.response).not.toContain('outside what I can help with');
    expect(result.response).not.toContain('could not find a product');
  });

  it('gives a real recommendation for "dryness" (the reported case)', async () => {
    const result = await aiService.processMessage({ message: 'dryness' });

    expect(result.response).toContain('₱');
  });

  it('recommends for a noun form like "dullness", not just the adjective "dull"', async () => {
    const result = await aiService.processMessage({ message: 'dullness' });

    expect(result.response).not.toContain('outside what I can help with');
    expect(result.response).toContain('₱');
  });

  it('treats a bare area word as a topic, not a product name', async () => {
    productsFindMany.mockResolvedValue([
      {
        id: 2,
        name: 'Collagen Face Mask (10-pack)',
        description: 'Hydrating face masks.',
        purpose: null,
        benefits: null,
        sku: 'SKU-2',
        unit: 'box',
        unit_price: 2000,
        current_stock: 5,
        category: { name: 'Retail Items' },
        service_inventory_items: [],
      },
    ]);

    const result = await aiService.processMessage({ message: 'face' });

    expect(result.response).not.toContain('Collagen Face Mask');
    expect(result.response).not.toContain('outside what I can help with');
  });

  it('still matches a real product when the area word is part of its name', async () => {
    productsFindMany.mockResolvedValue([
      {
        id: 2,
        name: 'Collagen Face Mask (10-pack)',
        description: 'Hydrating face masks.',
        purpose: null,
        benefits: null,
        sku: 'SKU-2',
        unit: 'box',
        unit_price: 2000,
        current_stock: 5,
        category: { name: 'Retail Items' },
        service_inventory_items: [],
      },
    ]);

    const result = await aiService.processMessage({ message: 'collagen face mask' });

    expect(result.response).toContain('Collagen Face Mask');
  });

  it.each(['pizza', 'ufo', 'spaghetti recipe', 'the weather today'])(
    'still refuses off-topic chatter "%s"',
    async (message) => {
      const result = await aiService.processMessage({ message });

      expect(result.response).toContain('outside what I can help with');
    },
  );
});

describe('AiService honest handling of questions it cannot answer', () => {
  beforeEach(() => {
    findUnique.mockReset();
    createSession.mockReset();
    createMessage.mockReset();
    servicesFindMany.mockReset();
    productsFindMany.mockReset();
    settingsFindMany.mockReset();

    findUnique.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: 1, session_token: 'sess' });
    createMessage.mockResolvedValue({});
    servicesFindMany.mockResolvedValue(CATALOG);
    productsFindMany.mockResolvedValue([]);
    settingsFindMany.mockResolvedValue([]);
  });

  it('admits a gap instead of guessing when an on-topic question has no stored answer', async () => {
    const result = await aiService.processMessage({
      message: 'what is your cancellation policy for a facial?',
    });

    expect(result.response).toContain("I don't have that specific information");
    expect(result.response).not.toContain('outside what I can help with');
  });

  it('answers an explicit help request with the capability list', async () => {
    const result = await aiService.processMessage({ message: 'help' });

    expect(result.response).toContain('I can help you with');
    expect(result.response).not.toContain('outside what I can help with');
  });

  it('does not treat a request that merely contains "help" as a help prompt', async () => {
    const result = await aiService.processMessage({ message: 'help me find sunscreen' });

    expect(result.response).not.toContain('I can help you with:');
  });

  it('never claims a service is permanently unavailable when it cannot be found', async () => {
    const result = await aiService.processMessage({ message: 'do you offer underwater massage?' });

    expect(result.response).not.toContain("don't offer");
    expect(result.response).not.toContain('do not offer');
  });

  it('composes clinic hours from the operational settings, not a hardcoded string', async () => {
    settingsFindMany.mockResolvedValue([
      { setting_key: 'business_hours_start', setting_value: '"10:00"' },
      { setting_key: 'business_hours_end', setting_value: '"20:00"' },
      {
        setting_key: 'business_days',
        setting_value: '["monday","tuesday","wednesday","thursday","friday","saturday"]',
      },
    ]);

    const result = await aiService.processMessage({ message: 'what are your hours?' });

    expect(result.response).toContain('Monday-Saturday: 10:00 AM - 8:00 PM, Sunday: Closed');
  });

  it('reflects a different schedule from settings', async () => {
    settingsFindMany.mockResolvedValue([
      { setting_key: 'business_hours_start', setting_value: '"09:00"' },
      { setting_key: 'business_hours_end', setting_value: '"18:00"' },
      {
        setting_key: 'business_days',
        setting_value: '["monday","tuesday","wednesday","thursday","friday"]',
      },
    ]);

    const result = await aiService.processMessage({ message: 'what are your hours?' });

    expect(result.response).toContain('Monday, Tuesday, Wednesday, Thursday, Friday: 9:00 AM - 6:00 PM');
    expect(result.response).not.toContain('Sunday');
  });

  it('answers an aftercare question honestly instead of inventing instructions', async () => {
    const result = await aiService.processMessage({
      message: 'what should I do after a facial?',
    });

    expect(result.response).toContain("don't have specific aftercare");
    expect(result.response).not.toContain('outside what I can help with');
  });

  it('answers a preparation question honestly instead of inventing instructions', async () => {
    const result = await aiService.processMessage({
      message: 'how do I prepare for my appointment?',
    });

    expect(result.response).toContain("don't have specific preparation");
    expect(result.response).not.toContain('outside what I can help with');
  });

  it('refers contraindication questions to our professionals, not an answer', async () => {
    const result = await aiService.processMessage({
      message: 'are there contraindications for laser?',
    });

    expect(result.response).toContain('not able to give medical advice');
  });

  it('answers "tell me about your clinic" with a clinic overview, not a product miss', async () => {
    settingsFindMany.mockResolvedValue([
      { setting_key: 'clinic_name', setting_value: '"Souvari Skin Lab"' },
      { setting_key: 'clinic_address', setting_value: '"2nd Floor, The District"' },
      { setting_key: 'clinic_phone', setting_value: '"+63 981 689 9909"' },
      { setting_key: 'business_hours_start', setting_value: '"10:00"' },
      { setting_key: 'business_hours_end', setting_value: '"20:00"' },
      {
        setting_key: 'business_days',
        setting_value: '["monday","tuesday","wednesday","thursday","friday","saturday"]',
      },
    ]);

    const result = await aiService.processMessage({ message: 'tell me about your clinic' });

    expect(result.response).toContain('Souvari Skin Lab');
    expect(result.response).toContain('2nd Floor, The District');
    expect(result.response).not.toContain('could not find a product');
    expect(result.response).not.toContain('outside what I can help with');
  });

  it('answers "who are you?" without a product miss', async () => {
    const result = await aiService.processMessage({ message: 'who are you?' });

    expect(result.response).not.toContain('could not find a product');
    expect(result.response).not.toContain('outside what I can help with');
  });
});

describe('AiService product catalog browsing', () => {
  beforeEach(() => {
    findUnique.mockReset();
    createSession.mockReset();
    createMessage.mockReset();
    servicesFindMany.mockReset();
    productsFindMany.mockReset();

    findUnique.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: 1, session_token: 'sess' });
    createMessage.mockResolvedValue({});
    servicesFindMany.mockResolvedValue(CATALOG);
    productsFindMany.mockResolvedValue([
      {
        id: 1,
        name: 'Nimbus Cloud Lotion',
        description: null,
        purpose: null,
        benefits: null,
        sku: 'SKU-1',
        unit: 'pc',
        unit_price: 750,
        current_stock: 12,
        category: { name: 'Retail Items' },
        service_inventory_items: [],
      },
    ]);
  });

  // Regression: a bare "products" was refused as off-topic because the catalog
  // browse check required a "what/which" or a "have/sell" verb.
  it.each(['products', 'products?', 'product', 'items', 'your products', 'product list', 'items available'])(
    'lists the catalog for "%s" instead of refusing it',
    async (message) => {
      const result = await aiService.processMessage({ message });

      expect(result.response).toContain('We currently carry these');
      expect(result.response).toContain('Nimbus Cloud Lotion');
      expect(result.response).not.toContain('outside what I can help with');
    },
  );

  // Regression: a deployment whose database is a migration behind (so the
  // purpose/benefits columns are absent) must still answer product questions
  // rather than reporting that it has nothing on file. The loader retries with
  // fewer columns instead of throwing.
  it('lists the catalog even when the product content columns are missing', async () => {
    productsFindMany
      .mockRejectedValueOnce(
        Object.assign(
          new Error('Unknown column \'products.purpose\' in \'field list\''),
          { code: 'P2022' },
        ),
      )
      .mockResolvedValueOnce([
        {
          id: 2,
          name: 'Nimbus Cloud Lotion',
          description: null,
          sku: 'SKU-2',
          unit: 'pc',
          unit_price: 750,
          current_stock: 12,
          category: { name: 'Retail Items' },
          service_inventory_items: [],
        },
      ]);

    const result = await aiService.processMessage({ message: 'what are available products?' });

    expect(result.response).toContain('We currently carry these');
    expect(result.response).toContain('Nimbus Cloud Lotion');
    expect(result.response).not.toContain("don't have that specific information");
    expect(productsFindMany).toHaveBeenCalledTimes(2);
  });
});

describe('AiService policy and treatment-logistics routing', () => {
  beforeEach(() => {
    findUnique.mockReset();
    createSession.mockReset();
    createMessage.mockReset();
    servicesFindMany.mockReset();
    productsFindMany.mockReset();
    settingsFindMany.mockReset();

    findUnique.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: 1, session_token: 'sess' });
    createMessage.mockResolvedValue({});
    servicesFindMany.mockResolvedValue(CATALOG);
    productsFindMany.mockResolvedValue([]);
    settingsFindMany.mockResolvedValue([]);
  });

  it.each([
    'do you offer packages?',
    'do you have a membership?',
    'do you have gift cards?',
    'do you have parking?',
    'do you accept walk-ins?',
    'can i reschedule my appointment?',
  ])('answers the policy question "%s" honestly instead of guessing', async (message) => {
    const result = await aiService.processMessage({ message });

    expect(result.response).toContain("I don't have that specific information");
    expect(result.response).not.toContain('outside what I can help with');
  });

  it('no longer claims session packages or VIP memberships exist', async () => {
    const result = await aiService.processMessage({ message: 'do you offer packages?' });

    expect(result.response).not.toContain('session packages');
    expect(result.response).not.toContain('VIP memberships');
    expect(result.response).not.toContain("don't offer");
  });

  it.each([
    ['is there any downtime?', 'downtime'],
    ['does it hurt?', 'pain'],
    ['what are the side effects?', 'side effects'],
  ])('answers the treatment-logistics question "%s" honestly', async (message) => {
    const result = await aiService.processMessage({ message });

    expect(result.response).toContain("don't want to guess");
    expect(result.response).not.toContain('outside what I can help with');
    expect(result.response).not.toContain('Our clinic hours');
  });

  it('still answers how long a specific service takes from its stored duration', async () => {
    const result = await aiService.processMessage({ message: 'how long does 10 in 1 HydraFacial take?' });

    expect(result.response).toContain('10 in 1 HydraFacial');
    expect(result.response).toContain('Duration: 60 minutes');
  });
});

describe('AiService product vs. service/concern precedence', () => {
  beforeEach(() => {
    findUnique.mockReset();
    createSession.mockReset();
    createMessage.mockReset();
    servicesFindMany.mockReset();
    productsFindMany.mockReset();

    findUnique.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: 1, session_token: 'sess' });
    createMessage.mockResolvedValue({});
    servicesFindMany.mockResolvedValue(CATALOG);
    productsFindMany.mockResolvedValue([
      {
        id: 1,
        name: 'Acne Treatment Cream',
        description: 'For breakouts.',
        purpose: null,
        benefits: null,
        sku: 'SKU-1',
        unit: 'tube',
        unit_price: 450,
        current_stock: 10,
        category: { name: 'Retail Items' },
        service_inventory_items: [],
      },
      {
        id: 2,
        name: 'Collagen Face Mask',
        description: 'Hydrating face masks.',
        purpose: null,
        benefits: null,
        sku: 'SKU-2',
        unit: 'box',
        unit_price: 2000,
        current_stock: 5,
        category: { name: 'Retail Items' },
        service_inventory_items: [],
      },
    ]);
  });

  it.each(['acne', 'collagen'])(
    'treats the bare concern "%s" as a clinic topic, not a product',
    async (message) => {
      const result = await aiService.processMessage({ message });

      expect(result.response).not.toContain('Acne Treatment Cream');
      expect(result.response).not.toContain('Collagen Face Mask');
      expect(result.response).not.toContain('outside what I can help with');
    },
  );

  it('still returns the product when the user clearly asks about a product', async () => {
    const result = await aiService.processMessage({ message: 'do you sell the collagen face mask?' });

    expect(result.response).toContain('Collagen Face Mask');
  });
});

describe('AiService alias and umbrella routing', () => {
  beforeEach(() => {
    findUnique.mockReset();
    createSession.mockReset();
    createMessage.mockReset();
    servicesFindMany.mockReset();
    productsFindMany.mockReset();
    settingsFindMany.mockReset();

    findUnique.mockResolvedValue(null);
    createSession.mockResolvedValue({ id: 1, session_token: 'sess' });
    createMessage.mockResolvedValue({});
    servicesFindMany.mockResolvedValue(CATALOG);
    productsFindMany.mockResolvedValue([]);
    settingsFindMany.mockResolvedValue([]);
  });

  it.each(['skincare', 'skin care', 'beauty', 'aesthetics'])(
    'answers the umbrella topic "%s" with the service overview, not a refusal',
    async (message) => {
      const result = await aiService.processMessage({ message });

      expect(result.response).not.toContain('outside what I can help with');
      expect(result.response).toContain('facials');
    },
  );

  it('routes "pricing" to the pricing clarification instead of a product miss', async () => {
    const result = await aiService.processMessage({ message: 'do you have a pricing list?' });

    expect(result.response).not.toContain('could not find a product');
    expect(result.response).not.toContain('outside what I can help with');
    expect(result.response).toContain('pricing for');
  });

  it('routes a reservation question to the booking information', async () => {
    const result = await aiService.processMessage({ message: 'how do i make a reservation?' });

    expect(result.response).not.toContain('outside what I can help with');
    expect(result.response).toContain('booking page');
  });

  it('routes "what is your number?" to the contact information', async () => {
    settingsFindMany.mockResolvedValue([
      { setting_key: 'clinic_phone', setting_value: '"+63 981 689 9909"' },
      { setting_key: 'clinic_address', setting_value: '"2nd Floor, The District"' },
    ]);

    const result = await aiService.processMessage({ message: 'what is your number?' });

    expect(result.response).toContain('Contact Information');
    expect(result.response).not.toContain('outside what I can help with');
  });
});
