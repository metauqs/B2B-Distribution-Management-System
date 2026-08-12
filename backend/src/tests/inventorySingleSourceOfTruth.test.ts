import 'dotenv/config';
import assert from 'assert';

function computeStockFromMovementsWithBaseline(
  movements: Array<{ qty: number; type?: string; refType?: string; newStock?: number }>
): number {
  if (movements.length === 0) return 0;

  let lastBaselineIdx = -1;
  for (let i = movements.length - 1; i >= 0; i--) {
    const m = movements[i];
    const isBaseline =
      m.refType === 'adjustment' ||
      m.refType === 'admin_reset' ||
      m.type === 'OPENING' ||
      (m.type === 'ADJUSTMENT' && m.refType !== 'sale_edit_restore');
    if (isBaseline) {
      lastBaselineIdx = i;
      break;
    }
  }

  if (lastBaselineIdx !== -1) {
    const baselineMove = movements[lastBaselineIdx];
    const baselineQty = Math.max(0, Number(baselineMove.newStock || 0));
    const subsequentSum = movements.slice(lastBaselineIdx + 1).reduce((sum, m) => sum + Number(m.qty || 0), 0);
    return Math.max(0, Math.round((baselineQty + subsequentSum) * 1000) / 1000);
  }

  const sumAll = movements.reduce((sum, m) => sum + Number(m.qty || 0), 0);
  return Math.max(0, Math.round(sumAll * 1000) / 1000);
}

function runTests() {
  console.log('=== RUNNING INVENTORY BASELINE SINGLE SOURCE OF TRUTH TESTS ===');

  // Test 1 — Purchase Stock In (+10 KG)
  {
    const moves = [{ qty: 10 }];
    const stock = computeStockFromMovementsWithBaseline(moves);
    assert.strictEqual(stock, 10);
    console.log('✅ Test 1 Passed: Stock In +10 KG -> Stock = 10 KG');
  }

  // Test 2 — Billing Stock Out (-3 KG)
  {
    const moves = [{ qty: 10 }, { qty: -3 }];
    const stock = computeStockFromMovementsWithBaseline(moves);
    assert.strictEqual(stock, 7);
    console.log('✅ Test 2 Passed: Billing Stock Out -3 KG -> Stock = 7 KG');
  }

  // Test 3 — Physical Count Correction SET (7 KG -> 1.5 KG)
  {
    const moves = [
      { qty: 50 },                                    // Old historical purchase from 3 weeks ago
      { qty: -30 },                                   // Old sales
      { qty: -18.5, type: 'ADJUSTMENT', refType: 'adjustment', newStock: 1.5 } // Physical set count = 1.5
    ];
    const stock = computeStockFromMovementsWithBaseline(moves);
    assert.strictEqual(stock, 1.5);
    console.log('✅ Test 3 Passed: Physical Baseline SET to 1.5 KG ignores obsolete historical sum');
  }

  // Test 4 — Subsequent Sale after Physical Baseline (1.5 KG - 0.5 KG = 1.0 KG)
  {
    const moves = [
      { qty: 50 },
      { qty: -30 },
      { qty: -18.5, type: 'ADJUSTMENT', refType: 'adjustment', newStock: 1.5 },
      { qty: -0.5, type: 'SALE', refType: 'sale' }   // New sale after baseline
    ];
    const stock = computeStockFromMovementsWithBaseline(moves);
    assert.strictEqual(stock, 1.0);
    console.log('✅ Test 4 Passed: Subsequent Sale after physical baseline -> Stock = 1.0 KG');
  }

  console.log('\n🎉 ALL INVENTORY BASELINE SINGLE SOURCE OF TRUTH TESTS PASSED!');
}

runTests();
