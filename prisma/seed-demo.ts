/**
 * Fills the database with one believable barbershop so the API can be poked at
 * by hand: a shop with services, staff, opening hours, and a queue that is
 * part-way through today.
 *
 * Run with: npx ts-node prisma/seed-demo.ts
 * It removes anything it created previously, so it is safe to re-run.
 */
import { BookingStatus, PrismaClient, Role } from '@prisma/client';
import { PasswordService } from '../src/auth/password.service';
import { todayInZone, wallClockToInstant } from '../src/common/timezone';

const prisma = new PrismaClient();
const passwords = new PasswordService();

const TIMEZONE = 'Asia/Jakarta';
const PASSWORD = 'demo1234';

const OWNER_EMAIL = 'budi@barbershop.demo';
const STAFF_EMAIL = 'andi@barbershop.demo';
const CUSTOMERS = [
  { email: 'siti@demo.test', name: 'Siti Rahayu' },
  { email: 'agus@demo.test', name: 'Agus Wijaya' },
  { email: 'dewi@demo.test', name: 'Dewi Lestari' },
  { email: 'rudi@demo.test', name: 'Rudi Hartono' },
];

async function main(): Promise<void> {
  const emails = [OWNER_EMAIL, STAFF_EMAIL, ...CUSTOMERS.map((c) => c.email)];

  // Users cascade to shops, and shops cascade to everything under them.
  await prisma.user.deleteMany({ where: { email: { in: emails } } });

  const passwordHash = await passwords.hash(PASSWORD);

  const owner = await prisma.user.create({
    data: { email: OWNER_EMAIL, name: 'Budi Santoso', role: Role.OWNER, passwordHash },
  });

  const shop = await prisma.shop.create({
    data: {
      ownerId: owner.id,
      name: 'Barbershop Pak Budi',
      address: 'Jl. Melati No. 12, Bandung',
      timezone: TIMEZONE,
    },
  });

  const services = await Promise.all(
    [
      { name: 'Potong Rambut Pria', durationMinutes: 30, price: 35_000 },
      { name: 'Potong + Keramas', durationMinutes: 45, price: 50_000 },
      { name: 'Cukur Jenggot', durationMinutes: 15, price: 20_000 },
      { name: 'Creambath', durationMinutes: 60, price: 90_000 },
    ].map((service) => prisma.service.create({ data: { ...service, shopId: shop.id } })),
  );

  // Andi has a login and can advance the queue; Cecep is schedulable only.
  const andi = await prisma.staff.create({
    data: {
      // `connect` rather than a bare shopId: Prisma will not mix a raw foreign
      // key with a nested create in the same call.
      shop: { connect: { id: shop.id } },
      name: 'Andi',
      user: {
        create: { email: STAFF_EMAIL, name: 'Andi Pratama', role: Role.STAFF, passwordHash },
      },
    },
  });
  const cecep = await prisma.staff.create({ data: { shopId: shop.id, name: 'Cecep' } });

  // Open Monday to Saturday; closed on Sunday.
  await prisma.workingHours.createMany({
    data: [1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      shopId: shop.id,
      dayOfWeek,
      openMinute: 9 * 60,
      closeMinute: dayOfWeek === 6 ? 21 * 60 : 20 * 60,
    })),
  });

  const customers = await Promise.all(
    CUSTOMERS.map((customer) =>
      prisma.user.create({
        data: { ...customer, role: Role.CUSTOMER, passwordHash },
      }),
    ),
  );

  // A queue part-way through today: one finished, one in the chair, two waiting.
  const { year, month, day } = todayInZone(TIMEZONE);
  const at = (minute: number) => wallClockToInstant(TIMEZONE, year, month, day, minute);

  const plan = [
    { customer: 0, staff: andi.id, service: 0, start: 9 * 60, status: BookingStatus.DONE },
    { customer: 1, staff: andi.id, service: 1, start: 10 * 60, status: BookingStatus.IN_PROGRESS },
    { customer: 2, staff: andi.id, service: 0, start: 11 * 60, status: BookingStatus.BOOKED },
    { customer: 3, staff: cecep.id, service: 3, start: 11 * 60, status: BookingStatus.WAITING },
  ];

  for (const entry of plan) {
    const service = services[entry.service];
    await prisma.booking.create({
      data: {
        shopId: shop.id,
        serviceId: service.id,
        staffId: entry.staff,
        customerId: customers[entry.customer].id,
        startTime: at(entry.start),
        endTime: at(entry.start + service.durationMinutes),
        status: entry.status,
      },
    });
  }

  const line = (label: string, value: string) => console.log(`  ${label.padEnd(12)} ${value}`);

  console.log('\nSeeded demo data\n');
  line('Shop', `${shop.name}  (${shop.id})`);
  line('Owner', `${OWNER_EMAIL} / ${PASSWORD}`);
  line('Staff', `${STAFF_EMAIL} / ${PASSWORD}`);
  line('Customer', `${CUSTOMERS[0].email} / ${PASSWORD}`);
  line('Services', services.map((s) => `${s.name} (${s.id})`).join('\n               '));
  line('Staff ids', `Andi ${andi.id}\n               Cecep ${cecep.id}`);
  line('Today', `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} in ${TIMEZONE}`);
  console.log('');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
