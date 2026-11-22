const assert = require('node:assert/strict');
const { test } = require('node:test');

const { computeInvoiceFigures, render } = require('../lib/invoice');
const { computeTotals } = require('../lib/pricing');
const { getGstReconciliation } = require('../lib/reports');

function storedOrder(items, coupon = '') {
  const { subtotal, discount, tax, total } = computeTotals(items, coupon);
  return { id: 1, status: 'completed', items, coupon, subtotal, discount, tax, total };
}

test('invoice agrees with checkout on an 18% GST order without a coupon', () => {
  const order = storedOrder([{ name: 'Tea', hsn: '0902', price: 125, qty: 2 }]);
  const { tax, cgst, sgst, total, rows } = computeInvoiceFigures(order);

  assert.deepEqual({ tax, cgst, sgst, total }, {
    tax: 45, cgst: 22.5, sgst: 22.5, total: 295
  });
  assert.equal(tax, order.tax);
  assert.equal(total, order.total);
  assert.equal(rows[0].gstPercent, 18);
  assert.equal(rows[0].lineTax, 45);
  assert.doesNotMatch(render(order), /Accountant Reconciliation Notice/);
});

test('invoice uses the checkout GST rates for 5% and 12% HSN lines', () => {
  const order = storedOrder([
    { name: 'Rice', hsn: '1006', price: 100, qty: 1 },
    { name: 'Ghee', hsn: '0405', price: 100, qty: 1 }
  ]);
  const { tax, cgst, sgst, total, rows } = computeInvoiceFigures(order);

  assert.equal(order.tax, 17);
  assert.equal(order.total, 217);
  assert.deepEqual(rows.map(({ gstPercent, lineTax }) => [gstPercent, lineTax]), [
    [5, 5],
    [12, 12]
  ]);
  assert.deepEqual({ tax, cgst, sgst, total }, { tax: 17, cgst: 8.50, sgst: 8.50, total: 217 });
});

test('invoice applies SAVE10 before calculating GST', () => {
  const order = storedOrder([{ name: 'Rice', hsn: '1006', price: 1020, qty: 1 }], 'SAVE10');
  const figures = computeInvoiceFigures(order);

  assert.deepEqual([order.discount, order.tax, order.total], [102, 45.90, 963.90]);
  assert.deepEqual([figures.discount, figures.tax, figures.total], [102, 45.90, 963.90]);
  assert.deepEqual([figures.cgst, figures.sgst], [22.95, 22.95]);
});

test('invoice honours the SAVE10 discount cap', () => {
  const order = storedOrder([{ name: 'Tea', hsn: '0902', price: 2240, qty: 1 }], 'SAVE10');
  const figures = computeInvoiceFigures(order);

  assert.deepEqual([order.discount, order.tax, order.total], [150, 376.20, 2466.20]);
  assert.deepEqual([figures.discount, figures.tax, figures.total], [150, 376.20, 2466.20]);
});

test('printed invoice and GST audit agree with the billed SAVE10 order', () => {
  const order = storedOrder([{ name: 'Rice', hsn: '1006', price: 1020, qty: 1 }], 'SAVE10');
  const html = render(order);
  const { mismatchCount, totalDelta, rows } = getGstReconciliation({ orders: [order] });

  assert.match(html, /CGST \+ SGST \(Total GST\)<\/td><td class="r">₹45\.90/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹963\.90/);
  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
  assert.equal(mismatchCount, 0);
  assert.equal(totalDelta, 0);
  assert.equal(rows[0].matched, true);
  assert.equal(rows[0].ledgerTax, 45.90);
  assert.equal(rows[0].invoiceTax, 45.90);
});

test('invoice matches billed totals and per-line GST on a discounted mixed-rate order', () => {
  const order = storedOrder([
    { name: 'Rice', hsn: '1006', price: 300, qty: 2 },
    { name: 'Ghee', hsn: '0405', price: 400, qty: 1 }
  ], 'SAVE10');
  const { subtotal, discount, tax, cgst, sgst, total, rows } = computeInvoiceFigures(order);

  assert.deepEqual({ subtotal, discount, tax, cgst, sgst, total }, {
    subtotal: 1000,
    discount: 100,
    tax: 70.20,
    cgst: 35.10,
    sgst: 35.10,
    total: 970.20
  });
  assert.deepEqual(rows.map(({ gstPercent, lineTax }) => [gstPercent, lineTax]), [
    [5, 27],
    [12, 43.20]
  ]);
});
