const assert = require('node:assert/strict');
const { test } = require('node:test');

const inventory = require('../lib/inventory');
const orders = require('../lib/orders');

function products() {
  return [
    { id: 1, name: 'Ghee', stock: 1, reserved: 0 },
    { id: 2, name: 'Chilli powder', stock: 4, reserved: 3 },
    { id: 3, name: 'Sunflower oil', stock: 10, reserved: 2 }
  ];
}

function pendingOrder() {
  return {
    products: products(),
    orders: [{
      id: 1007,
      status: 'pending',
      items: [{ id: 1, qty: 2 }, { id: 3, qty: 2 }]
    }]
  };
}

test('rejects orders above sellable stock and deducts a smaller order from physical stock', () => {
  const catalog = products();
  assert.equal(inventory.check(catalog, [{ id: 2, qty: 2 }]).ok, false);

  const items = [{ id: 3, qty: 2 }];
  assert.equal(inventory.check(catalog, items).ok, true);
  inventory.reserve(catalog, items);
  assert.equal(catalog[2].stock, 8);
  assert.equal(catalog[2].reserved, 2);
  assert.equal(inventory.getSellableStock(catalog[2]), 6);
});

test('accepts the exact remaining quantity with or without holds', () => {
  const catalog = products();
  for (const [id, qty] of [[1, 1], [2, 1], [3, 8]]) {
    assert.equal(inventory.check(catalog, [{ id, qty }]).ok, true);
  }
});

test('cancelling a pending order restores physical stock and preserves wholesale holds', () => {
  const db = pendingOrder();
  const result = orders.cancel(db, 1007, 'Customer cancelled');

  assert.equal(result.ok, true);
  assert.equal(result.order.status, 'cancelled');
  assert.deepEqual(db.products.map(product => product.stock), [3, 4, 12]);
  assert.deepEqual(db.products.map(product => product.reserved), [0, 3, 2]);
});

test('regression: the final sellable unit can be billed and restored exactly once', () => {
  const db = { products: products(), orders: [] };
  const items = [{ id: 2, qty: 1 }];
  const product = db.products[1];

  assert.deepEqual(inventory.check(db.products, items), { ok: true });
  inventory.reserve(db.products, items);
  assert.deepEqual([product.stock, product.reserved, inventory.getSellableStock(product)], [3, 3, 0]);

  db.orders.push({ id: 1, status: 'pending', items });
  assert.equal(orders.cancel(db, 1).ok, true);
  assert.equal(orders.cancel(db, 1).ok, false);
  assert.deepEqual([product.stock, product.reserved, inventory.getSellableStock(product)], [4, 3, 1]);
});

test('regression: cancelling a pending order restores each ordered quantity', () => {
  const db = pendingOrder();

  assert.equal(orders.cancel(db, 1007).ok, true);
  assert.deepEqual(db.products.map(product => inventory.getSellableStock(product)), [3, 1, 10]);
  assert.deepEqual(db.products.map(product => product.reserved), [0, 3, 2]);
});

test('duplicate lines cannot exceed the combined sellable quantity for a SKU', () => {
  const catalog = products();
  assert.equal(inventory.check(catalog, [{ id: 3, qty: 4 }, { id: '3', qty: 4 }]).ok, true);
  assert.equal(inventory.check(catalog, [{ id: 3, qty: 8 }, { id: '3', qty: 1 }]).ok, false);
});

test('cancellation restores stock when a stored order line uses productId', () => {
  const db = pendingOrder();
  db.orders[0].items = [{ productId: 2, qty: 2 }];

  assert.equal(orders.cancel(db, 1007).ok, true);
  assert.equal(db.products[1].stock, 6);
  assert.equal(db.products[1].reserved, 3);
});
