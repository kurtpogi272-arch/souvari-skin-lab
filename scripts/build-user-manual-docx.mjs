// Generates docs/user-manual/SOUVARI_USER_MANUAL.docx from the manual content and
// screenshots. Format: A4, Times New Roman 12pt body / 10pt captions, justified,
// bold headings, ~1in margins. Step title + screenshot + caption + text are kept
// together. Usage: node scripts/build-user-manual-docx.mjs
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  ImageRun, PageBreak, BorderStyle,
} from 'docx';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('docs/user-manual');
const SHOTS = path.join(ROOT, 'screenshots');
const OUT = path.join(ROOT, 'SOUVARI_USER_MANUAL.docx');

const FONT = 'Times New Roman';
const BODY = 24; // half-points => 12pt
const CAPTION = 20; // 10pt
const MAX_IMG_W = 600; // px target width for readability

// ---------- paragraph helpers ----------
const body = (text, opts = {}) =>
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 120, line: 360 },
    ...opts,
    children: [new TextRun({ text, font: FONT, size: BODY, bold: !!opts.bold, italics: !!opts.italics })],
  });

const numbered = (text) =>
  new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 60, line: 340 },
    indent: { left: 360, hanging: 240 },
    children: [new TextRun({ text, font: FONT, size: BODY })],
  });

const h1 = (text, opts = {}) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    alignment: AlignmentType.CENTER,
    spacing: { after: 240, line: 340 },
    pageBreakBefore: !!opts.pageBreakBefore,
    children: [new TextRun({ text, font: FONT, size: 32, bold: true })],
  });

const h2 = (text, opts = {}) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 140, line: 340 },
    pageBreakBefore: !!opts.pageBreakBefore,
    children: [new TextRun({ text, font: FONT, size: 28, bold: true })],
  });

const h3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 180, after: 120, line: 340 },
    children: [new TextRun({ text, font: FONT, size: BODY, bold: true })],
  });

function image(fileName) {
  const file = path.join(SHOTS, fileName);
  if (!fs.existsSync(file)) {
    console.warn('  missing image', fileName);
    return body(`[Missing image: ${fileName}]`);
  }
  const buf = fs.readFileSync(file);
  // Read PNG dimensions from IHDR (bytes 16-24).
  let w = 1440, h = 900;
  if (buf.length > 24 && buf.toString('ascii', 12, 16) === 'IHDR') {
    w = buf.readUInt32BE(16);
    h = buf.readUInt32BE(20);
  }
  const dispW = MAX_IMG_W;
  const dispH = Math.round((h / w) * dispW);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 80 },
    keepNext: true,
    children: [
      new ImageRun({
        data: buf,
        transformation: { width: dispW, height: dispH },
      }),
    ],
  });
}

const caption = (text) =>
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 160, line: 300 },
    children: [new TextRun({ text, font: FONT, size: CAPTION, italics: true })],
  });

const hr = () =>
  new Paragraph({
    spacing: { after: 120 },
    border: { bottom: { color: '999999', space: 1, style: BorderStyle.SINGLE, size: 6 } },
    children: [],
  });

// figure = image + caption kept with preceding step title already via keepNext chain
const figure = (fileName, cap) => [image(fileName), caption(cap)];

// ---------- build content ----------
const children = [];

children.push(h1('APPENDIX J'));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 120 },
  children: [new TextRun({ text: 'USER’S MANUAL', font: FONT, size: 32, bold: true })],
}));
children.push(new Paragraph({
  alignment: AlignmentType.CENTER, spacing: { after: 320 },
  children: [new TextRun({
    text: 'INTEGRATED SMART CLINIC MANAGEMENT SYSTEM WITH INVENTORY TRACKING AND DESCRIPTIVE ANALYTICS FOR SOUVARI SKIN LAB',
    font: FONT, size: 26, bold: true,
  })],
}));
children.push(hr());

children.push(h2('INTRODUCTION'));
children.push(body('The Integrated Smart Clinic Management System with Inventory Tracking and Descriptive Analytics is a web-based platform developed for Souvari Skin Lab. It centralizes daily clinic operations into a single system, covering online appointment scheduling, customer records, staff and schedule management, digital treatment histories, automated appointment notifications, an AI chatbot assistant, service and product catalogues, inventory monitoring with low-stock indicators, descriptive analytics, and clinic administration. The system is accessed through a web browser and is organized around three access levels: the Customer, the Staff, and the Administrator.'));
children.push(body('This manual provides step-by-step procedures for using the system according to the user’s access level. It is divided into three main sections: the Customer/Client User Manual, the Staff User Manual, and the Administrator/Clinic Owner User Manual. Each step is illustrated with a screenshot of the actual system, and every figure is numbered and captioned for easy reference.'));

