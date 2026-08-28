import { PrismaClient, UserRole, ClientType, ClientRating, Unit, TransactionStatus, DeliveryStatus, ExpenseCategory, BranchType, ProductCategory, VehicleType } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });
config({ path: resolve(process.cwd(), '.env') });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required to run database seed.');
}
const adapter = new PrismaPg({ connectionString });
const prisma  = new PrismaClient({ adapter });

async function main() {
  console.log('🌱 Seeding Sabzi Ledger database...');

  // ─── Branch ─────────────────────────────────────────────────────────────────
  const branch = await prisma.branch.upsert({
    where: { id: 'branch_main' },
    update: {},
    create: {
      id:      'branch_main',
      name:    'Main Distribution Center',
      address: 'Mandi Road, Karachi',
      phone:   '0300-0000000',
      type:    BranchType.MAIN,
    },
  });
  console.log('✅ Branch created:', branch.name);

  // ─── Users ──────────────────────────────────────────────────────────────────
  const ownerPwd  = await bcrypt.hash('sabzi1234', 10);
  const staffPwd  = await bcrypt.hash('staff1234', 10);

  const owner = await prisma.user.upsert({
    where: { email: 'owner@sabziledger.com' },
    update: {},
    create: {
      id:       'user_owner',
      name:     'Ahmad Raza (Owner)',
      email:    'owner@sabziledger.com',
      password: ownerPwd,
      role:     UserRole.OWNER,
      branchId: branch.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'manager@sabziledger.com' },
    update: {},
    create: {
      name:     'Bilal Manager',
      email:    'manager@sabziledger.com',
      password: staffPwd,
      role:     UserRole.MANAGER,
      branchId: branch.id,
    },
  });

  await prisma.user.upsert({
    where: { email: 'cashier@sabziledger.com' },
    update: {},
    create: {
      name:     'Fatima Cashier',
      email:    'cashier@sabziledger.com',
      password: staffPwd,
      role:     UserRole.CASHIER,
      branchId: branch.id,
    },
  });
  console.log('✅ Users created (owner, manager, cashier)');

  const aliPassword = await bcrypt.hash('1234', 10);

  await prisma.employee.upsert({
    where: { employeeId: 'EMP-001' },
    update: {
      password: aliPassword,
    },
    create: {
      employeeId: 'EMP-001',
      name: 'Ali Khan',
      role: 'DELIVERY_STAFF' as any,
      phone: '0300-1234567',
      salary: 35000,
      joiningDate: new Date(),
      isActive: true,
      branchId: branch.id,
      fatherName: 'Khan Bacha',
      cnic: '42101-1234567-8',
      address: 'Gulshan-e-Iqbal, Karachi',
      whatsapp: '0300-1234567',
      email: 'ali.khan@example.com',
      paymentStructure: 'Monthly',
      notes: 'Seeded employee',
      password: aliPassword,
    },
  });
  console.log('✅ Employee created: Ali Khan');

  // ─── Products ────────────────────────────────────────────────────────────────
  const products = [
    // Vegetables
    { name: 'Tomato',        urduName: 'ٹماٹر',    category: 'vegetable', defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Potato',        urduName: 'آلو',       category: 'vegetable', defaultUnit: Unit.KG,  minStock: 50 },
    { name: 'Onion',         urduName: 'پیاز',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 40 },
    { name: 'Garlic',        urduName: 'لہسن',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 7 },
    { name: 'Ginger',        urduName: 'ادرک',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Green Chilli',  urduName: 'ہری مرچ',   category: 'vegetable', defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Coriander',     urduName: 'دھنیا',     category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Cabbage',       urduName: 'بند گوبھی', category: 'vegetable', defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Cauliflower',   urduName: 'پھول گوبھی',category: 'vegetable', defaultUnit: Unit.PIECE, minStock: 10 },
    { name: 'Carrot',        urduName: 'گاجر',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Peas',          urduName: 'مٹر',       category: 'vegetable', defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Spinach',       urduName: 'پالک',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Cucumber',      urduName: 'کھیرا',     category: 'vegetable', defaultUnit: Unit.KG,  minStock: 15 },
    { name: 'Brinjal',       urduName: 'بینگن',     category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Lady Finger',   urduName: 'بھنڈی',    category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Pumpkin',       urduName: 'کدو',       category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Bottle Gourd',  urduName: 'لوکی',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Bitter Gourd',  urduName: 'کریلا',     category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Turnip',        urduName: 'شلجم',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Radish',        urduName: 'مولی',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Beans',         urduName: 'پھلیاں',    category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Lemon',         urduName: 'لیموں',     category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Mint',          urduName: 'پودینہ',     category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Capsicum',      urduName: 'شملہ مرچ',   category: 'vegetable', defaultUnit: Unit.KG,  minStock: 15 },
    { name: 'Sweet Potato',  urduName: 'شکرقندی',    category: 'vegetable', defaultUnit: Unit.KG,  minStock: 15 },
    { name: 'Corn',          urduName: 'مکئی',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 15 },
    { name: 'Mushroom',      urduName: 'مشروم',     category: 'vegetable', defaultUnit: Unit.BOX, minStock: 5 },
    { name: 'Beetroot',      urduName: 'چقندر',     category: 'vegetable', defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Lettuce',       urduName: 'لیٹش',      category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Broccoli',      urduName: 'بروکلی',     category: 'vegetable', defaultUnit: Unit.KG,  minStock: 5 },
    // Fruits
    { name: 'Apple',         urduName: 'سیب',       category: 'fruit',     defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Banana',        urduName: 'کیلا',      category: 'fruit',     defaultUnit: Unit.DOZEN, minStock: 10 },
    { name: 'Mango',         urduName: 'آم',        category: 'fruit',     defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Orange',        urduName: 'مالٹا',     category: 'fruit',     defaultUnit: Unit.DOZEN, minStock: 10 },
    { name: 'Grapes',        urduName: 'انگور',     category: 'fruit',     defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Watermelon',    urduName: 'تربوز',     category: 'fruit',     defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Melon',         urduName: 'خربوزہ',     category: 'fruit',     defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Guava',         urduName: 'امرود',     category: 'fruit',     defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Papaya',        urduName: 'پیتا',      category: 'fruit',     defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Pear',          urduName: 'ناشپاتی',    category: 'fruit',     defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Plum',          urduName: 'آلوبخارا',   category: 'fruit',     defaultUnit: Unit.KG,  minStock: 10 },
    { name: 'Peach',         urduName: 'آڑو',       category: 'fruit',     defaultUnit: Unit.KG,  minStock: 5 },
    { name: 'Pomegranate',   urduName: 'انار',       category: 'fruit',     defaultUnit: Unit.KG,  minStock: 10 },
  ];

  for (const p of products) {
    const categoryEnum = p.category.toUpperCase() as ProductCategory;
    await prisma.product.upsert({
      where: { name: p.name },
      update: { urduName: p.urduName, category: categoryEnum, defaultUnit: p.defaultUnit },
      create: {
        name: p.name,
        urduName: p.urduName,
        category: categoryEnum,
        defaultUnit: p.defaultUnit,
        minStock: p.minStock
      },
    });
  }
  console.log(`✅ ${products.length} catalog master products seeded`);

  // ─── Price List (header-detail) ───────────────────────────────────────────────
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const sampleRates: Record<string, { buy: number; sell: number }> = {
    'Tomato':       { buy: 60,  sell: 80 },
    'Potato':       { buy: 40,  sell: 55 },
    'Onion':        { buy: 50,  sell: 70 },
    'Green Chilli': { buy: 120, sell: 160 },
    'Garlic':       { buy: 200, sell: 260 },
    'Ginger':       { buy: 180, sell: 240 },
    'Coriander':    { buy: 80,  sell: 120 },
    'Spinach':      { buy: 40,  sell: 60 },
    'Cabbage':      { buy: 30,  sell: 45 },
    'Cucumber':     { buy: 50,  sell: 70 },
    'Carrot':       { buy: 60,  sell: 85 },
    'Apple':        { buy: 180, sell: 240 },
    'Banana':       { buy: 100, sell: 140 },
    'Orange':       { buy: 90,  sell: 130 },
    'Mango':        { buy: 150, sell: 200 },
  };

  const allProducts = await prisma.product.findMany();
  const productMap = Object.fromEntries(allProducts.map((p: { name: string; id: string }) => [p.name, p]));

  // Check if today's price list already exists
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayEnd   = new Date(); todayEnd.setHours(23, 59, 59, 999);
  const existingPL = await prisma.priceList.findFirst({ where: { branchId: branch.id, date: { gte: todayStart, lte: todayEnd } } });

  if (!existingPL) {
    await prisma.priceList.create({
      data: {
        date:     today,
        branchId: branch.id,
        notes:    'Seeded sample rates',
        items: {
          create: allProducts.map((p: { id: string; name: string; defaultUnit: Unit }) => {
            const r = sampleRates[p.name] ?? { buy: 45, sell: 65 }; // Default rate for items not in sample
            return {
              productId: p.id,
              itemName:  p.name,
              unit:      p.defaultUnit,
              buyRate:   r.buy,
              sellRate:  r.sell,
            };
          }),
        },
      },
    }).catch(() => {});
  }
  console.log('✅ Price list seeded with all catalog products');


  // ─── Clients ─────────────────────────────────────────────────────────────────
  const clientsData = [
    { name: 'Ali General Store',     phone: '0321-1111111', address: 'Block 5, PECHS',    creditLimit: 50000,  openingBalance: 12000, rating: ClientRating.GREEN  },
    { name: 'Bismillah Kiryana',     phone: '0333-2222222', address: 'Landhi Town',        creditLimit: 30000,  openingBalance: 8500,  rating: ClientRating.YELLOW },
    { name: 'Hassan Fruits Corner',  phone: '0300-3333333', address: 'Gulshan-e-Iqbal',   creditLimit: 70000,  openingBalance: 45000, rating: ClientRating.RED    },
    { name: 'Kareem Vegetables',     phone: '0312-4444444', address: 'North Nazimabad',   creditLimit: 40000,  openingBalance: 5000,  rating: ClientRating.GREEN  },
    { name: 'Rehman Super Store',    phone: '0345-5555555', address: 'Orangi Town',       creditLimit: 60000,  openingBalance: 22000, rating: ClientRating.YELLOW },
    { name: 'Siddiqui Wholesale',    phone: '0311-6666666', address: 'New Karachi',       creditLimit: 100000, openingBalance: 0,     rating: ClientRating.GREEN  },
    { name: 'Mehboob Fruit Stall',   phone: '0322-7777777', address: 'Saddar Bazar',      creditLimit: 20000,  openingBalance: 18000, rating: ClientRating.RED    },
    { name: 'Farhan Hotel Kitchen',  phone: '0317-8888888', address: 'Clifton Block 2',   creditLimit: 80000,  openingBalance: 3000,  rating: ClientRating.GREEN  },
  ];

  for (const c of clientsData) {
    // Derive clientId from last 4 digits of phone (e.g., 0321-1111111 → WH-1111)
    const cleanPhone = c.phone.replace(/\D/g, '');
    const last4 = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : '0001';
    const clientId = `WH-${last4}`;

    await prisma.client.create({
      data: { ...c, clientId, type: ClientType.RETAIL, branchId: branch.id },
    }).catch(() => {});
  }
  console.log(`✅ ${clientsData.length} clients created`);

  // ─── Suppliers ───────────────────────────────────────────────────────────────
  const suppliersData = [
    { name: 'Karachi Mandi Traders', phone: '0300-9001000', address: 'Sabzi Mandi, Karachi',   openingBalance: 15000 },
    { name: 'Punjab Fresh Supplies', phone: '0321-9002000', address: 'Ravi Road, Lahore',       openingBalance: 8000  },
    { name: 'Sindh Vegetable Co.',   phone: '0333-9003000', address: 'Hyderabad Bypass',        openingBalance: 0     },
    { name: 'Ahmed Brothers Fruits', phone: '0311-9004000', address: 'Fruit Mandi, Karachi',    openingBalance: 25000 },
  ];

  for (const s of suppliersData) {
    await prisma.supplier.create({
      data: { ...s, branchId: branch.id },
    }).catch(() => {});
  }
  console.log(`✅ ${suppliersData.length} suppliers created`);

  // ─── Cash Account ─────────────────────────────────────────────────────────────
  await prisma.cashAccount.upsert({
    where: { id: 'cash_main' },
    update: {},
    create: { id: 'cash_main', name: 'Main Cash', balance: 50000, branchId: branch.id },
  });

  // ─── Vehicles & Drivers ───────────────────────────────────────────────────────
  const driver1 = await prisma.driver.create({
    data: { name: 'Imran Driver', phone: '0300-1100000', licenceNo: 'KHI-2024-001', branchId: branch.id },
  }).catch(async () => await prisma.driver.findFirst({ where: { name: 'Imran Driver' } }));

  const driver2 = await prisma.driver.create({
    data: { name: 'Saleem Driver', phone: '0321-2200000', licenceNo: 'KHI-2024-002', branchId: branch.id },
  }).catch(async () => await prisma.driver.findFirst({ where: { name: 'Saleem Driver' } }));

  if (driver1?.id) {
    await prisma.vehicle.create({
      data: { plateNo: 'KHI-1234', type: VehicleType.TRUCK,  driverId: driver1.id, branchId: branch.id },
    }).catch(() => {});
  }
  if (driver2?.id) {
    await prisma.vehicle.create({
      data: { plateNo: 'KHI-5678', type: VehicleType.PICKUP, driverId: driver2.id, branchId: branch.id },
    }).catch(() => {});
  }
  console.log('✅ Vehicles & drivers seeded');

  // ─── Sample Purchases (3 days of history) ─────────────────────────────────────
  const clients   = await prisma.client.findMany({ where: { branchId: branch.id } });
  const suppliers = await prisma.supplier.findMany({ where: { branchId: branch.id } });

  // Day -2: purchase from supplier
  const purchase1 = await prisma.purchase.create({
    data: {
      supplierId:    suppliers[0].id,
      date:          new Date(Date.now() - 2 * 86400000),
      subtotal:      14500,
      transportCost: 500,
      total:         15000,
      paid:          15000,
      balance:       0,
      status:        TransactionStatus.PAID,
      branchId:      branch.id,
      items: {
        create: [
          { productId: productMap['Tomato']?.id,  itemName: 'Tomato',   qty: 100, unit: Unit.KG, rate: 60, amount: 6000 },
          { productId: productMap['Potato']?.id,  itemName: 'Potato',   qty: 150, unit: Unit.KG, rate: 40, amount: 6000 },
          { productId: productMap['Onion']?.id,   itemName: 'Onion',    qty: 50,  unit: Unit.KG, rate: 50, amount: 2500 },
        ],
      },
    },
  });

  // Update inventory from purchase1
  for (const [name, qty, avgCost] of [['Tomato', 100, 60], ['Potato', 150, 40], ['Onion', 50, 50]] as [string, number, number][]) {
    const prod = productMap[name];
    if (!prod) continue;
    await prisma.inventory.upsert({
      where:  { productId_branchId: { productId: prod.id, branchId: branch.id } },
      update: { qty: { increment: qty }, updatedAt: new Date() },
      create: { productId: prod.id, branchId: branch.id, qty, avgCost },
    });
  }

  // Day -1: two sales
  const sale1 = await prisma.sale.upsert({
    where: { clientId_invoiceNo: { clientId: clients[0].id, invoiceNo: 'SL-001' } },
    update: {},
    create: {
      invoiceNo: 'SL-001',
      clientId: clients[0].id,
      date: new Date(Date.now() - 1 * 86400000),
      subtotal: 8000,
      total: 8000,
      paid: 5000,
      balance: 3000,
      status: TransactionStatus.PARTIAL,
      deliveryStatus: DeliveryStatus.DELIVERED,
      branchId: branch.id,
      userId: owner.id,
      items: {
        create: [
          { productId: productMap['Tomato']?.id, itemName: 'Tomato', qty: 50, unit: Unit.KG, rate: 80, amount: 4000 },
          { productId: productMap['Onion']?.id,  itemName: 'Onion',  qty: 30, unit: Unit.KG, rate: 70, amount: 2100 },
          { productId: productMap['Potato']?.id, itemName: 'Potato', qty: 25, unit: Unit.KG, rate: 55, amount: 1375 },
        ],
      },
    },
  });

  // Today's sale
  await prisma.sale.upsert({
    where: { clientId_invoiceNo: { clientId: clients[1].id, invoiceNo: 'SL-002' } },
    update: {},
    create: {
      invoiceNo: 'SL-002',
      clientId: clients[1].id,
      date: new Date(),
      subtotal: 5600,
      total: 5600,
      paid: 0,
      balance: 5600,
      status: TransactionStatus.PENDING,
      deliveryStatus: DeliveryStatus.OUT,
      branchId: branch.id,
      userId: owner.id,
      items: {
        create: [
          { productId: productMap['Tomato']?.id, itemName: 'Tomato', qty: 20, unit: Unit.KG, rate: 80, amount: 1600 },
          { productId: productMap['Potato']?.id, itemName: 'Potato', qty: 40, unit: Unit.KG, rate: 55, amount: 2200 },
          { productId: productMap['Onion']?.id,  itemName: 'Onion',  qty: 20, unit: Unit.KG, rate: 70, amount: 1400 },
        ],
      },
    },
  });

  // Collection on sale1
  await prisma.collection.create({
    data: {
      clientId: clients[0].id,
      amount:   5000,
      method:   'CASH' as any,
      date:     new Date(Date.now() - 1 * 86400000),
      notes:    'Cash payment received',
      branchId: branch.id,
    },
  });

  // Today's expense
  await prisma.expense.create({
    data: {
      category:    ExpenseCategory.TRANSPORT,
      description: 'Fuel for delivery truck KHI-1234',
      amount:      2500,
      date:        new Date(),
      branchId:    branch.id,
    },
  });

  console.log('✅ Sample transactions seeded');
  console.log('');
  console.log('🎉 Seed complete! Login with:');
  console.log('   Email:    owner@sabziledger.com');
  console.log('   Password: sabzi1234');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
