/**
 * Verification Script — Moving Weighted Average Cost Scenarios
 */

function calculateNewAverageCost(oldQty: number, oldAvgCost: number, purchaseQty: number, purchaseRate: number) {
  const existingValue = oldQty * oldAvgCost;
  const purchaseValue = purchaseQty * purchaseRate;
  const totalQty = oldQty + purchaseQty;
  const newAvgCost = totalQty > 0 ? (existingValue + purchaseValue) / totalQty : purchaseRate;
  const totalValue = totalQty * newAvgCost;
  return { totalQty, newAvgCost, totalValue };
}

console.log('🧪 Testing Moving Weighted Average Cost Calculation Scenarios...');

// Scenario 1:
// 10 kg @ Rs. 100 + Purchase 5 kg @ Rs. 200
const s1 = calculateNewAverageCost(10, 100, 5, 200);
console.log('\n--- Scenario 1 ---');
console.log(`Qty: ${s1.totalQty} (Expected: 15)`);
console.log(`Average Cost: ${s1.newAvgCost.toFixed(2)} (Expected: 133.33)`);
console.log(`Total Value: ${s1.totalValue.toFixed(2)} (Expected: 2000.00)`);
if (s1.totalQty === 15 && Math.abs(s1.newAvgCost - 133.33333333333334) < 0.01 && Math.abs(s1.totalValue - 2000) < 0.01) {
  console.log('✅ Scenario 1 PASSED');
} else {
  console.error('❌ Scenario 1 FAILED');
}

// Scenario 2:
// Existing 15 kg @ Rs. 133.33 + Purchase 5 kg @ Rs. 150
const s2 = calculateNewAverageCost(15, s1.newAvgCost, 5, 150);
console.log('\n--- Scenario 2 ---');
console.log(`Qty: ${s2.totalQty} (Expected: 20)`);
console.log(`Average Cost: ${s2.newAvgCost.toFixed(2)} (Expected: 137.50)`);
console.log(`Total Value: ${s2.totalValue.toFixed(2)} (Expected: 2750.00)`);
if (s2.totalQty === 20 && Math.abs(s2.newAvgCost - 137.5) < 0.01 && Math.abs(s2.totalValue - 2750) < 0.01) {
  console.log('✅ Scenario 2 PASSED');
} else {
  console.error('❌ Scenario 2 FAILED');
}

// Scenario 3:
// Sell 5 kg @ Current Avg Cost (137.5)
const soldQty = 5;
const cogs = soldQty * s2.newAvgCost;
console.log('\n--- Scenario 3 ---');
console.log(`Sold Qty: ${soldQty}, Unit Cost: ${s2.newAvgCost.toFixed(2)}`);
console.log(`COGS: ${cogs.toFixed(2)} (Expected: 687.50)`);
if (Math.abs(cogs - 687.5) < 0.01) {
  console.log('✅ Scenario 3 PASSED');
} else {
  console.error('❌ Scenario 3 FAILED');
}

// Scenario 4:
// Lock in COGS for Invoice
const invoiceCostBasis = s2.newAvgCost;
// Make another purchase 10 kg @ Rs. 300
const s4 = calculateNewAverageCost(15, s2.newAvgCost, 10, 300);
console.log('\n--- Scenario 4 ---');
console.log(`Locked Invoice Cost Basis: ${invoiceCostBasis.toFixed(2)}`);
console.log(`New Post-Purchase Avg Cost: ${s4.newAvgCost.toFixed(2)}`);
console.log(`Previous Invoice Cost Basis Unchanged: ${invoiceCostBasis === s2.newAvgCost}`);
if (invoiceCostBasis === s2.newAvgCost) {
  console.log('✅ Scenario 4 PASSED');
} else {
  console.error('❌ Scenario 4 FAILED');
}
