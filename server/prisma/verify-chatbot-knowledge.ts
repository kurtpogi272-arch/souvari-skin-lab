/** Read-only catalog audit. Does not send customer messages or call an AI API. */
import { PrismaClient } from '@prisma/client';
import { namedServices, serviceKnowledge } from '../src/modules/ai/service-knowledge';
import { loadRetailProducts, matchProducts, normalizeQuery } from '../src/modules/ai/product-knowledge';

const prisma = new PrismaClient();

async function main() {
  const services = await prisma.services.findMany({
    where: { status: 'active', deleted_at: null },
    include: { group: { select: { slug: true, name: true } } },
    orderBy: { name: 'asc' },
  });
  const products = await loadRetailProducts();
  const unmatchedServices = services.filter((s) =>
    !namedServices(`Tell me about ${s.name}${s.group ? ` in ${s.group.name}` : ''}`, services).some((m) => m.id === s.id));
  const unmatchedProducts = products.filter((p) => {
    const match = matchProducts(products, normalizeQuery(`What is ${p.name} used for?`));
    return match.kind === 'none' || (match.kind === 'single' ? match.product.id !== p.id : !match.products.some((item) => item.id === p.id));
  });
  const provenance: Record<string, number> = {};
  for (const service of services) {
    const key = serviceKnowledge(service).provenance;
    provenance[key] = (provenance[key] ?? 0) + 1;
  }
  console.log(JSON.stringify({
    activeServices: services.length, recognizedServices: services.length - unmatchedServices.length,
    customerProducts: products.length, recognizedProducts: products.length - unmatchedProducts.length,
    provenance,
    needsClinicDescription: services.filter((s) => serviceKnowledge(s).provenance === 'needs-confirmation').map((s) => s.name),
    clinicianAssessmentEntries: services.filter((s) => serviceKnowledge(s).consultationRequired).length,
    productsMissingPurpose: products.filter((p) => !p.purpose?.trim()).map((p) => p.name),
    unmatchedServices: unmatchedServices.map((s) => s.name), unmatchedProducts: unmatchedProducts.map((p) => p.name),
  }, null, 2));
  if (unmatchedServices.length || unmatchedProducts.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await prisma.$disconnect();
  const shared = (await import('../src/config/database')).default;
  await shared.$disconnect();
});
