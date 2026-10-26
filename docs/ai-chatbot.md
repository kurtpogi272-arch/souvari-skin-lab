# AI Chatbot

The customer-facing assistant for Souvari Skin Lab. It answers questions about
services, pricing, recommendations, clinic hours/location, retail products, and
general beauty/aesthetics topics — while refusing to diagnose, prescribe, or
invent information.

- **Endpoint:** `POST /api/chat` (no auth required; optional auth links the
  session to a logged-in user)
- **Request:** `{ "message": string, "session_token"?: string }`
- **Response:** `{ "success": true, "data": { "session_token": string, "response": string } }`

## Source files

| File | Responsibility |
|------|----------------|
| `server/src/modules/ai/ai.service.ts` | Router, intent handling, product lookup, recommendation engine, prompt building, error handling |
| `server/src/modules/ai/product-knowledge.ts` | Retail product matching, intents, replies |
| `server/src/modules/ai/service-knowledge.ts` | Group-aware service matching, concise descriptions, provenance, prices/variants |
| `server/src/modules/ai/service-explanations.ts` | Explanation intent, rejuvenation spelling variants, educational topic/service replies |
| `server/src/modules/ai/clinic-info.ts` | Fast operational intent recognition, including finding the store |
| `server/src/modules/ai/clinic-safety.ts` | Emergency and medical-advice detection + referral copy |
| `server/src/modules/ai/aftercare-knowledge.ts` | Preparation/aftercare intent + confirmed knowledge base |
| `server/src/modules/ai/clinic-faq.ts` | Administrative-policy and treatment-logistics intent detection + honest gap replies |
| `server/src/modules/ai/fallback-responses.ts` | Technical/AI-unavailable/retrieval/unrecognized fallback copy |
| `server/src/modules/ai/ai.controller.ts` | HTTP controller |
| `server/src/modules/ai/ai.routes.ts` | Route registration |
| `server/src/modules/ai/ai.validation.ts` | Request validation |
| `client/src/components/chatbot/*`, `client/src/pages/customer/Chatbot.tsx` | Chat UI |

## Routing order

Every message runs through a safety-first, deterministic pipeline **before** the
language model is ever called. When `AI_API_KEY` is unset, the deterministic
engine answers on its own.

1. **Emergency** — possible serious reaction (difficulty breathing, facial/lip/
   tongue/throat swelling, chest pain, fainting, severe bleeding, allergic
   reaction). → emergency-services guidance. Checked first so a message that also
   looks like a greeting is never swallowed.
2. **Medical advice / suitability / contraindications** — pregnancy,
   breastfeeding, prescription medication, chronic conditions, allergies, "is it
   safe", "am I a candidate", "who shouldn't get this". → referral to clinic
   professionals (and the free consultation). Never a diagnosis or a guarantee.
3. **Operational FAQs** — location, maps, hours, and contact details use fresh
   public settings immediately, without reading the service/product catalogs or
   waiting for AI. "How can I locate your store?" is a location question, while
   "Where do I store my serum?" is a product question.
4. **Clinic info** — "tell me about your clinic", "who are you?". → grounded
   overview built only from stored settings.
4. **Administrative policy / FAQ** — payments, deposits, cancellation,
   rescheduling, refunds, warranty, parking, walk-ins, HMO/insurance, branches,
   age limits, practitioners, who we treat, dress code/guests, packages,
   membership, promos, vouchers, discounts. → honest "not on file" reply that
   points to the clinic; never a guessed policy.
5. **Thanks / greeting** — pleasantries.
6. **Help** — "help", "what can you do?".
7. **Preparation / aftercare** — "how do I prepare", "what should I do after".
   → confirmed knowledge base if present, otherwise an honest "not on file" reply.
8. **Treatment logistics** — duration, number of sessions, discomfort, side
   effects, downtime. → honest reply that avoids guessing and offers the free
   consultation.
9. **Retail products** — database lookup; answers only from stored fields, never
   invents. Context-anchored follow-ups resolve before a fresh lookup.
10. **Relevance gate** — anything not about the clinic is refused with the
    off-topic reply.