// ===== PART I =====
children.push(h2('PART I. CUSTOMER / CLIENT USER', { pageBreakBefore: true }));
children.push(body('The Customer is a client of Souvari Skin Lab who books and manages appointments online. The customer workflow covers creating an account, signing in, booking an appointment, viewing appointment history, using the AI chatbot, and updating a personal profile.'));

children.push(h3('Step 1 – Accessing the Souvari Skin Lab Website'));
children.push(numbered('1. Open a web browser and enter the clinic website address.'));
children.push(numbered('2. The public homepage appears, showing the clinic logo, the main navigation menu, and a Book Appointment button.'));
children.push(...figure('annotated/A01-public-homepage.png', 'Figure J.1. Souvari Skin Lab Public Homepage'));
children.push(body('The figure above shows the public homepage. The top navigation provides access to the Services, About, and Contact pages. The Clinic Logo returns the visitor to the homepage. Visitors may select Sign In to log in or click Book Appointment to start a booking.'));

children.push(h3('Step 2 – Creating an Account'));
children.push(numbered('1. From the homepage, click Sign In on the navigation menu, then click Sign up below the login form. This opens the registration page.'));
children.push(numbered('2. Enter your First Name and Last Name.'));
children.push(numbered('3. Enter a Phone Number using the format +63 917 123 4567.'));
children.push(numbered('4. Enter a valid Email address. This will be your sign-in address.'));
children.push(numbered('5. Enter a Password with at least eight (8) characters.'));
children.push(numbered('6. Re-enter the password in the Confirm Password field.'));
children.push(numbered('7. Click Create account to submit the registration.'));
children.push(...figure('06-register.png', 'Figure J.2. Customer Registration Page'));
children.push(body('The figure above shows the account registration form. All fields are required. After a successful registration, the customer is signed in automatically and redirected to the customer dashboard.'));

children.push(h3('Step 3 – Logging In'));
children.push(numbered('1. From the homepage, click Sign In on the navigation menu.'));
children.push(numbered('2. Enter your registered Email in the Email field.'));
children.push(numbered('3. Enter your Password in the Password field. The characters are hidden for security.'));
children.push(numbered('4. Click Sign in.'));
children.push(...figure('07-login.png', 'Figure J.3. Customer Login Page'));
children.push(body('The figure above shows the sign-in page. If the credentials are correct, the customer is taken to the customer dashboard. If not, an “Invalid email or password” message is shown.'));

children.push(h3('Step 4 – Customer Dashboard'));
children.push(numbered('1. After signing in, the customer dashboard is displayed.'));
children.push(numbered('2. The dashboard shows a summary of the account, including the upcoming appointment, recent notifications, and recent transactions.'));
children.push(numbered('3. Use the left sidebar to move between the dashboard, booking, appointments, transactions, membership, notifications, and the AI assistant.'));
children.push(...figure('annotated/A04-customer-dashboard.png', 'Figure J.4. Customer Dashboard'));
children.push(body('The figure above shows the customer dashboard. The Upcoming Appointment card displays the next scheduled visit. The quick-action cards Book Appointment and My Appointments provide shortcuts to the most common tasks.'));

children.push(h3('Step 5 – Viewing Services'));
children.push(numbered('1. From the homepage navigation or the sidebar, open the Services page.'));
children.push(numbered('2. The page lists the clinic’s treatments grouped by category.'));
children.push(numbered('3. Click any service to open its details, including description, duration, and price.'));
children.push(...figure('annotated/A02-services.png', 'Figure J.5. Services Page'));
children.push(body('The figure above shows the list of available services. Each row shows the treatment name, short description, duration, and price. Clicking a row opens the Service Details page, where the customer may select Book This Service to begin booking that treatment.'));

