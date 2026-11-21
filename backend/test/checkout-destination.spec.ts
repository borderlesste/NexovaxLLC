jest.mock('jose', () => ({ createRemoteJWKSet: () => ({}), jwtVerify: jest.fn() }));
import { CheckoutService } from '../src/checkout/checkout.service';

// Checkout validates restrictions with the confirmed address country (NX-GEO-001 §5).
describe('checkout destination check', () => {
  const blocks = (CheckoutService.prototype as any).destinationBlocks;
  const groups = [
    { sellerId: 's1', items: [{ productId: 'p1', purchasable: true }, { productId: 'p2', purchasable: true }] },
    { sellerId: 's2', items: [{ productId: 'p3', purchasable: true }, { productId: 'p4', purchasable: false }] },
  ];
  const availability = {
    forProducts: jest.fn(async (_c: string, ids: string[]) => ({
      items: Object.fromEntries(ids.map((id) => [id, id === 'p2' ? { status: 'UNAVAILABLE', reason: 'STORE_EXCLUDED' } : { status: id === 'p3' ? 'UNCONFIRMED' : 'AVAILABLE', reason: 'X' }])),
    })),
  };

  it('blocks only confirmed restrictions, per shipping group, for the address country', async () => {
    const r: Map<string, string> = await blocks.call({ availability }, groups, 'DO');
    expect([...r.entries()]).toEqual([['p2', 'STORE_EXCLUDED']]);
    expect(availability.forProducts).toHaveBeenCalledWith('DO', ['p1', 'p2', 'p3']);
  });

  it('without an address nothing is blocked yet', async () => {
    expect((await blocks.call({ availability }, groups, null)).size).toBe(0);
  });
});