11. **Recommendations / hours / pricing / contact / service details** — deterministic
    rule engine.
12. **LLM** — only for on-topic questions the deterministic engine did not already
    answer. Falls back to the rule engine on any provider error; returns
     `AI_UNAVAILABLE_REPLY` only if both fail.

The deterministic engine is now used first **even when an AI key is configured**.
Only an unanswered on-topic message goes to the model. An exact retail-product
name is resolved before a word inside it can be interpreted as treatment
aftercare or a different service (e.g. a face mask, or a product with "Aftercare"
in its name). Exact named-service answers precede broad policy and treatment
logistics fallbacks. Body-area names shared by multiple treatments ask for
clarification; group metadata distinguishes RF, HIFU, diode and wax.

## Response speed and concise answers

Explicit service explanation questions have their own response mode. For
`Tell me about Skin Rejuvinating` (and rejuvenating/rejuvination/rejuvenation
variants), the assistant explains **what it is**, **what it is for**, and gives
grounded **services at Souvari**. It uses facial examples from different recorded
treatment families rather than immediately recommending three treatments or
mistaking body HIFU entries for facial examples. Named `tell me about` service
questions receive the same identity/purpose structure. Price/use questions stay
short, and product descriptions keep their usual brief format. No model
fine-tuning, catalog rewrite, or extra model request is required for this route.

Product definitions and purpose questions now get one complete sentence from the
recorded purpose/description, rather than a dump of category, description,
purpose, benefits, price and stock. `What is the use of ...?` is a purpose intent.
Prices, stock and related services are added only when requested. Routine factual
answers do not repeat a medical disclaimer; personalized recommendations retain
a short invitation to ask clinic staff. Medical/safety routing remains separate.

`Best selling products` ranks active retail products by positive quantities in
non-deleted, **paid sale** transactions. It does not use catalog order, stock
counts, service bookings or refund/void rows as a popularity signal. If no sales
are recorded, the answer says there is not enough data; retrieval errors do not
fall back to a list mislabelled as best sellers.

- Model calls have an **8-second provider timeout** and **zero SDK retries**.
  There is no application retry loop. A provider failure returns the already
  computed deterministic fallback without querying the catalogs again.
- The model gets at most six relevant catalog records, not the complete service
  list or internal inventory. Base clinic instructions are cached for 10 minutes.
- Active service data, including prices, groups, package inclusions and variants,
  is cached for **30 seconds**. Catalog changes become visible within that bound;
  operational FAQ settings and retail stock are read fresh.
- Price-only and duration-only replies omit unrelated sections. Ordinary product
  lists show at most three choices; recommendations show at most two. An explicit request for
  **all products** returns the complete customer-visible list.
- Product recommendations match recorded descriptions, purposes and benefits,
  exclude out-of-stock items, and do not infer ingredients or instructions.
- Floating and full-page chat use the server-issued session token on subsequent
  requests. Exact service IDs preserve context across same-name treatment types.
- Maps URLs are rendered as safe clickable links, without interpreting chat text
  as HTML. The app loads page routes on demand so charts and PDF/Excel libraries
  do not delay the public chat; guests skip an unnecessary profile request.

## Service research and catalog coverage

### Concern routing and clarification memory

Personal concerns and service recommendations run before fuzzy product lookup
and the generic skincare overview. Sharing the word `skin`, `face`, `body`,
`care`, `treatment`, or `aftercare` with an item name is not sufficient to select
that item. Exact product names and meaningful product-name fragments remain
searchable, and explicit product recommendations use recorded purposes.

- `I have dark skin` asks whether the customer means natural skin tone, dark
  spots, or uneven tone; it does not assume that natural skin tone is a problem.
- `I want to brighten my skin` records brightening as the goal and asks only for
  face/body context, at most once for that goal in the current chat session.
- A repeated goal or an explicit service request gets focused catalog options
  rather than another generic questionnaire. A bare area reply such as `face`
  or `underarms` continues the goal instead of selecting a same-name service.
- Facial brightening options must have a relevant recorded or referenced focus,
  not merely a broad skin-rejuvenation category. Do not fill a three-item limit
  with unrelated PMU, body contouring, or post-procedure products.
