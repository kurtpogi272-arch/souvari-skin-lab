import { PrismaClient, UserRole, StaffPosition, StaffStatus, Gender, ServiceCategory, ServiceStatus, ProductUnit, ProductStatus, AppointmentStatus, TransactionType, PaymentMethod, PaymentStatus, InventoryMovementType, NotificationType, DayOfWeek } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateTimeSlots(date: Date): string[] {
  const slots: string[] = [];
  for (let h = 9; h < 18; h++) {
    for (let m = 0; m < 60; m += 30) {
      if (h === 12 && m === 0) continue;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

async function main() {
  console.log('Seeding database...');

  const password = await bcrypt.hash('password123', 12);

  // System Settings
  const settings = [
    { setting_key: 'clinic_name', setting_value: '"Souvari Skin Lab"', description: 'Clinic display name' },
    { setting_key: 'clinic_phone', setting_value: '"+63 981 689 9909"', description: 'Clinic contact phone' },
    { setting_key: 'clinic_email', setting_value: '"souvariskinlab@gmail.com"', description: 'Clinic email' },
    { setting_key: 'clinic_address', setting_value: '"2nd Floor, The District Dasmariñas, Molino-Paliparan Rd., Dasmariñas, Cavite"', description: 'Clinic address' },
    { setting_key: 'business_hours_start', setting_value: '"10:00"', description: 'Default opening time' },
    { setting_key: 'business_hours_end', setting_value: '"20:00"', description: 'Default closing time' },
    { setting_key: 'business_days', setting_value: '["monday","tuesday","wednesday","thursday","friday","saturday"]', description: 'Operating days' },
    { setting_key: 'appointment_buffer_minutes', setting_value: '15', description: 'Buffer between appointments' },
    { setting_key: 'tax_rate', setting_value: '0.12', description: 'VAT rate (12%)' },
    { setting_key: 'currency', setting_value: '"PHP"', description: 'Currency code' },
    { setting_key: 'currency_symbol', setting_value: '"₱"', description: 'Currency symbol' },
  ];

  for (const s of settings) {
    await prisma.system_settings.upsert({
      where: { setting_key: s.setting_key },
      update: {},
      create: s,
    });
  }
  console.log('Settings seeded');

  // Admin User
  const admin = await prisma.users.create({
    data: {
      email: 'admin@iave.local',
      password_hash: password,
      role: 'admin',
      status: 'active',
      phone: '+639170000001',
    },
  });
  console.log('Admin created: admin@iave.local / password123');

  // Staff Users & Profiles
  const staffData = [
    { email: 'maria.santos@iave.local', first_name: 'Maria', last_name: 'Santos', position: StaffPosition.aesthetician, gender: Gender.female, bio: 'Senior aesthetician with 8 years of experience in facial treatments and skin care.' },
    { email: 'ana.reyes@iave.local', first_name: 'Ana', last_name: 'Reyes', position: StaffPosition.therapist, gender: Gender.female, bio: 'Licensed therapist specializing in body contouring and relaxation treatments.' },
    { email: 'carlos.dela cruz@iave.local', first_name: 'Carlos', last_name: 'Dela Cruz', position: StaffPosition.doctor, gender: Gender.male, bio: 'Board-certified dermatologist with expertise in laser treatments and injectables.' },
    { email: 'sofia.garcia@iave.local', first_name: 'Sofia', last_name: 'Garcia', position: StaffPosition.nurse, gender: Gender.female, bio: 'Registered nurse specializing in post-treatment care and patient support.' },
  ];

  const staffProfiles = [];
  for (const s of staffData) {
    const user = await prisma.users.create({
      data: {
        email: s.email,
        password_hash: password,
        role: 'staff',
        status: 'active',
        phone: `+63917${String(1000000 + Math.floor(Math.random() * 9000000)).slice(0, 7)}`,
      },
    });
    const profile = await prisma.staff.create({
      data: {
        user_id: user.id,
        first_name: s.first_name,
        last_name: s.last_name,
        position: s.position,
        status: StaffStatus.active,
        hire_date: randomDate(new Date('2022-01-01'), new Date('2024-01-01')),
        gender: s.gender,
        bio: s.bio,
      },
    });
    staffProfiles.push(profile);

    // Create schedules for Mon-Sat
    const days: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (const day of days) {
      await prisma.staff_schedules.create({
        data: {
          staff_id: profile.id,
          day_of_week: day,
          start_time: '10:00',
          end_time: '18:00',
          break_start: '12:00',
          break_end: '13:00',
          is_active: true,
        },
      });
    }
  }
  console.log(`${staffProfiles.length} staff created`);

  // Services
  const servicesData = [
    { name: 'Classic Facial Treatment', description: 'Deep cleansing facial tailored to your skin type. Includes extraction, massage, and hydrating mask.', category: ServiceCategory.facial, service_type: 'Individual', price: 2500, duration_minutes: 60 },
    { name: 'Acne Treatment', description: 'Specialized treatment targeting acne and breakouts. Includes deep cleansing, extraction, and medicated mask.', category: ServiceCategory.facial, service_type: 'Individual', price: 3500, duration_minutes: 75 },
    { name: 'HydraFacial', description: 'Advanced hydrating facial using vortex technology to cleanse, exfoliate, and hydrate the skin.', category: ServiceCategory.facial, service_type: 'Individual', price: 4500, duration_minutes: 60 },
    { name: 'Chemical Peel', description: 'Professional chemical exfoliation to improve skin texture, tone, and reduce fine lines.', category: ServiceCategory.skin_rejuvenation, service_type: 'Individual', price: 3000, duration_minutes: 45 },
    { name: 'Skin Consultation', description: 'Comprehensive skin analysis and personalized treatment plan by our dermatologist.', category: ServiceCategory.consultation, service_type: 'Individual', price: 1000, duration_minutes: 30 },
    { name: 'Botox Treatment', description: 'Anti-wrinkle injection treatment to smooth fine lines and achieve a youthful appearance.', category: ServiceCategory.injection, service_type: 'Individual', price: 15000, duration_minutes: 45 },
    { name: 'Dermal Filler', description: 'Hyaluronic acid filler treatment for lip enhancement, cheek augmentation, or wrinkle correction.', category: ServiceCategory.injection, service_type: 'Individual', price: 18000, duration_minutes: 60 },
    { name: 'Laser Hair Removal', description: 'Permanent hair reduction using advanced laser technology. Per area pricing.', category: ServiceCategory.hair_removal, service_type: 'Individual', price: 5000, duration_minutes: 45 },
    { name: 'Skin Rejuvenation Laser', description: 'Non-invasive laser treatment to improve skin tone, texture, and stimulate collagen production.', category: ServiceCategory.laser, service_type: 'Individual', price: 8000, duration_minutes: 60 },
    { name: 'Body Contouring', description: 'Non-svasive body sculpting treatment to reduce stubborn fat and reshape body contours.', category: ServiceCategory.body, service_type: 'Individual', price: 12000, duration_minutes: 90 },
    { name: 'Anti-Aging Facial', description: 'Premium anti-aging facial combining advanced serums, LED therapy, and firming massage.', category: ServiceCategory.facial, service_type: 'Individual', price: 5500, duration_minutes: 75 },
    { name: 'Diamond Peel', description: 'Microdermabrasion treatment using diamond tips to exfoliate and reveal fresh, glowing skin.', category: ServiceCategory.skin_rejuvenation, service_type: 'Individual', price: 3500, duration_minutes: 50 },
  ];

  const services = [];
  for (const s of servicesData) {
    const svc = await prisma.services.create({
      data: { ...s, status: ServiceStatus.active, is_active: true, is_legacy: true },
    });
    services.push(svc);
  }
  console.log(`${services.length} services created`);

  // Assign staff to services
  for (const svc of services) {
    const assignable = staffProfiles.filter(staff => {
      if (svc.category === 'injection' || svc.category === 'laser') return staff.position === 'doctor';
      return staff.position === 'aesthetician' || staff.position === 'therapist';
    });
    for (const staff of assignable) {
      await prisma.service_staff.create({
        data: { service_id: svc.id, staff_id: staff.id },
      });
    }
  }
  console.log('Staff-service assignments created');

  // Product Categories
  const categories = await Promise.all([
    prisma.product_categories.create({ data: { name: 'Skincare Products', description: 'Topical skincare products', sort_order: 1 } }),
    prisma.product_categories.create({ data: { name: 'Treatment Consumables', description: 'Products used during treatments', sort_order: 2 } }),
    prisma.product_categories.create({ data: { name: 'Injection Products', description: 'Injectable treatments and supplies', sort_order: 3 } }),
    prisma.product_categories.create({ data: { name: 'Equipment Supplies', description: 'General equipment and supplies', sort_order: 4 } }),
    prisma.product_categories.create({ data: { name: 'Retail Items', description: 'Products for retail sale', sort_order: 5 } }),
  ]);
  console.log(`${categories.length} product categories created`);

  // Products
  const productsData = [
    { name: 'Botox 100-unit Vial', sku: 'PRD-00001', unit: ProductUnit.vial, unit_cost: 8000, unit_price: 15000, current_stock: 25, minimum_stock: 5, product_category_id: categories[2].id, is_retail: false, is_consumable: true },
    { name: 'Hyaluronic Acid Filler 1ml', sku: 'PRD-00002', unit: ProductUnit.unit, unit_cost: 10000, unit_price: 18000, current_stock: 15, minimum_stock: 3, product_category_id: categories[2].id, is_retail: false, is_consumable: true },
    { name: 'Chemical Peel Solution', sku: 'PRD-00003', unit: ProductUnit.ml, unit_cost: 500, unit_price: 0, current_stock: 500, minimum_stock: 100, product_category_id: categories[1].id, is_retail: false, is_consumable: true },
    { name: 'Facial Cleansing Gel', sku: 'PRD-00004', unit: ProductUnit.bottle, unit_cost: 350, unit_price: 850, current_stock: 48, minimum_stock: 10, product_category_id: categories[0].id, is_retail: true, is_consumable: true },
    { name: 'Hydrating Serum', sku: 'PRD-00005', unit: ProductUnit.bottle, unit_cost: 800, unit_price: 1800, current_stock: 35, minimum_stock: 8, product_category_id: categories[0].id, is_retail: true, is_consumable: false },
    { name: 'Acne Treatment Cream', sku: 'PRD-00006', unit: ProductUnit.bottle, unit_cost: 450, unit_price: 1200, current_stock: 42, minimum_stock: 10, product_category_id: categories[0].id, is_retail: true, is_consumable: false },
    { name: 'LED Therapy Mask', sku: 'PRD-00007', unit: ProductUnit.piece, unit_cost: 3500, unit_price: 0, current_stock: 5, minimum_stock: 2, product_category_id: categories[3].id, is_retail: false, is_consumable: false },
    { name: 'Disposable Gloves (Box)', sku: 'PRD-00008', unit: ProductUnit.box, unit_cost: 250, unit_price: 0, current_stock: 20, minimum_stock: 5, product_category_id: categories[3].id, is_retail: false, is_consumable: true },
    { name: 'Sterile Cotton Pads', sku: 'PRD-00009', unit: ProductUnit.piece, unit_cost: 5, unit_price: 0, current_stock: 2000, minimum_stock: 500, product_category_id: categories[3].id, is_retail: false, is_consumable: true },
    { name: 'Sunscreen SPF50+', sku: 'PRD-00010', unit: ProductUnit.bottle, unit_cost: 600, unit_price: 1500, current_stock: 60, minimum_stock: 15, product_category_id: categories[4].id, is_retail: true, is_consumable: false },
    { name: 'Vitamin C Serum', sku: 'PRD-00011', unit: ProductUnit.bottle, unit_cost: 700, unit_price: 1600, current_stock: 38, minimum_stock: 10, product_category_id: categories[4].id, is_retail: true, is_consumable: false },
    { name: 'Retinol Night Cream', sku: 'PRD-00012', unit: ProductUnit.bottle, unit_cost: 550, unit_price: 1400, current_stock: 30, minimum_stock: 8, product_category_id: categories[4].id, is_retail: true, is_consumable: false },
    { name: 'Microneedling Cartridges', sku: 'PRD-00013', unit: ProductUnit.unit, unit_cost: 150, unit_price: 0, current_stock: 100, minimum_stock: 20, product_category_id: categories[1].id, is_retail: false, is_consumable: true },
    { name: 'Collagen Face Mask (10-pack)', sku: 'PRD-00014', unit: ProductUnit.box, unit_cost: 800, unit_price: 2000, current_stock: 25, minimum_stock: 5, product_category_id: categories[4].id, is_retail: true, is_consumable: true },
    { name: 'Aloe Vera Gel', sku: 'PRD-00015', unit: ProductUnit.bottle, unit_cost: 200, unit_price: 500, current_stock: 40, minimum_stock: 10, product_category_id: categories[0].id, is_retail: true, is_consumable: true },
    { name: 'Numbing Cream', sku: 'PRD-00016', unit: ProductUnit.bottle, unit_cost: 300, unit_price: 0, current_stock: 18, minimum_stock: 5, product_category_id: categories[1].id, is_retail: false, is_consumable: true },
    { name: 'Antiseptic Solution', sku: 'PRD-00017', unit: ProductUnit.bottle, unit_cost: 150, unit_price: 0, current_stock: 30, minimum_stock: 8, product_category_id: categories[3].id, is_retail: false, is_consumable: true },
    { name: 'Jade Roller Set', sku: 'PRD-00018', unit: ProductUnit.piece, unit_cost: 500, unit_price: 1200, current_stock: 3, minimum_stock: 5, product_category_id: categories[4].id, is_retail: true, is_consumable: false },
    { name: 'Bump Eraiser (Aftercare for Hot Waxing)', sku: 'PRD-00019', unit: ProductUnit.bottle, unit_cost: 100, unit_price: 250, current_stock: 50, minimum_stock: 10, product_category_id: categories[4].id, is_retail: true, is_consumable: false },
    { name: 'Post Healing Cream (Aftercare for Warts/Skin Tag Removal)', sku: 'PRD-00020', unit: ProductUnit.bottle, unit_cost: 60, unit_price: 150, current_stock: 50, minimum_stock: 10, product_category_id: categories[4].id, is_retail: true, is_consumable: false },
  ];

  const products = [];
  for (const p of productsData) {
    const product = await prisma.products.create({ data: p });
    products.push(product);
  }
  console.log(`${products.length} products created`);

  // Service-Inventory Consumption Config
  const consumptionConfig = [
    { service: 'Botox Treatment', product: 'Botox 100-unit Vial', qty: 5, unit: 'units' },
    { service: 'Botox Treatment', product: 'Numbing Cream', qty: 1, unit: 'app' },
    { service: 'Dermal Filler', product: 'Hyaluronic Acid Filler 1ml', qty: 1, unit: 'ml' },
    { service: 'Dermal Filler', product: 'Numbing Cream', qty: 1, unit: 'app' },
    { service: 'Chemical Peel', product: 'Chemical Peel Solution', qty: 15, unit: 'ml' },
    { service: 'Chemical Peel', product: 'Aloe Vera Gel', qty: 1, unit: 'app' },
    { service: 'Classic Facial Treatment', product: 'Facial Cleansing Gel', qty: 2, unit: 'ml' },
    { service: 'Classic Facial Treatment', product: 'Sterile Cotton Pads', qty: 5, unit: 'pcs' },
    { service: 'Acne Treatment', product: 'Acne Treatment Cream', qty: 1, unit: 'app' },
    { service: 'Acne Treatment', product: 'Sterile Cotton Pads', qty: 5, unit: 'pcs' },
    { service: 'HydraFacial', product: 'Hydrating Serum', qty: 3, unit: 'ml' },
    { service: 'Laser Hair Removal', product: 'Antiseptic Solution', qty: 5, unit: 'ml' },
    { service: 'Skin Rejuvenation Laser', product: 'Aloe Vera Gel', qty: 1, unit: 'app' },
  ];

  for (const c of consumptionConfig) {
    const svc = services.find(s => s.name === c.service);
    const prod = products.find(p => p.name === c.product);
    if (svc && prod) {
      await prisma.service_inventory_items.create({
        data: {
          service_id: svc.id,
          product_id: prod.id,
          quantity_per_session: c.qty,
        },
      });
    }
  }
  console.log('Service inventory consumption configs created');

  // Customers
  const customersData = [
    { email: 'juan.delacruz@email.com', first_name: 'Juan', last_name: 'Dela Cruz', gender: Gender.male },
    { email: 'maria.clara@email.com', first_name: 'Maria', last_name: 'Clara', gender: Gender.female },
    { email: 'jose.rizal@email.com', first_name: 'Jose', last_name: 'Rizal', gender: Gender.male },
    { email: 'noli.me tangere@email.com', first_name: 'Noli', last_name: 'Tangere', gender: Gender.male },
    { email: 'maria.makiling@email.com', first_name: 'Maria', last_name: 'Makiling', gender: Gender.female },
    { email: 'pedro.penduko@email.com', first_name: 'Pedro', last_name: 'Penduko', gender: Gender.male },
    { email: 'imelda.marcos@email.com', first_name: 'Imelda', last_name: 'Marcos', gender: Gender.female },
    { email: 'andres.bonifacio@email.com', first_name: 'Andres', last_name: 'Bonifacio', gender: Gender.male },
    { email: 'gabriela.silang@email.com', first_name: 'Gabriela', last_name: 'Silang', gender: Gender.female },
    { email: 'apolinario.mabini@email.com', first_name: 'Apolinario', last_name: 'Mabini', gender: Gender.male },
    { email: 'trinidad.tecson@email.com', first_name: 'Trinidad', last_name: 'Tecson', gender: Gender.female },
    { email: 'melchora.aquino@email.com', first_name: 'Melchora', last_name: 'Aquino', gender: Gender.female },
    { email: 'gregorio.del pilar@email.com', first_name: 'Gregorio', last_name: 'Del Pilar', gender: Gender.male },
    { email: 'antonia.neces@email.com', first_name: 'Antonia', last_name: 'Neces', gender: Gender.female },
    { email: 'francisco.makabulos@email.com', first_name: 'Francisco', last_name: 'Makabulos', gender: Gender.male },
    { email: 'jacinta.luna@email.com', first_name: 'Jacinta', last_name: 'Luna', gender: Gender.female },
    { email: 'antonio.luna@email.com', first_name: 'Antonio', last_name: 'Luna', gender: Gender.male },
    { email: 'hilaria.del rosario@email.com', first_name: 'Hilaria', last_name: 'Del Rosario', gender: Gender.female },
    { email: 'emilio.aguinaldo@email.com', first_name: 'Emilio', last_name: 'Aguinaldo', gender: Gender.male },
    { email: 'gregoria.de jesus@email.com', first_name: 'Gregoria', last_name: 'De Jesus', gender: Gender.female },
  ];

  const customerProfiles = [];
  for (const c of customersData) {
    const user = await prisma.users.create({
      data: {
        email: c.email,
        password_hash: password,
        role: 'customer',
        status: 'active',
        phone: `+63917${String(2000000 + Math.floor(Math.random() * 9000000)).slice(0, 7)}`,
      },
    });
    const profile = await prisma.customers.create({
      data: {
        user_id: user.id,
        first_name: c.first_name,
        last_name: c.last_name,
        gender: c.gender,
        date_of_birth: randomDate(new Date('1985-01-01'), new Date('2002-12-31')),
      },
    });
    customerProfiles.push(profile);
  }
  console.log(`${customerProfiles.length} customers created`);

  // Appointments (historical + upcoming)
  const appointmentStatuses: AppointmentStatus[] = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'];
  const appointments = [];
  const now = new Date();

  // Historical appointments (past 90 days)
  for (let i = 0; i < 60; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() - Math.floor(Math.random() * 90));
    if (date.getDay() === 0) continue;

    const customer = randomItem(customerProfiles);
    const staff = randomItem(staffProfiles);
    const service = randomItem(services);
    const slot = randomItem(generateTimeSlots(date));
    const startMinutes = timeToMinutes(slot);
    const endMinutes = startMinutes + service.duration_minutes;

    if (endMinutes > 18 * 60) continue;

    const status = i < 45 ? 'completed' as const : randomItem(['completed', 'cancelled', 'no_show'] as const);

    const appt = await prisma.appointments.create({
      data: {
        customer_id: customer.id,
        staff_id: staff.id,
        service_id: service.id,
        appointment_date: date,
        start_time: slot,
        end_time: minutesToTime(endMinutes),
        status,
        notes: status === 'completed' ? 'Treatment completed successfully.' : undefined,
        cancellation_reason: status === 'cancelled' ? 'Customer request' : undefined,
      },
    });
    appointments.push(appt);
  }
  console.log(`${appointments.length} historical appointments created`);

  // Upcoming appointments (next 30 days)
  for (let i = 0; i < 25; i++) {
    const date = new Date(now);
    date.setDate(date.getDate() + Math.floor(Math.random() * 30) + 1);
    if (date.getDay() === 0) continue;

    const customer = randomItem(customerProfiles);
    const staff = randomItem(staffProfiles);
    const service = randomItem(services);
    const slot = randomItem(generateTimeSlots(date));
    const startMinutes = timeToMinutes(slot);
    const endMinutes = startMinutes + service.duration_minutes;
    if (endMinutes > 18 * 60) continue;

    const appt = await prisma.appointments.create({
      data: {
        customer_id: customer.id,
        staff_id: staff.id,
        service_id: service.id,
        appointment_date: date,
        start_time: slot,
        end_time: minutesToTime(endMinutes),
        status: randomItem(['pending', 'confirmed']),
      },
    });
    appointments.push(appt);
  }
  console.log('Upcoming appointments created');

  // Treatment records for completed appointments
  const completedAppts = appointments.filter(a => a.status === 'completed');
  for (const appt of completedAppts) {
    try {
      await prisma.treatment_records.create({
        data: {
          appointment_id: appt.id,
          staff_id: appt.staff_id,
          customer_id: appt.customer_id,
          service_id: appt.service_id,
          treatment_date: appt.appointment_date,
          start_time: appt.start_time,
          end_time: appt.end_time,
          notes: 'Treatment completed successfully. Patient tolerated the procedure well.',
          recommendations: 'Follow post-treatment care instructions. Avoid direct sun exposure for 48 hours.',
        },
      });
    } catch {}
  }
  console.log('Treatment records created');

  // Transactions (for completed appointments and standalone POS)
  const transactionItems: Array<{ product_id?: number; service_id?: number; description: string; quantity: number; unit_price: number }> = [];
  let txnCount = 0;

  // Transactions linked to completed appointments
  const apptsForTxn = completedAppts.slice(0, 35);
  for (const appt of apptsForTxn) {
    const service = services.find(s => s.id === appt.service_id);
    if (!service) continue;

    const txnNumber = `TXN-${appt.appointment_date.toISOString().slice(0, 10).replace(/-/g, '')}-${String(++txnCount).padStart(5, '0')}`;
    const subtotal = Number(service.price);
    const tax = subtotal * 0.12;
    const total = subtotal + tax;

    await prisma.transactions.create({
      data: {
        transaction_number: txnNumber,
        customer_id: appt.customer_id,
        staff_id: appt.staff_id,
        appointment_id: appt.id,
        type: 'sale',
        subtotal,
        tax_amount: tax,
        total_amount: total,
        payment_method: randomItem(['cash', 'cash', 'gcash', 'paid_on_us']),
        payment_status: 'paid',
        paid_at: appt.appointment_date,
        // Match the record timestamp to the visit so the transactions report,
        // which filters on created_at, files the sale under the appointment day.
        created_at: appt.appointment_date,
        items: {
          create: [{
            service_id: appt.service_id,
            description: service.name,
            quantity: 1,
            unit_price: service.price,
            line_total: service.price,
          }],
        },
      },
    });
  }
  console.log(`${apptsForTxn.length} transaction records created`);

  // Inventory Movements (opening stock)
  for (const product of products) {
    await prisma.inventory_movements.create({
      data: {
        product_id: product.id,
        type: 'opening_stock',
        quantity: product.current_stock,
        running_stock_after: product.current_stock,
        notes: 'Initial stock from seed data',
        performed_by: admin.id,
      },
    });
  }
  console.log('Inventory movements created');

  // Notifications
  const notifTypes: NotificationType[] = ['system', 'appointment_reminder', 'appointment_update', 'low_stock'];
  for (const customer of customerProfiles.slice(0, 10)) {
    const user = await prisma.users.findUnique({ where: { id: customer.user_id } });
    if (!user) continue;

    await prisma.notifications.create({
      data: {
        user_id: user.id,
        type: 'system',
        title: 'Welcome to Souvari Skin Lab',
        message: 'Thank you for registering! Explore our services and book your first appointment.',
      },
    });

    if (Math.random() > 0.5) {
      await prisma.notifications.create({
        data: {
          user_id: user.id,
          type: 'appointment_reminder',
          title: 'Appointment Reminder',
          message: 'You have an upcoming appointment. Please arrive 10 minutes before your scheduled time.',
        },
      });
    }
  }

  // Low-stock notifications for admin
  const lowStockProducts = products.filter(p => Number(p.current_stock) <= Number(p.minimum_stock));
  for (const product of lowStockProducts) {
    await prisma.notifications.create({
      data: {
        user_id: admin.id,
        type: 'low_stock',
        title: 'Low Stock Alert',
        message: `${product.name} is running low. Current stock: ${product.current_stock} ${product.unit}`,
      },
    });
  }
  console.log('Notifications created');

  console.log('\nSeed completed successfully!');
  console.log('---');
  console.log('Login credentials:');
  console.log('  Admin:    admin@iave.local / password123');
  console.log('  Staff:    maria.santos@iave.local / password123');
  console.log('  Customer: juan.delacruz@email.com / password123');
  console.log('  All passwords: password123');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