children.push(h3('Step 6 – Booking an Appointment'));
children.push(body('The booking process is completed in four steps: Service, Treatment, Schedule, and Details. A newly submitted booking is placed as a request and is subject to confirmation by the clinic.'));
children.push(h3('Step 6.1 – Select a Service Category'));
children.push(numbered('1. Click Book Appointment from the navigation menu or the customer sidebar.'));
children.push(numbered('2. On the booking page, choose the category that describes the visit.'));
children.push(...figure('annotated/A03-booking-service.png', 'Figure J.6. Booking – Service Selection'));
children.push(body('The figure above shows the first step of booking. The customer selects the treatment category, such as facials, nails, or doctor’s procedures.'));
children.push(h3('Step 6.2 – Select a Treatment'));
children.push(numbered('1. After choosing a category, select the specific treatment.'));
children.push(numbered('2. Click Continue to move to the schedule step.'));
children.push(...figure('09-booking-treatment.png', 'Figure J.7. Booking – Treatment Selection'));
children.push(body('The figure above shows the treatment list for the selected category. Each treatment shows its duration and price.'));
children.push(h3('Step 6.3 – Select Date and Time'));
children.push(numbered('1. Choose an available Date from the calendar. Days when the clinic is closed are marked and cannot be selected.'));
children.push(numbered('2. Choose an available Time from the time slots. Only times within clinic operating hours are shown.'));
children.push(numbered('3. Optionally choose a preferred Specialist, or keep the default “Any available specialist”.'));
children.push(numbered('4. Click Continue.'));
children.push(...figure('10-booking-schedule.png', 'Figure J.8. Booking – Schedule Selection'));
children.push(body('The figure above shows the date and time selection. The customer picks the date and an available time slot within clinic operating hours.'));
children.push(h3('Step 6.4 – Confirm Details and Submit'));
children.push(numbered('1. Review the appointment summary on the right, including the selected service, date, time, and total.'));
children.push(numbered('2. Add optional Notes for any special requests.'));
children.push(numbered('3. Click Confirm Booking to submit the appointment.'));
children.push(...figure('08-booking-service.png', 'Figure J.9. Booking – Appointment Request'));
children.push(body('The figure above shows the booking interface, including the appointment summary panel on the right. After clicking Confirm Booking, the appointment is placed as a request and is confirmed by clinic staff.'));

children.push(h3('Step 7 – Viewing Appointments'));
children.push(numbered('1. Open My Appointments from the customer sidebar.'));
children.push(numbered('2. The list shows all appointments with their date, time, service, staff, and status.'));
children.push(numbered('3. Use the filters All, Upcoming, and Past to narrow the list.'));
children.push(numbered('4. To cancel a future appointment, click the cancel icon on the row and confirm.'));
children.push(...figure('annotated/A05-customer-appointments.png', 'Figure J.10. Customer Appointment List'));
children.push(body('The figure above shows the customer’s appointments. Appointment statuses include Booked, Confirmed, Arrived, Completed, Cancelled, and No Show. Cancelling an appointment frees the time slot and sends an SMS confirmation.'));

children.push(h3('Step 8 – Viewing Transactions and Treatment History'));
children.push(numbered('1. Open Transactions from the customer sidebar.'));
children.push(numbered('2. The Transactions tab lists past payments and their status.'));
children.push(numbered('3. Open the Treatment History tab to view records of completed treatments.'));
children.push(...figure('annotated/A06-customer-transactions.png', 'Figure J.11. Customer Transactions and Treatment History'));
children.push(body('The figure above shows the two tabs available under Transactions. Each transaction may be expanded to show its items and payment method, while each treatment record shows the notes and staff member who performed the service.'));

children.push(h3('Step 9 – AI Chatbot'));
children.push(numbered('1. The AI chatbot is available on the public pages through the floating chat button at the lower-right corner of the screen.'));
children.push(numbered('2. Click the button to open the Clinic Assistant chat panel.'));
children.push(numbered('3. Type a question in the message field and click Send.'));
children.push(numbered('4. The assistant answers questions about the clinic’s services, prices, clinic hours, and location, and can help with booking guidance.'));
children.push(...figure('annotated/A07-chatbot.png', 'Figure J.12. AI Chatbot Interface'));
children.push(body('The figure above shows the AI chatbot. The customer types a question in the Type a Message field and clicks Send. The chatbot answers clinic-related questions and does not provide medical diagnosis.'));

children.push(h3('Step 10 – Customer Profile'));
children.push(numbered('1. Click the profile name at the upper-right corner, or open My Profile.'));
children.push(numbered('2. Update the Phone Number, Email Address, personal details, and gender as needed.'));
children.push(numbered('3. Click Save Changes to apply the updates.'));
children.push(...figure('21-customer-profile.png', 'Figure J.13. Customer Profile'));
children.push(body('The figure above shows the profile page, where the customer may update contact details and personal information.'));

