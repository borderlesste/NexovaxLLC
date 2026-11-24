import 'reflect-metadata';
jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));

import { validate } from 'class-validator';
import { PATH_METADATA } from '@nestjs/common/constants';
import { RequestUser } from '../src/auth/auth';
import { AdminTrackingDto } from '../src/admin/admin.controller';
import { OrdersController } from '../src/orders/orders.controller';
import { OrdersService } from '../src/orders/orders.service';
import { SellerController, TrackingDto } from '../src/seller/seller.controller';
import { ShippingService } from '../src/shipping/shipping.service';

const customer = { kind: 'customer' as const, userId: 'buyer' };
const seller = { kind: 'seller' as const, sellerId: 'shop', userId: 'seller-member' };
const shipment = {
  id: 'shipment', tracking_id: 'tracking', order_id: 'order', seller_id: 'shop', customer_id: 'buyer',
  status: 'SHIPPED', shipped_at: new Date(), current_status: 'OUT_FOR_DELIVERY', provider_tracking_id: null,
};

function fixture(overrides: Record<string, unknown> = {}) {
  const row = { ...shipment, ...overrides };
  const connection = {};
  const db = {
    one: jest.fn().mockResolvedValue(row),
    many: jest.fn().mockResolvedValue([]),
    exec: jest.fn().mockResolvedValue(null),
    tx: jest.fn((run) => run(connection)),
  };
  const mail = { fire: jest.fn((send) => send()), shipmentDelivered: jest.fn() };
  const shippo = { testMode: true, track: jest.fn() };
  const shipping = new ShippingService(db as any, null!, shippo as any);
  const orders = new OrdersService(db as any, mail as any, shipping, null!, null!);
  const controller = new SellerController(null!, orders, null!, db as any, null!);
  return { row, db, mail, shippo, shipping, orders, controller, connection };
}

