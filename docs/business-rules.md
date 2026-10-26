# Business Rules

## Appointment Booking Rules

1. **No double booking**: Server checks for overlapping appointments for the same staff member on the same date. Overlap = existing.start_time < new.end_time AND existing.end_time > new.start_time.

2. **Staff must be active**: Only staff with status='active' can receive appointments.

3. **Service must be active**: Only services with status='active' can be booked.

4. **Within business hours**: Appointments must fall within clinic operating hours (default 9:00 AM - 6:00 PM).

5. **Within staff schedule**: Staff must have an active schedule for the appointment day of week.

6. **No break overlap**: Appointment cannot overlap with staff break period.

7. **Duration matches services**: Appointment end_time = start_time + the sum of `duration_minutes` across every booked service. When the service list is edited, the end time is re-derived server-side and the appointment is re-validated for overlaps, staff schedule, and break conflicts before anything is written.

8. **Valid status transitions**:
   - pending → confirmed, cancelled
   - confirmed → checked_in, cancelled
   - checked_in → in_progress, no_show
   - in_progress → completed

## Appointment Editing Rules

1. **Completed is terminal**: Once an appointment is `completed` it is immutable for every role, including admins. Field edits, status changes, service changes, reassignment, and deletion are all rejected. The calendar renders a lock badge and the details drawer is read-only.

2. **Multi-service updates**: Admins and staff may replace the service list on a booking. The server re-prices every line (preserving membership and monthly-perk discounts), rewrites the `appointment_services` join rows, extends the block to the new total duration, and SMSes the customer. Sending the same service list is a no-op: rows are not churned and the customer is not re-notified.

3. **Cancellation requires a reason** for staff and admin cancellations — it is the body of the automatic cancellation SMS. Customer self-cancellation defaults to "Cancelled by customer".

4. **Customer self-service**: A customer may only cancel their own appointment, and only while it is still `pending` or `confirmed`. The service layer forces the status to `cancelled` and ignores any other requested change, so the endpoint cannot be used to reach a different status.

5. **Reschedule requires a message**: Changing the date or start time requires a message explaining why. Changing the time and the service list in one request is supported; the derived end time is anchored to the new start time.

## Operating Days Rules

1. **`business_days` must be non-empty**: The clinic must be open at least one weekday. Only valid weekday names are accepted.

2. **Closed days hide slots**: The availability endpoint returns `closed: true` with no slots for a weekday the clinic is not open on, and booking is rejected for that day.

3. **Closing a day warns, never blocks**: The admin Settings screen calls `GET /api/appointments/operating-days-impact` to report how many upcoming, still-actionable bookings sit on the days being closed. The change is advisory — existing appointments are never removed, they just stop being bookable for new customers.

## Transaction Rules

1. **Atomic checkout**: All operations (transaction creation, stock deduction, inventory logging) happen in a single database transaction. If any step fails, everything rolls back.

2. **Stock validation**: Retail products must have sufficient stock before checkout.

3. **Service inventory consumption**: When a service is in a transaction, the system automatically deducts configured quantities from service_inventory_items.

4. **Transaction number format**: TXN-YYYYMMDD-XXXXX (date + sequential 5-digit number).

5. **Void reverses inventory**: Voiding a transaction creates return-type inventory movements to restore stock.

6. **Refund creates new transaction**: Refunding creates a separate refund transaction and restores inventory.

## Inventory Rules

1. **Audit trail required**: Every stock modification creates an inventory_movements record.

2. **Movement types**: purchase (stock in), sale (stock out), adjustment (manual), consumption (service use), return (reversal), damage, transfer, opening_stock.

3. **Low-stock alert**: When current_stock ≤ minimum_stock, the system generates a notification and includes the product in dashboard alerts.

4. **No negative stock**: The system prevents deductions that would make stock negative.

5. **Configurable units**: Products support piece, ml, mg, unit, vial, tablet, bottle, box.

6. **Manual movement wording**: The inventory form shows **Add Stock** for an
   addition and **Deduct Stock** for a deduction. Movements history shows
   **Added Stock** for positive manual adjustment quantities and **Deducted Stock**
   for negative ones. Purchases remain **Purchase**. The signed adjustment ledger
   is retained so historical changes display correctly without a data migration.
   The `added_stock` and `deducted_stock` query filters select those respective
   directions; the existing `adjustment` API filter still selects both.

## Customer SMS Greetings

Customer SMS notifications use the saved `customers.first_name`, including
compound names: `Hi Mary Anne, this is Souvari Skin Lab.` They do not split a
full name or include the last name. Missing names use `Hi, this is Souvari Skin
Lab.` A name-lookup failure does not block SMS delivery. In-app message wording
is independent of the SMS greeting.

Cancellation SMS render the greeting inside their short template, rather than
adding a second greeting. Dates are compacted (e.g. `September` → `Sep`) and
long reasons are shortened to a 160-character target while the full reason stays
in-app. Unusually long first names use a more compact cancellation template.
Character length is not a guarantee of one encoded SMS segment: Unicode names
and reasons may use a different SMS encoding.

## Service Consumption Rules

1. **Configurable per service**: Each service defines which products it consumes and in what quantity.

2. **Automatic deduction**: When a transaction includes a service, the system looks up service_inventory_items and deducts the configured quantities.

3. **Atomic**: Consumption deductions happen within the same database transaction as the POS checkout.

## AI Safety Rules

1. **No diagnosis**: The chatbot must never diagnose conditions.

2. **No medication advice**: Never prescribe or recommend specific medications.

3. **No emergency advice**: Direct users to emergency services for urgent matters.

4. **Service-based recommendations only**: Only recommend services that exist in the system's service catalog.

5. **Disclaimer required**: All recommendations include a disclaimer to consult clinic professionals.

6. **Graceful fallback**: If the AI service is unavailable, the rule-based fallback handles the conversation.

## Authentication Rules

1. **Password hashing**: bcrypt with 12 salt rounds.

2. **Access token lifetime**: 15 minutes.

3. **Refresh token lifetime**: 7 days, stored in httpOnly cookie.

4. **Token refresh**: On 401, frontend automatically attempts token refresh before redirecting to login.

## Role-Based Access Rules

| Resource | Customer | Staff | Admin |
|----------|----------|-------|-------|
| Browse services | Yes | Yes | Yes |
| Book appointments | Yes | — | Yes |
| View own data | Yes | Assigned only | All |
| Process POS | — | Yes | Yes |
| Complete services | — | Yes | Yes |
| Manage services | — | — | Yes |
| Manage staff | — | — | Yes |
| Manage inventory | — | View only | Full |
| View analytics | — | — | Yes |
| Manage settings | — | — | Yes |