children.push(h3('Step 11 – Logout'));
children.push(numbered('1. Click the Logout icon at the upper-right corner of the dashboard.'));
children.push(numbered('2. The customer is signed out and returned to the login page.'));

// ===== PART II =====
children.push(h2('PART II. STAFF USER', { pageBreakBefore: true }));
children.push(body('The Staff user manages day-to-day clinic operations, including appointments, schedules, and walk-in retail sales. Staff access is limited to operational functions and does not include full administrative settings.'));

children.push(h3('Step 1 – Staff Login'));
children.push(numbered('1. Open the clinic website and click Sign In.'));
children.push(numbered('2. Enter the staff Email and Password.'));
children.push(numbered('3. Click Sign in. Active staff accounts are directed to the staff dashboard.'));

children.push(h3('Step 2 – Staff Dashboard'));
children.push(numbered('1. After signing in, the staff dashboard is displayed.'));
children.push(numbered('2. The dashboard shows key figures for the day, including today’s appointments and their statuses.'));
children.push(numbered('3. The Today’s Schedule section lists the appointments scheduled for the current day.'));
children.push(...figure('annotated/A08-staff-dashboard.png', 'Figure J.14. Staff Dashboard'));
children.push(body('The figure above shows the staff dashboard. The sidebar provides access to the Calendar, Appointments, My Schedule, Products & POS, and Notifications pages.'));

children.push(h3('Step 3 – Calendar and Appointment Management'));
children.push(numbered('1. Open Calendar from the staff sidebar.'));
children.push(numbered('2. The calendar shows appointments arranged by staff member for the selected day.'));
children.push(numbered('3. Use the date navigation controls to move between days, or click Today to return to the current day.'));
children.push(numbered('4. Click a booking block to open its details, or click New Appointment to create a booking.'));
children.push(...figure('annotated/A09-staff-calendar.png', 'Figure J.15. Staff Calendar'));
children.push(body('The figure above shows the appointment calendar. Each column represents a staff member, and each booking block shows the customer, time, and service. The Create Booking button opens the new-appointment form.'));

children.push(h3('Step 4 – Managing Appointments'));
children.push(numbered('1. Open Appointments from the staff sidebar.'));
children.push(numbered('2. Use the date field and the status filter to locate appointments.'));
children.push(numbered('3. Use the action buttons on each row to update the appointment status. Depending on the current status, the available actions are Confirm, Check In, Complete, and No Show.'));
children.push(...figure('26-staff-appointments.png', 'Figure J.16. Staff Appointment Management'));
children.push(body('The figure above shows the appointment list for staff. The customer name is a link that opens the customer’s record, including notes, allergies, and treatment history. Status changes update the appointment in real time.'));

children.push(h3('Step 5 – My Schedule'));
children.push(numbered('1. Open My Schedule from the staff sidebar.'));
children.push(numbered('2. The weekly schedule shows the staff member’s working hours, break times, and booked appointments for each day.'));
children.push(numbered('3. Click an appointment chip to open the customer’s details.'));
children.push(...figure('27-staff-schedule.png', 'Figure J.17. Staff Weekly Schedule'));
children.push(body('The figure above shows the weekly schedule. Days off are labelled, and break times are indicated for each working day.'));

children.push(h3('Step 6 – Products and Point of Sale (POS)'));
children.push(numbered('1. Open Products & POS from the staff sidebar.'));
children.push(numbered('2. Browse or search for a product, then click Add to place it in the cart.'));
children.push(numbered('3. Open the Cart, select the customer (or leave it as a walk-in customer), and choose the Payment Method.'));
children.push(numbered('4. Click Checkout to complete the sale. The system deducts the sold quantity from inventory.'));
children.push(...figure('28-staff-products-pos.png', 'Figure J.18. Staff Products and POS'));
children.push(body('The figure above shows the product list used for walk-in retail sales. Low-stock products are indicated in red. Checkout records the sale and updates the stock level.'));

children.push(h3('Step 7 – Logout'));
children.push(numbered('1. Click the Logout icon at the upper-right corner of the dashboard.'));

// ===== PART III =====
children.push(h2('PART III. ADMINISTRATOR / CLINIC OWNER', { pageBreakBefore: true }));
children.push(body('The Administrator has full access to the system, including all staff functions plus customer management, team management, services, products, inventory, analytics, and system settings.'));

