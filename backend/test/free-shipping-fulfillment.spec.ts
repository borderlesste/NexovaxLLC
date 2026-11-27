jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));

import { OrdersService } from '../src/orders/orders.service';
import { SELLER_FREE_SHIPPING } from '../src/shipping/free-shipping';
import { ShippingSettlementService } from '../src/shipping/shipping-settlement.service';
import { ShippingService } from '../src/shipping/shipping.service';

function labelFixture(groupToken: string, requestedToken: string, existing: { id: string } | null = null) {
  const db = {
    one: jest.fn().mockResolvedValue(null)
      .mockResolvedValueOnce({ status: 'READY_TO_SHIP', service_token: groupToken, requested_service_token: requestedToken })
      .mockResolvedValueOnce(existing),
  };
  const shippo = { shipment: jest.fn(), buyLabel: jest.fn() };
  return { db, shippo, service: new ShippingService(db as any, null!, shippo as any) };
}

const paidPackage = { id: 'paid', shipping_provider_code: 'SHIPPO', from_city: 'Miami', seller_free_shipping: false };
const freePackage = { id: 'free', shipping_provider_code: 'MARKETPLACE', from_city: 'Miami', seller_free_shipping: true };

function fulfillmentFixture(packages: (typeof paidPackage)[]) {
  const db = {
    tx: jest.fn((fn) => fn({})),
    one: jest.fn().mockResolvedValue({ id: 'tracking' })
      .mockResolvedValueOnce({ id: 'so', order_id: 'order', seller_id: 'store' })
      .mockResolvedValueOnce(null),
    many: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(packages),
    exec: jest.fn(),
  };
  const shipping = { shippoEnabled: true, buyLabel: jest.fn().mockResolvedValue({ labelId: 'label' }), manualTrackingProvider: jest.fn() };
  // The tracking number is not used by another shipment.
  const lookup = db.one;
  db.one = jest.fn((sql: string, ...rest: unknown[]) => (/upper\(st\.tracking_number\)/.test(sql) ? Promise.resolve(null) : lookup(sql, ...rest))) as any;
  const settlement = { settle: jest.fn() };
  const mail = { fire: jest.fn() };
  const orders = new OrdersService(db as any, mail as any, shipping as any, settlement as any, null!);
  return { orders, db, shipping, settlement };
}

describe('seller-arranged free shipping fulfillment', () => {
  it.each([[SELLER_FREE_SHIPPING, 'other'], ['other', SELLER_FREE_SHIPPING]])(
    'refuses a platform purchase when the group or shipment records seller-paid postage', async (group, requested) => {
      const { db, shippo, service } = labelFixture(group, requested);
      await expect(service.buyLabel('shipment')).rejects.toMatchObject({ code: 'SELLER_FREE_SHIPPING_MANUAL_ONLY' });
      expect(db.one).toHaveBeenCalledTimes(2);
      expect(shippo.shipment).not.toHaveBeenCalled();
      expect(shippo.buyLabel).not.toHaveBeenCalled();
    },
  );

  it('returns the reference to an already purchased label without spending again', async () => {
    const { shippo, service } = labelFixture(SELLER_FREE_SHIPPING, SELLER_FREE_SHIPPING, { id: 'label' });
    await expect(service.buyLabel('shipment')).resolves.toEqual({ labelId: 'label', alreadyPurchased: true });
    expect(shippo.buyLabel).not.toHaveBeenCalled();
  });

  it('rejects label mode for a mixed batch before dispatching even the first paid package', async () => {
    const { orders, db, shipping, settlement } = fulfillmentFixture([paidPackage, freePackage]);
    await expect(orders.ship('store', 'so', 'actor', { mode: 'LABEL' }))
      .rejects.toMatchObject({ code: 'SELLER_FREE_SHIPPING_MANUAL_ONLY' });
    expect(db.many).toHaveBeenCalledWith(expect.stringContaining('sh.requested_service_token, g.service_token'), ['so', SELLER_FREE_SHIPPING], expect.anything());
    expect(shipping.buyLabel).not.toHaveBeenCalled();
    expect(settlement.settle).not.toHaveBeenCalled();
    expect(db.exec).not.toHaveBeenCalled();
  });

  it.each(['MANUAL' as const, undefined])('records a seller-provided tracking number in mode %s', async (mode) => {
    const { orders, db, shipping } = fulfillmentFixture([freePackage]);
    const result = await orders.ship('store', 'so', 'actor', { mode, carrierCode: 'OTHER', carrierName: 'Local courier', trackingNumber: 'LOCAL123' });
    expect(result).toMatchObject({ mode: 'MANUAL', shipments: [{ shipmentId: 'free', trackingNumber: 'LOCAL123' }] });
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('register_external_tracking'), ['free', 'MARKETPLACE', 'OTHER', 'LOCAL123', null], expect.anything());
    expect(shipping.buyLabel).not.toHaveBeenCalled();
  });

  it('prevents replacing seller-paid delivery with store pickup', async () => {
    const { orders, db } = fulfillmentFixture([freePackage]);
    await expect(orders.ship('store', 'so', 'actor', { mode: 'MANUAL', carrierCode: 'PICKUP' }))
      .rejects.toMatchObject({ code: 'SELLER_FREE_SHIPPING_REQUIRES_DELIVERY' });
    expect(db.exec).not.toHaveBeenCalled();
  });

  it.each([
    [freePackage, 'OWN_DELIVERY'],
    [{ ...freePackage, seller_free_shipping: false }, 'PICKUP'],
  ] as const)('continues to accept own delivery and ordinary pickup', async (shipment, carrierCode) => {
    const { orders } = fulfillmentFixture([shipment]);
    const result = await orders.ship('store', 'so', 'actor', { mode: 'MANUAL', carrierCode });
    expect(result.shipments[0].trackingNumber).toMatch(/^NX-/);
  });

  it('keeps platform labels available to ordinary carrier shipments', async () => {
    const { orders, shipping } = fulfillmentFixture([paidPackage]);
    await expect(orders.ship('store', 'so', 'actor', {})).resolves.toMatchObject({ mode: 'LABEL' });
    expect(shipping.buyLabel).toHaveBeenCalledWith('paid');
  });

  it('leaves a zero-charge manual shipment without a seller reimbursement or platform expense', async () => {
    const db = {
      tx: jest.fn((fn) => fn({})),
      one: jest.fn().mockResolvedValueOnce({ group_id: 'group', charged: '0.00' })
        .mockResolvedValueOnce(null).mockResolvedValueOnce({ a: '0.00' }).mockResolvedValueOnce(null),
      exec: jest.fn(),
    };
    await expect(new ShippingSettlementService(db as any).settle('free', 'actor')).resolves.toBeNull();
    expect(db.one).toHaveBeenCalledTimes(4);
    expect(db.exec).not.toHaveBeenCalled();
  });
});
