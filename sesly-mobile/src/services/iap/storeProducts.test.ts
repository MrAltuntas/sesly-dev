/**
 * Store product ids: Google Play ids from PLANS, App Store ids with the
 * io.sesly. prefix (backend STORE_PRODUCTS), the order of the products and
 * the Google Play replacement mode of a plan change.
 */

import {
  allProductIds,
  isSeslyProduct,
  planChange,
  productIdFor,
  productRefFor,
  replacementModeFor,
} from './storeProducts';

describe('storeProducts', () => {
  it('names the products of each plan and period per platform', () => {
    expect(productIdFor('mini', 'monthly', 'android')).toBe('mini_monthly');
    expect(productIdFor('premium', 'monthly', 'android')).toBe('pro_monthly');
    expect(productIdFor('premium', 'yearly', 'android')).toBe('pro_yearly');
    expect(productIdFor('premium', 'yearly', 'ios')).toBe('io.sesly.pro_yearly');
    expect(productIdFor('mini', 'yearly', 'android')).toBeNull();
    expect(productIdFor('free', 'monthly', 'ios')).toBeNull();
  });

  it('lists every product smallest first, the backend product map exactly', () => {
    expect(allProductIds('android')).toEqual(['mini_monthly', 'pro_monthly', 'pro_yearly']);
    expect(allProductIds('ios')).toEqual(['io.sesly.mini_monthly', 'io.sesly.pro_monthly', 'io.sesly.pro_yearly']);
  });

  it('reads a product id of either platform back to its plan and period', () => {
    expect(productRefFor('pro_yearly')).toEqual({ plan: 'premium', period: 'yearly' });
    expect(productRefFor('io.sesly.mini_monthly')).toEqual({ plan: 'mini', period: 'monthly' });
    expect(productRefFor('premium_monthly')).toBeNull();
    expect(productRefFor(null)).toBeNull();
    expect(isSeslyProduct('io.sesly.pro_monthly')).toBe(true);
    expect(isSeslyProduct('coins')).toBe(false);
  });

  it('counts a move to a bigger product as an upgrade, a smaller one as a downgrade', () => {
    expect(planChange('mini_monthly', 'pro_monthly')).toBe('upgrade');
    expect(planChange('pro_monthly', 'pro_yearly')).toBe('upgrade');
    expect(planChange('pro_yearly', 'pro_monthly')).toBe('downgrade');
    expect(planChange('io.sesly.pro_yearly', 'io.sesly.mini_monthly')).toBe('downgrade');
    expect(planChange('pro_monthly', 'io.sesly.pro_monthly')).toBe('same');
    // An unknown old product: the new one counts as an upgrade.
    expect(planChange('legacy', 'mini_monthly')).toBe('upgrade');
  });

  it('upgrades now with time proration, downgrades at the renewal', () => {
    expect(replacementModeFor('upgrade')).toBe('with-time-proration');
    expect(replacementModeFor('same')).toBe('with-time-proration');
    expect(replacementModeFor('downgrade')).toBe('deferred');
  });
});
