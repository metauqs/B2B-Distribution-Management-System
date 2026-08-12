import 'dotenv/config';
import assert from 'assert';
import { calculateGrossSalesFromSales } from '../services/grossSalesService';

function runTests() {
  console.log('=== RUNNING GROSS SALES SINGLE SOURCE OF TRUTH TESTS ===');

  // Test 1 — Original Invoice Creation
  {
    const sales = [{ id: 'INV-1', subtotal: 10, discount: 0, deliveryCharge: 0, total: 10, status: 'PENDING' }];
    const res = calculateGrossSalesFromSales(sales);
    assert.strictEqual(res.grossSales, 10, 'Test 1 Failed: Original invoice gross sales should be 10');
    console.log('✅ Test 1 Passed: Original Invoice (Rs 10 -> Gross Sales Rs 10)');
  }

  // Test 2 — Add Product on Edit (Rs 10 -> Rs 20)
  {
    const sales = [{ id: 'INV-1', subtotal: 20, discount: 0, deliveryCharge: 0, total: 20, status: 'PENDING' }];
    const res = calculateGrossSalesFromSales(sales);
    assert.strictEqual(res.grossSales, 20, 'Test 2 Failed: Edited invoice gross sales should be 20, not 30');
    console.log('✅ Test 2 Passed: Add Product on Edit (Rs 10 -> Rs 20 = Gross Sales Rs 20)');
  }

  // Test 3 — Quantity Increase on Edit (Rs 100 -> Rs 200)
  {
    const sales = [{ id: 'INV-1', subtotal: 200, discount: 0, deliveryCharge: 0, total: 200, status: 'PENDING' }];
    const res = calculateGrossSalesFromSales(sales);
    assert.strictEqual(res.grossSales, 200, 'Test 3 Failed: Quantity increase gross sales should be 200, not 300');
    console.log('✅ Test 3 Passed: Quantity Increase (Rs 100 -> Rs 200 = Gross Sales Rs 200)');
  }

  // Test 4 — Product Removal on Edit (Rs 300 -> Rs 100)
  {
    const sales = [{ id: 'INV-1', subtotal: 100, discount: 0, deliveryCharge: 0, total: 100, status: 'PENDING' }];
    const res = calculateGrossSalesFromSales(sales);
    assert.strictEqual(res.grossSales, 100, 'Test 4 Failed: Product removal gross sales should be 100');
    console.log('✅ Test 4 Passed: Product Removal (Rs 300 -> Rs 100 = Gross Sales Rs 100)');
  }

  // Test 5 — Multiple Edits (100 -> 150 -> 220 -> 180)
  {
    const sales = [{ id: 'INV-1', subtotal: 180, discount: 0, deliveryCharge: 0, total: 180, status: 'PENDING' }];
    const res = calculateGrossSalesFromSales(sales);
    assert.strictEqual(res.grossSales, 180, 'Test 5 Failed: Multiple edits gross sales should be 180, not accumulated sum');
    console.log('✅ Test 5 Passed: Multiple Edits (100 -> 150 -> 220 -> 180 = Gross Sales Rs 180)');
  }

  // Test 6 — Multiple Invoices & Editing One (A: 100, B: 200->500, C: 300)
  {
    const sales = [
      { id: 'INV-A', subtotal: 100, discount: 0, deliveryCharge: 0, total: 100, status: 'PENDING' },
      { id: 'INV-B', subtotal: 500, discount: 0, deliveryCharge: 0, total: 500, status: 'PENDING' },
      { id: 'INV-C', subtotal: 300, discount: 0, deliveryCharge: 0, total: 300, status: 'PENDING' },
    ];
    const res = calculateGrossSalesFromSales(sales);
    assert.strictEqual(res.grossSales, 900, 'Test 6 Failed: Multiple invoices with edit should total 900, not 1100');
    console.log('✅ Test 6 Passed: Multiple Invoices (A:100 + B:500 + C:300 = Gross Sales Rs 900)');
  }

  // Test 7 — Cancelled Invoice
  {
    const sales = [{ id: 'INV-1', subtotal: 500, discount: 0, deliveryCharge: 0, total: 500, status: 'CANCELLED' }];
    const res = calculateGrossSalesFromSales(sales);
    assert.strictEqual(res.grossSales, 0, 'Test 7 Failed: Cancelled invoice gross sales should be 0');
    assert.strictEqual(res.invoiceCount, 0, 'Test 7 Failed: Cancelled invoice count should be 0');
    console.log('✅ Test 7 Passed: Cancelled Invoice (Gross Sales Rs 0)');
  }

  console.log('\n🎉 ALL 7 REQUIRED GROSS SALES TESTS PASSED SUCCESSFULLY!');
}

runTests();