children.push(h3('Step 1 – Administrator Login'));
children.push(numbered('1. Open the clinic website and click Sign In.'));
children.push(numbered('2. Enter the administrator Email and Password.'));
children.push(numbered('3. Click Sign in. Administrators are directed to the administrator dashboard.'));

children.push(h3('Step 2 – Administrator Dashboard'));
children.push(numbered('1. After signing in, the administrator dashboard is displayed.'));
children.push(numbered('2. The top row shows key statistics: Revenue (This Month), Appointments (This Month), Customers, and Low Stock Alerts.'));
children.push(numbered('3. Charts show revenue over time, top services, and appointment trends.'));
children.push(numbered('4. The Today’s Schedule table lists the active appointments for the current day.'));
children.push(...figure('annotated/A10-admin-dashboard.png', 'Figure J.19. Administrator Dashboard'));
children.push(body('The figure above shows the administrator dashboard. The Key Statistics summarize clinic performance, the Revenue Chart shows sales over time, and the Low Stock Alerts indicate products that need restocking.'));

children.push(h3('Step 3 – Calendar and Appointment Management'));
children.push(numbered('1. Open Bookings → Calendar from the sidebar.'));
children.push(numbered('2. The calendar shows appointments by staff member for the selected day.'));
children.push(numbered('3. Click a booking block to view or update its details, or use the booking menu to change status, reassign a specialist, edit services, reschedule, or cancel.'));
children.push(numbered('4. Use New Appointment to create a booking for a client or a walk-in.'));
children.push(...figure('30-admin-calendar.png', 'Figure J.20. Administrator Calendar'));
children.push(body('The figure above shows the administrator calendar. Appointment statuses are shown in the legend: Booked, Confirmed, Arrived, Started, Completed, Cancelled, and No Show.'));

children.push(h3('Step 4 – Appointment List'));
children.push(numbered('1. Open Bookings → Appointments.'));
children.push(numbered('2. Filter the list by date range, status, or staff member.'));
children.push(numbered('3. The table shows the date, time, customer, staff, service, and status of each appointment.'));
children.push(...figure('31-admin-appointments.png', 'Figure J.21. Administrator Appointment List'));
children.push(body('The figure above shows the full appointment list, which the administrator may filter to review clinic bookings.'));

children.push(h3('Step 5 – Customer Management'));
children.push(numbered('1. Open Customers from the sidebar.'));
children.push(numbered('2. The customer list shows each customer’s name, email, phone, gender, and status.'));
children.push(numbered('3. Click Add Customer to create a new customer record, or use the edit and delete actions on each row.'));
children.push(numbered('4. Click a customer’s name to open the customer detail panel, including appointments, records, notes, and history.'));
children.push(...figure('annotated/A16-admin-customers.png', 'Figure J.22. Customer Management'));
children.push(body('The figure above shows the customer management page. The Add Customer button opens a form for creating a new customer account.'));

children.push(h3('Step 6 – Team Management'));
children.push(numbered('1. Open Team → Team Members.'));
children.push(numbered('2. The staff list shows each member’s name, job title, weekly hours, and status.'));
children.push(numbered('3. Click Add Staff to create a staff account, or use the edit, schedule, and delete actions.'));
children.push(numbered('4. Open Team → Scheduled Shifts to view or adjust the weekly schedule grid.'));
children.push(...figure('annotated/A15-admin-staff.png', 'Figure J.23. Team Management'));
children.push(body('The figure above shows the team management page. The Add Staff Member button creates a new staff account, and the schedule action sets each member’s working hours.'));

children.push(h3('Step 7 – Services Management'));
children.push(numbered('1. Open Services → Services.'));
children.push(numbered('2. The service list shows each service’s name, category, type, price, duration, and status.'));
children.push(numbered('3. Click Add Service to create a new service, or use the edit and delete actions.'));
children.push(numbered('4. Open Services → Session Packages to manage multi-session packages.'));
children.push(...figure('annotated/A13-admin-services.png', 'Figure J.24. Services Management'));
children.push(body('The figure above shows the services page. The Add New Service button opens the service form, where the name, category, type, pricing, and duration are entered.'));

children.push(h3('Step 8 – Products Management'));
children.push(numbered('1. Open Products & Inventory → Products.'));
children.push(numbered('2. The product list shows each product’s name, SKU, category, unit, stock, minimum stock, and price.'));
children.push(numbered('3. Click Add Product to create a new product, or use the edit, delete, and add-to-cart actions.'));
children.push(numbered('4. Tick Low stock only to display products that are at or below their minimum stock.'));
children.push(...figure('annotated/A14-admin-products.png', 'Figure J.25. Products Management'));
children.push(body('The figure above shows the products page. The Add New Product button opens the product form, where the name, category, price, stock, and minimum stock are entered.'));