describe('delivery authority', () => {
  it('retires the buyer confirmation route and limits delivery in the tracking DTOs to sellers', async () => {
    const routes = Object.values(Object.getOwnPropertyDescriptors(OrdersController.prototype))
      .filter((desc) => typeof desc.value === 'function')
      .map((desc) => Reflect.getMetadata(PATH_METADATA, desc.value));
    expect(routes).toContain('shipments/:id/refresh-tracking');
    expect(routes).not.toContain('shipments/:id/confirm-delivery');
    await expect(validate(Object.assign(new TrackingDto(), { status: 'DELIVERED' }))).resolves.toHaveLength(0);
    await expect(validate(Object.assign(new AdminTrackingDto(), { status: 'DELIVERED' }))).resolves.toHaveLength(1);
  });

  it.each([customer, { kind: 'admin' as const }])('rejects a manual confirmation from $kind', async (actor) => {
    const { orders, db } = fixture();
    await expect(orders.updateTracking(actor, 'shipment', 'DELIVERED')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(db.tx).not.toHaveBeenCalled();
  });

  it('requires permission to manage orders at the store', () => {
    const { controller, db } = fixture();
    const user = { id: seller.userId, sellers: [{ id: 'shop', isOwner: false, areas: ['PRODUCTS'] }] } as RequestUser;
    expect(() => controller.tracking(user, 'shipment', { status: 'DELIVERED' }, 'shop')).toThrow(/permiso/);
    expect(db.tx).not.toHaveBeenCalled();
  });

  it.each([
    [{ seller_id: 'another-shop' }, 'NOT_FOUND'],
    [{ customer_id: seller.userId }, 'FORBIDDEN'],
    [{ provider_tracking_id: 'ups' }, 'TRACKING_AUTOMATIC'],
    [{ shipped_at: null }, 'SHIPMENT_NOT_DISPATCHED'],
    [{ status: 'CANCELLED' }, 'SHIPMENT_CLOSED'],
    [{ current_status: 'RETURNED' }, 'SHIPMENT_CLOSED'],
    [{ status: 'RETURNED' }, 'SHIPMENT_CLOSED'],
  ] as const)('rejects an ineligible shipment %j', async (overrides, code) => {
    const { orders, db, mail } = fixture(overrides);
    await expect(orders.updateTracking(seller, 'shipment', 'DELIVERED')).rejects.toMatchObject({ code });
    expect(db.exec).not.toHaveBeenCalled();
    expect(mail.fire).not.toHaveBeenCalled();
  });

  it('records a single timestamped, attributable delivery and evaluates payout on the same transaction', async () => {
    const { controller, db, row, mail, connection } = fixture();
    const user = { id: seller.userId, sellers: [{ id: 'shop', isOwner: false, areas: ['ORDERS'] }] } as RequestUser;
    const confirm = () => controller.tracking(user, 'shipment', { status: 'DELIVERED' }, 'shop');
    await expect(confirm()).resolves.toEqual({ ok: true });
    expect(db.one).toHaveBeenCalledWith(expect.stringContaining('for update of st, sh'), ['shipment'], connection);
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('apply_tracking_event($1,$2,$3,now()'),
      ['tracking', expect.any(String), 'DELIVERED', 'delivered', 'El vendedor confirmó la entrega.', null,
        JSON.stringify({ source: 'manual', sellerUserId: seller.userId })], connection);
    expect(db.many).toHaveBeenCalledWith(expect.stringContaining('so.fulfillment_status'), ['order'], connection);
    row.status = 'DELIVERED';
    await expect(confirm()).resolves.toEqual({ ok: true });
    expect(db.exec).toHaveBeenCalledTimes(1);
    expect(mail.shipmentDelivered).toHaveBeenCalledTimes(1);
  });

  it.each([customer, { ...seller, userId: 'buyer' }, { kind: 'admin' as const }])('a refresh by $kind cannot simulate carrier delivery', async (actor) => {
    const { orders, shippo, db } = fixture({ provider_tracking_id: 'ups' });
    await expect(orders.refreshShipmentTracking(actor, 'shipment')).resolves.toMatchObject({ applied: 0, delivered: false });
    expect(shippo.track).not.toHaveBeenCalled();
    expect(db.exec).not.toHaveBeenCalled();
  });

  it('takes delivery from the registered carrier when a buyer refreshes a live shipment', async () => {
    const { orders, shipping, shippo } = fixture({ provider_tracking_id: 'ups', tracking_number: 'guide' });
    shippo.testMode = false;
    const event = { status: 'DELIVERED', at: new Date().toISOString() };
    shippo.track.mockResolvedValue({ history: [event] });
    const apply = jest.spyOn(shipping, 'applyTrack').mockResolvedValue({ applied: 1, delivered: true, status: 'DELIVERED' });
    await expect(orders.refreshShipmentTracking(customer, 'shipment')).resolves.toMatchObject({ applied: 1, delivered: true });
    expect(shippo.track).toHaveBeenCalledWith('ups', 'guide');
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ tracking_number: 'guide' }), [event]);
  });

  it('applies one carrier delivery across repeated updates and ignores a cancelled shipment', async () => {
    const { shipping, db, row } = fixture();
    const event = {
      status: 'DELIVERED', providerStatus: 'DELIVERED', at: '2026-11-24T12:01:00Z', objectId: 'carrier-event',
      substatus: null, detail: 'Delivered', city: null, region: null, postalCode: null, country: null,
    };
    const tracking = { id: 'tracking', shipment_id: 'shipment', order_id: 'order' };
    db.one.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
    await expect(shipping.applyTrack(tracking, [event, event])).resolves.toMatchObject({ applied: 1, delivered: true });
    expect(db.exec).toHaveBeenCalledWith(expect.stringContaining('apply_tracking_event'),
      ['tracking', 'shippo:carrier-event', 'DELIVERED', event.at, 'DELIVERED', null, 'Delivered', null, null, null, null,
        'carrier-event', JSON.stringify({ source: 'shippo' })], expect.anything());

    for (const status of ['DELIVERED', 'CANCELLED', 'RETURNED']) {
      row.status = status;
      await expect(shipping.applyTrack(tracking, [event])).resolves.toMatchObject({ applied: 0, delivered: false });
    }
    expect(db.exec).toHaveBeenCalledTimes(1);
  });

  it('checks a live webhook against Shippo before applying its status', async () => {
    const { orders, shippo, shipping } = fixture();
    shippo.testMode = false;
    const event = { status: 'IN_TRANSIT', at: new Date().toISOString() };
    shippo.track.mockResolvedValue({ history: [event] });
    const apply = jest.spyOn(shipping, 'applyTrack').mockResolvedValue({ applied: 1, delivered: false, status: 'IN_TRANSIT' });
    await orders.ingestShippoTrack({ data: { carrier: 'ups', tracking_number: 'guide', tracking_status: { status: 'DELIVERED' } } });
    expect(shippo.track).toHaveBeenCalledWith('ups', 'guide');
    expect(apply).toHaveBeenCalledWith(expect.anything(), [event]);
  });
});