- Body-brightening listings are identified as catalog options to discuss with
  staff; their exact protocol and expected benefits still require confirmation.
  A general answer of `body` prompts for the specific body part before listing
  treatments, so it does not arbitrarily suggest bikini/buttock services. That
  body part is remembered for follow-ups.
- The specific concern is tracked as well as the broad goal: adding dark spots
  to a body-brightening conversation asks where on the body they are, rather
  than repeating a list for arbitrary areas. Switching to a different concern
  such as acne checks face/body context again instead of assuming a location.
- `Recommend a service that ...` is a new request, not a pronoun follow-up about
  a previous product. A new concern clears the earlier product topic.

The regression suite includes the complete reported location → dark skin →
brightening → repeated goal → explicit service request conversation, area-only
answers, and new-topic switches after a real product lookup. The catalog-name
audit below checks recognition, not conversational relevance; both checks are
needed when changing chatbot routing.

The `service-knowledge.ts` reference notes describe treatment families in original,
concise wording. They do **not** assert that the clinic uses a particular branded
device, formulation, protocol, or promises a treatment result. An existing clinic
description takes precedence. Unknown custom entries stay discoverable by name
and price, but their purpose is explicitly marked as needing confirmation.

The local audit during this update recognized **263/263 active services** and
**11/11 customer-facing products**. Service knowledge provenance was:

| Provenance | Count | Meaning |
| --- | ---: | --- |
| General reference | 146 | Treatment-family explanation backed by the sources below |
| Catalog label | 114 | Description of the named catalog option; exact protocol/benefits are not independently established |
| Clinic description | 1 | Uses the stored clinic description |
| Needs confirmation | 2 | Local placeholder entries named `Test` and `Test Service` |

Doctor-led branded procedures remain answerable as catalog entries, but their
exact formulation and benefits require clinic confirmation; they are not
automatically recommended for a customer's symptom. Internal consumables and
equipment are not retail recommendations. No existing catalog descriptions or
prices are overwritten by this update, and no schema migration is required.

### Research references (reviewed October 25, 2026)