children.push(h3('Step 9 – Inventory Management'));
children.push(numbered('1. Open Products & Inventory → Inventory.'));
children.push(numbered('2. The Movements tab lists all stock movements with the date, product, type, quantity, and the user who recorded it.'));
children.push(numbered('3. To increase stock, click Record Purchase and enter the quantity and unit cost.'));
children.push(numbered('4. To correct stock, click Adjust Stock and select whether to add or deduct stock with a reason.'));
children.push(numbered('5. The Low Stock tab lists products at or below their minimum stock.'));
children.push(...figure('annotated/A12-admin-inventory.png', 'Figure J.26. Inventory Management'));
children.push(body('The figure above shows the inventory page. The Low Stock Indicator lists products that need restocking. Adjust Stock and Record Purchase record stock changes and keep the movement history.'));

children.push(h3('Step 10 – Descriptive Analytics'));
children.push(numbered('1. Open Reports → Analytics.'));
children.push(numbered('2. The analytics dashboard shows descriptive statistics and charts for the selected date range.'));
children.push(numbered('3. Use the Date Range Filter to select a preset period or a custom range.'));
children.push(numbered('4. The dashboard displays the Total Revenue summary, key performance indicators (Average Sale, Appointments, Occupancy Rate, and Returning Patients), and charts for revenue, bookings, and services.'));
children.push(numbered('5. Use Export PDF or Export Excel to download the analytics report.'));
children.push(...figure('annotated/A11-admin-analytics.png', 'Figure J.27. Descriptive Analytics Dashboard'));
children.push(body('The figure above shows the analytics dashboard. The Date Range Filter sets the reporting period, the Revenue Summary shows total revenue for the period, and Popular Services ranks the services by appointment count. The Analytics module presents descriptive statistics only and does not provide forecasting.'));

children.push(h3('Step 11 – Transactions and Reports'));
children.push(numbered('1. Open Reports → Transactions.'));
children.push(numbered('2. The page shows the net revenue, the total number of transactions, and the transaction list.'));
children.push(numbered('3. Filter by date range, payment status, type, or customer.'));
children.push(numbered('4. Use Export PDF or Export Excel to download the filtered transactions.'));
children.push(...figure('annotated/A17-admin-transactions.png', 'Figure J.28. Transactions and Reports'));
children.push(body('The figure above shows the transactions page. The Export PDF and Export Excel buttons download the filtered transaction records.'));

children.push(h3('Step 12 – Appointment Notifications and SMS'));
children.push(body('The system sends appointment notifications through the Notifications module. Appointment reminders are sent automatically, and cancellation notices are sent by SMS to the customer when an appointment is cancelled. Open System → Notifications to review notification activity. The system does not provide mass marketing SMS.'));

children.push(h3('Step 13 – System Settings'));
children.push(numbered('1. Open System → Settings.'));
children.push(numbered('2. Update the General Information, including clinic name, phone, email, and address.'));
children.push(numbered('3. Set the Business Hours by entering the opening and closing times.'));
children.push(numbered('4. Under Days We Are Open, toggle the days the clinic accepts bookings. Days that are switched off are hidden from customers.'));
children.push(numbered('5. Click Save Settings to apply the changes.'));
children.push(...figure('annotated/A18-admin-settings.png', 'Figure J.29. System Settings'));
children.push(body('The figure above shows the system settings page. The Business Hours and Open Days control when customers may book appointments.'));

children.push(h3('Step 14 – Logout'));
children.push(numbered('1. Click the Logout icon at the upper-right corner of the dashboard.'));

children.push(hr());
children.push(new Paragraph({
  alignment: AlignmentType.CENTER,
  children: [new TextRun({ text: 'End of Appendix J – User’s Manual', font: FONT, size: BODY, italics: true })],
}));

const doc = new Document({
  creator: 'Souvari Skin Lab',
  title: 'User’s Manual — Integrated Smart Clinic Management System',
  styles: {
    default: {
      document: { run: { font: FONT, size: BODY } },
    },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 }, // A4
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      },
    },
    children,
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log('Wrote', OUT, `(${(buf.length / 1024 / 1024).toFixed(2)} MB)`);
});
