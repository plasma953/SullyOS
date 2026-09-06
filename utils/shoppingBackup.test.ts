import { describe, it, expect } from 'vitest';
import { DB, openDB } from './db';
import { knownBackupStoreFieldMap } from './backupCoverage';
import type { ShoppingOrder } from './shoppingTypes';

// fake-indexeddb 已通过 test-setup.ts 注入。

const order = (id: string): ShoppingOrder => ({
  id,
  placedBy: 'user',
  recipientType: 'user',
  recipientName: 'Tester',
  addressText: ' somewhere ',
  shopId: 's1',
  shopName: 'Shop',
  shopCat: 'food',
  items: [],
  itemCount: 0,
  subtotal: 10,
  deliveryFee: 2,
  total: 12,
  payMethod: 'bank_card',
  status: 'placed',
  statusHistory: [{ status: 'placed', at: 1 }],
  createdAt: 1,
});

async function clearShopping(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('shopping_orders', 'readwrite');
    tx.objectStore('shopping_orders').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

describe('shopping orders backup', () => {
  it('KNOWN maps shopping_orders to shoppingOrders', () => {
    expect(knownBackupStoreFieldMap()['shopping_orders']).toBe('shoppingOrders');
  });

  it('exportFullData carries shopping orders', async () => {
    await clearShopping();
    await DB.saveShoppingOrder(order('ord-1'));
    const data = await DB.exportFullData();
    expect(data.shoppingOrders).toEqual([expect.objectContaining({ id: 'ord-1' })]);
    await clearShopping();
  });

  it('importFullData restores shopping orders', async () => {
    await clearShopping();
    await DB.importFullData({ shoppingOrders: [order('ord-2')] } as any);
    expect(await DB.getAllShoppingOrders()).toEqual([expect.objectContaining({ id: 'ord-2' })]);
    await clearShopping();
  });
});