- [AAD: laser hair removal](https://www.aad.org/public/cosmetic/hair-removal/laser-hair-removal-overview)
- [FDA: non-invasive contouring, RF and ultrasound](https://www.fda.gov/medical-devices/aesthetic-cosmetic-devices/non-invasive-body-contouring-technologies)
- [Hydrafacial: cleansing, exfoliation and hydration overview](https://www.hydrafacial.com/) — general context only; this does not verify the clinic's "10 in 1" steps or device branding.
- [AAD: chemical peels](https://www.aad.org/public/cosmetic/younger-looking/chemical-peels-overview)
- [AAD: botulinum toxin](https://www.aad.org/public/cosmetic/wrinkles/botulinum-toxin-overview)
- [FDA: microneedling](https://www.fda.gov/medical-devices/aesthetic-cosmetic-devices/microneedling-devices)
- [FDA: nail products](https://www.fda.gov/cosmetics/cosmetic-products/nail-care-products)
- [FDA: eye cosmetics and extensions](https://www.fda.gov/cosmetics/cosmetic-products/eye-cosmetic-safety)
- [FDA: permanent makeup](https://www.fda.gov/cosmetics/cosmetic-products/tattoos-permanent-makeup-fact-sheet)

Run the read-only coverage audit against the database being checked:

```bash
npm run chat:verify:coverage --prefix server
```

It reports unmatched records, missing product purposes and service-description
gaps without sending chat messages, changing records, or calling a model API.
Coverage means a catalog entry is recognized; it does not mean every possible
medical or clinic-protocol question has a confirmed answer.

Ambiguous bare words are resolved **service/concern first**: a word that names a
service or a concern (e.g. `collagen`, `acne`, `facial`) is treated as that, not as
a product, unless the user clearly asks about a product (`buy`, `price`, `stock`,
`ingredients`, a product name, ...). This prevents a concern question from being
answered with a product's description.

## Safety rules

- Never diagnose, prescribe, or assess a medical condition.
- Never guarantee, promise, or claim a result or cure.
- Emergencies are always directed to emergency services (911 / nearest ER).
- Medical and suitability questions are referred to clinic professionals.
- Only services that exist in the database are ever recommended.
- Personalized recommendations include a brief invitation to consult clinic
  staff; factual definitions and prices do not repeat a generic disclaimer.
- Administrative policies (cancellation, refund, payment, parking, ...) and
  treatment logistics are never invented — if they are not stored, the assistant
  says so and points to the clinic.
- The assistant never claims a service or product is unavailable just because it
  is not found; it stays honest about what it does not know.
- Responses are English-only; never Tagalog.
- The model never sees off-topic or medical/safety messages, and product/service
  facts always come from the database, not the model.

See `docs/business-rules.md` → **AI Safety Rules** for the canonical policy list.

## Fallback messages

Defined in `fallback-responses.ts`, so the customer never sees an internal error:

| Constant | When |
|----------|------|
| `TECHNICAL_ERROR_REPLY` | Unexpected failure handling a message (database/routing) |
| `AI_UNAVAILABLE_REPLY` | Model unreachable **and** the rule engine also failed |
| `RETRIEVAL_ERROR_REPLY` | The service catalog could not be read |
| `UNRECOGNIZED_REPLY` | On-topic question with no stored answer (honest gap) |
| `OFF_TOPIC_REPLY` | Question unrelated to the clinic |

Technical errors are logged for developers (`category`, `name`, `message`) with
no customer text and no secrets. The customer always gets a safe sentence.

## Aftercare knowledge base

`aftercare-knowledge.ts` ships **empty on purpose** — the assistant must not
invent treatment-specific medical instructions. Until entries are added, prep and
aftercare questions get an honest "not on file, please ask our staff" reply.

To add confirmed content, key an entry by lowercased service name or category:

```ts
export const AFTERCARE_KNOWLEDGE: Record<string, AftercareEntry> = {
  '10 in 1 hydrafacial': {
    prep: 'Come with clean skin if possible. Avoid retinoids for 2 days before.',
    aftercare: 'Avoid direct sun and strenuous exercise for 24 hours.',
  },
};
```

Only add wording the clinic has approved. The assistant returns it verbatim plus
the standard consultation disclaimer.

## Needs clinic confirmation

The following are **not** invented by the assistant and should be confirmed/added
by the clinic:

- Aftercare, preparation, and contraindication text per service (knowledge base
  above is currently empty).
- Booking, cancellation, rescheduling, refund, warranty, and shipping policies.
- Payment/deposit methods (cash, card, GCash, installments), no-show charges,
  parking, walk-in availability, HMO/insurance, branches, age limits,
  practitioners/doctors, who they treat, dress code and guest policy, packages,
  membership, promos, vouchers, and discounts. The assistant answers these
  honestly as "not on file yet" until values are stored.
- Treatment logistics per service — duration, number of sessions, discomfort,
  side effects, and downtime. `clinic-faq.ts` routes these to an honest reply
  instead of guessing.
- Confirmed clinic address, phone, and hours (the assistant composes hours from
  `business_hours_start`, `business_hours_end`, and `business_days`).
- Per-service descriptions/durations and per-product descriptions/purpose where
  missing, so answers stay grounded.

## Configuration

Environment variables (see `server/src/config/env.ts`):

| Variable | Purpose |
|----------|---------|
| `AI_API_KEY` | Enables the LLM path. Empty → deterministic rule engine only |
| `AI_MODEL` | Model name |
| `AI_BASE_URL` | Optional OpenAI-compatible base URL |

## Testing

```bash
cd server
npx vitest run          # unit tests (deterministic engine, no network)
npx tsc --noEmit        # typecheck
```

To exercise the deterministic engine manually, build and run with an empty key:

```bash
npx tsc
PORT=3100 AI_API_KEY='' SMS_PROVIDER=mock REMINDERS_ENABLED=false node dist/server.js
```

```bash
curl -s -X POST http://localhost:3100/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"recommend something for dryness","session_token":"demo"}'
```

To test the AI-failure fallback path, point `AI_BASE_URL` at an unreachable host
with a dummy key: the assistant falls back to the deterministic engine.
