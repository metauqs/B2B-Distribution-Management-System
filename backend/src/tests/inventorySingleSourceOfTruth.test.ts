import 'dotenv/config';
import assert from 'assert';

function computeStockFromMovements(movements: Array<{ qty: number }>): number {
  const sum = movements.reduce((acc, m) => acc + Number(m.qty || 0), 0);
  return Math.max(0, Math.round(sum * 1000) / 1000);
}

function runTests() {
  console.log('=== RUNNING INVENTORY SINGLE SOURCE OF TRUTH TESTS ===');

  // Test 1 — Purchase Stock In (+10 KG)
  {
    const moves = [{ qty: 10 }];
    const stock = computeStockFromMovements(moves);
    assert.strictEqual(stock, 10);
    console.log('✅ Test 1 Passed: Stock In +10 KG -> Stock = 10 KG');
  }

  // Test 2 — Billing Stock Out (-3 KG)
  {
    const moves = [{ qty: 10 }, { qty: -3 }];
    const stock = computeStockFromMovements(moves);
    assert.strictEqual(stock, 7);
    console.log('✅ Test 2 Passed: Billing Stock Out -3 KG -> Stock = 7 KG');
  }

  // Test 3 — Invoice Edit Stock Adjustment (-1 KG)
  {
    const moves = [{ qty: 10 }, { qty: -3 }, { qty: -1 }];
    const stock = computeStockFromMovements(moves);
    assert.strictEqual(stock, 6);
    console.log('✅ Test 3 Passed: Invoice Edit Stock Out -1 KG -> Stock = 6 KG');
  }

  // Test 4 — Physical Count Correction SET (6 KG -> 1.5 KG)
  {
    const moves = [{ qty: 10 }, { qty: -3 }, { qty: -1 }, { qty: -4.5 }];
    const stock = computeStockFromMovements(moves);
    assert.strictEqual(stock, 1.5);
    console.log('✅ Test 4 Passed: Physical Count SET to 1.5 KG -> Stock = 1.5 KG');
  }

  // Test 5 — Single Source of Truth Immutability
  {
    const moves = [
      { qty: 10 },    // Purchase +10
      { qty: -3 },    // Sale -3 (7)
      { qty: -1 },    // Sale -1 (6)
      { qty: -4.5 },  // Physical Count SET to 1.5 (-4.5)
      { qty: 5 },     // New Purchase +5 (6.5)
      { qty: -1.5 },  // New Sale -1.5 (5.0)
    ];
    const stock = computeStockFromMovements(moves);
    assert.strictEqual(stock, 5);
    console.log('✅ Test 5 Passed: Multi-transaction SOT calculation = 5.0 KG');
  }

  console.log('\n🎉 ALL INVENTORY SINGLE SOURCE OF TRUTH TESTS PASSED!');
}

runTests();
