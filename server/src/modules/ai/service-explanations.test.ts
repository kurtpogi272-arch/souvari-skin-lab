import { describe, expect, it } from 'vitest';
import { explainNamedService, explainSkinRejuvenation, isSkinRejuvenationExplanation, wantsServiceExplanation } from './service-explanations';
import { ChatService } from './service-knowledge';

const services: ChatService[] = [
  { id: 1, name: '10 in 1 HydraFacial', description: null, category: 'facial', price: 1299, duration_minutes: 60 },
  { id: 2, name: 'Face', description: null, category: 'skin_rejuvenation', price: 900, duration_minutes: 45, group: { slug: 'radio-frequency', name: 'RADIO FREQUENCY' } },
  { id: 3, name: 'Full Face Lift: Jaw, Chin & Neck', description: null, category: 'skin_rejuvenation', price: 6490, duration_minutes: 75, group: { slug: 'ultratight-hifu', name: 'UltraTight HIFU' } },
  { id: 4, name: 'Flanks', description: null, category: 'skin_rejuvenation', price: 7990, duration_minutes: 60, group: { slug: 'ultratight-hifu', name: 'UltraTight HIFU' } },
];

describe('service explanation intent', () => {
  it.each([
    'Tell me about Skin Rejuvinating', 'Tell me about skin rejuvenating',
    'Explain skin rejuvination', 'Describe skin rejuvenation', 'What is skin rejuvenation?',
  ])('recognizes the educational question "%s"', (message) => {
    expect(isSkinRejuvenationExplanation(message)).toBe(true);
  });

  it.each([
    'Recommend skin rejuvenation for me', 'How much is skin rejuvenation?',
    'Tell me about Skin Rejuvenating Cream', 'What are the risks of skin rejuvenation?',
  ])('does not turn a different intent into a category lecture: "%s"', (message) => {
    expect(isSkinRejuvenationExplanation(message)).toBe(false);
  });

  it('defines the topic and purpose before grounded service examples', () => {
    const result = explainSkinRejuvenation(services);
    expect(result.response.indexOf('What it is:')).toBeLessThan(result.response.indexOf('Services at Souvari:'));
    expect(result.response).toContain("What it's for:");
    expect(result.response).toContain('not one specific procedure');
    expect(result.response).toContain('10 in 1 HydraFacial');
    expect(result.response).toContain('Face — RADIO FREQUENCY');
    expect(result.response).toContain('Full Face Lift: Jaw, Chin & Neck');
    expect(result.response).not.toContain('Flanks');
    expect(result.response).not.toContain('₱');
    expect(result.response).not.toContain('recommend');
    expect(result.discussed.map((s) => s.id)).toEqual([1, 2, 3]);
    expect(result.response.split(/\s+/).length).toBeLessThan(220);
  });

  it('does not invent service examples when the matching catalog is empty', () => {
    const result = explainSkinRejuvenation([]);
    expect(result.response).toContain('not one specific procedure');
    expect(result.response).toContain('do not have a confirmed matching service list');
    expect(result.response).not.toContain('HydraFacial');
    expect(result.discussed).toEqual([]);
  });

  it('gives a named service an identity and purpose without adding unasked prices', () => {
    const result = explainNamedService(services[0], 'Tell me about 10 in 1 HydraFacial');
    expect(result).toContain('Service: 10 in 1 HydraFacial');
    expect(result).toContain('What it is:');
    expect(result).toContain("What it's for:");
    expect(result).toContain('hydration');
    expect(result).not.toContain('₱');
    expect(explainNamedService(services[0], 'Tell me about it and its price')).toContain('₱1,299');
    expect(wantsServiceExplanation('How much is it?')).toBe(false);
  });
});
