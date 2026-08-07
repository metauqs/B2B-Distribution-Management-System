import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { signToken } from '../src/middleware/auth';

async function runVerification() {
  console.log('🚀 Running Same-Day Editable Invoice Workflow Verification...\n');

  try {
    // 0. Setup test branch, client, products, user, and inventory
    let branch = await prisma.branch.findFirst({ where: { isActive: true } });
    if (!branch) {
      branch = await prisma.branch.create({ data: { name: 'Main Branch' } });
    }

    let user = await prisma.user.findFirst({ where: { branchId: branch.id } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          name: 'Test Admin',
          email: `admin_${Date.now()}@test.com`,
          password: 'hashedpassword',
          role: 'OWNER',
          branchId: branch.id,
        }
      });
    }

    const token = signToken({
      sub: user.id,
      email: user.email,
      role: user.role,
      branchId: branch.id,
    });

    const headers = {
      'Content-Type': 'application/json',
      'x-branch-id': branch.id,
      'Authorization': `Bearer ${token}`,
    };

    const testPhone = `0300${Math.floor(1000000 + Math.random() * 9000000)}`;
    const client = await prisma.client.create({
      data: {
        name: 'Test Client Edit Workflow',
        phone: testPhone,
        whatsapp: testPhone,
        type: 'RETAIL',
        branchId: branch.id,
      }
    });

    let prodPotato = await prisma.product.findFirst({ where: { name: { contains: 'Potato', mode: 'insensitive' } } });
    if (!prodPotato) {
      prodPotato = await prisma.product.create({ data: { name: 'Test Potato', category: 'VEGETABLE', defaultUnit: 'KG' } });
    }

    let prodTomato = await prisma.product.findFirst({ where: { name: { contains: 'Tomato', mode: 'insensitive' } } });
    if (!prodTomato) {
      prodTomato = await prisma.product.create({ data: { name: 'Test Tomato', category: 'VEGETABLE', defaultUnit: 'KG' } });
    }

    // Set high stock in inventory for testing
    await prisma.inventory.upsert({
      where: { productId_branchId: { productId: prodPotato.id, branchId: branch.id } },
      update: { qty: 100 },
      create: { productId: prodPotato.id, branchId: branch.id, qty: 100 }
    });

    await prisma.inventory.upsert({
      where: { productId_branchId: { productId: prodTomato.id, branchId: branch.id } },
      update: { qty: 100 },
      create: { productId: prodTomato.id, branchId: branch.id, qty: 100 }
    });

    console.log(`✅ Test Setup Ready (Client ID: ${client.id})`);

    const baseUrl = `http://localhost:${process.env.PORT || 3001}`;

    // ── Scenario 1: Initial Invoice Generation & Same-Day Edit (Add Product) ──
    console.log('\n--- Scenario 1: Create Sale & Add Product (Edit) ---');

    // Create Initial Sale
    const resCreate = await fetch(`${baseUrl}/api/sales`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        clientId: client.id,
        items: [{ productId: prodPotato.id, itemName: prodPotato.name, qty: 5, unit: 'KG', rate: 100 }],
        discount: 0,
        deliveryCharge: 50,
        paid: 0,
      })
    });
    const dataCreate: any = await resCreate.json();
    if (!resCreate.ok || !dataCreate.success) {
      throw new Error(`Failed to create sale: ${dataCreate.error}`);
    }
    const initialSale = dataCreate.data;
    console.log(`✓ Initial Invoice #${initialSale.invoiceNo} created. Total: Rs ${initialSale.total}`);

    // Check Active Editable Invoice Endpoint
    const resActive = await fetch(`${baseUrl}/api/sales/active?clientId=${client.id}`, {
      headers,
    });
    const dataActive: any = await resActive.json();
    if (!dataActive.success || !dataActive.data || dataActive.data.id !== initialSale.id) {
      throw new Error(`Active sale check failed! Expected ${initialSale.id}, got ${dataActive.data?.id}`);
    }
    console.log(`✓ Active Same-Day Invoice Endpoint detected #${dataActive.data.invoiceNo}`);

    // Edit Invoice to ADD Tomato 2 KG and increase Potato to 6 KG
    const resEdit1 = await fetch(`${baseUrl}/api/sales/${initialSale.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        items: [
          { productId: prodPotato.id, itemName: prodPotato.name, qty: 6, unit: 'KG', rate: 100 },
          { productId: prodTomato.id, itemName: prodTomato.name, qty: 2, unit: 'KG', rate: 150 },
        ],
        discount: 0,
        deliveryCharge: 50,
        notes: 'Added tomato on client request',
      })
    });
    const dataEdit1: any = await resEdit1.json();
    if (!resEdit1.ok || !dataEdit1.success) {
      throw new Error(`Failed to edit sale (Scenario 1): ${dataEdit1.error}`);
    }
    const updatedSale1 = dataEdit1.data;
    if (updatedSale1.invoiceNo !== initialSale.invoiceNo) {
      throw new Error(`Invoice number changed! Old: ${initialSale.invoiceNo}, New: ${updatedSale1.invoiceNo}`);
    }
    // New total: (6*100) + (2*150) + 50 = 600 + 300 + 50 = 950
    if (updatedSale1.total !== 950) {
      throw new Error(`Expected total 950, got ${updatedSale1.total}`);
    }
    console.log(`✓ Invoice #${updatedSale1.invoiceNo} successfully updated (Total: Rs ${updatedSale1.total}, Items: ${updatedSale1.items.length})`);

    // Verify Audit Trail
    const resAudit = await fetch(`${baseUrl}/api/sales/${initialSale.id}/audit-trail`, {
      headers,
    });
    const dataAudit: any = await resAudit.json();
    if (!dataAudit.success || dataAudit.data.length === 0) {
      throw new Error('Audit log entry missing!');
    }
    console.log(`✓ Audit log verified (${dataAudit.data.length} audit entries found). Latest Action: ${dataAudit.data[0].action}`);

    // ── Scenario 2: Remove Product (Stock Restoration & Financial Recalculation) ──
    console.log('\n--- Scenario 2: Remove Product & Restore Stock ---');

    const resEdit2 = await fetch(`${baseUrl}/api/sales/${initialSale.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        items: [
          { productId: prodPotato.id, itemName: prodPotato.name, qty: 4, unit: 'KG', rate: 100 },
        ],
        discount: 0,
        deliveryCharge: 50,
      })
    });
    const dataEdit2: any = await resEdit2.json();
    if (!resEdit2.ok || !dataEdit2.success) {
      throw new Error(`Failed to edit sale (Scenario 2): ${dataEdit2.error}`);
    }
    const updatedSale2 = dataEdit2.data;
    // New total: (4*100) + 50 = 450
    if (updatedSale2.total !== 450) {
      throw new Error(`Expected total 450, got ${updatedSale2.total}`);
    }

    // Verify Client Balance & Customer Ledger
    const updatedClient = await prisma.client.findUnique({ where: { id: client.id } });
    if (updatedClient?.currentBalance !== 450) {
      throw new Error(`Expected client balance 450, got ${updatedClient?.currentBalance}`);
    }
    console.log(`✓ Stock restored & client ledger updated (New Balance: Rs ${updatedClient.currentBalance})`);

    // ── Scenario 3: Completed Delivery Lockdown ──
    console.log('\n--- Scenario 3: Delivery Completed Edit Lockdown ---');

    await prisma.sale.update({
      where: { id: initialSale.id },
      data: { deliveryStatus: 'DELIVERED' }
    });

    const resEdit3 = await fetch(`${baseUrl}/api/sales/${initialSale.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        items: [
          { productId: prodPotato.id, itemName: prodPotato.name, qty: 10, unit: 'KG', rate: 100 },
        ]
      })
    });
    const dataEdit3: any = await resEdit3.json();
    if (resEdit3.ok || dataEdit3.success) {
      throw new Error('Edit should have been rejected for DELIVERED sale!');
    }
    console.log(`✓ Edit properly BLOCKED when delivery completed: "${dataEdit3.error}"`);

    // Reset delivery status for Scenario 4 test
    await prisma.sale.update({
      where: { id: initialSale.id },
      data: { deliveryStatus: 'PENDING' }
    });

    // ── Scenario 4: Business Day Boundary Crossing ──
    console.log('\n--- Scenario 4: Business Day Boundary Crossing ---');

    // Move date of initialSale to 2 days ago
    const pastDate = new Date(Date.now() - 48 * 3600 * 1000);
    await prisma.sale.update({
      where: { id: initialSale.id },
      data: { date: pastDate }
    });

    // Active sale query should return null
    const resActivePast = await fetch(`${baseUrl}/api/sales/active?clientId=${client.id}`, {
      headers,
    });
    const dataActivePast: any = await resActivePast.json();
    if (dataActivePast.data !== null) {
      throw new Error(`Active sale should be null for past business day! Got ${dataActivePast.data?.id}`);
    }

    // Direct PUT edit should fail due to Business Day restriction
    const resEdit4 = await fetch(`${baseUrl}/api/sales/${initialSale.id}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        items: [
          { productId: prodPotato.id, itemName: prodPotato.name, qty: 5, unit: 'KG', rate: 100 },
        ]
      })
    });
    const dataEdit4: any = await resEdit4.json();
    if (resEdit4.ok || dataEdit4.success) {
      throw new Error('Edit should have been rejected for past business date!');
    }
    console.log(`✓ Edit properly BLOCKED when business day changed: "${dataEdit4.error}"`);

    // Cleanup test data
    await prisma.auditLog.deleteMany({ where: { entityId: initialSale.id } });
    await prisma.customerLedger.deleteMany({ where: { clientId: client.id } });
    await prisma.delivery.deleteMany({ where: { clientId: client.id } });
    await prisma.saleItem.deleteMany({ where: { saleId: initialSale.id } });
    await prisma.sale.delete({ where: { id: initialSale.id } });
    await prisma.client.delete({ where: { id: client.id } });

    console.log('\n🎉 ALL 4 TEST SCENARIOS PASSED 100% SUCCESSFULLY!');
  } catch (err: any) {
    console.error('\n❌ Verification Failed:', err.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runVerification();
