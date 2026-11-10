/**
 * SubscriptionScreen (design/v4/playful): three plan cards on their lips from
 * the typed constant, each head one radio with its limits and price in the
 * label, Premium's billing periods as radios of their own, the current plan
 * from `planId` (Mini is paid), and a dock that holds the primary button
 * alone, only for a plan above the current one.
 *
 * The button buys the selection through PurchaseStore (mocked here): it
 * waits for the store's products, shows the store's prices, offers a plan
 * change to a user with a store subscription from this platform, says what
 * the store is doing in one notice, and ends on a calm success state.
 * Restore shows while the store is connected, "Aboneliği yönet" while the
 * plan comes from a store. A plan CTA's `reason` param shows one line above
 * the cards.
 */

import React from 'react';
import { Animated, Platform, ScrollView } from 'react-native';
import { act, fireEvent, screen, userEvent, within } from '@testing-library/react-native';

import { renderWithProviders } from '../../test-utils/render-helpers';
import { mockNavigation, setMockRouteParams } from '../../test-utils/mocks/navigation';
import i18n from '../../i18n';
import { LIP, RADIUS, dockBottom, themes } from '../../theme/theme';
import { contrastRatio } from '../../theme/color';
import { PALETTE_KEYS, type PaletteKey } from '../../theme/palettes';
import { PLANS, PlanId, planLimitLines } from '../../models/Plans';
import {
  SubscriptionScreen,
  ctaKeyFor,
  decideCta,
  isUpgrade,
  purchaseNotice,
  pricePlaceholderFor,
  purchasePeriodFor,
  showsReferencePrices,
  titlePeriodFor,
} from './SubscriptionScreen';

jest.setTimeout(60000);

// The legal sheet fetches documents from the backend when opened; here it
// only has to show which document was asked for.
jest.mock('../../components/design/LegalSheet', () => {
  const { Text } = jest.requireActual('react-native');
  return {
    LegalSheet: ({ slug }: { slug: string | null }) =>
      slug ? <Text testID="legal-sheet-slug">{slug}</Text> : null,
  };
});

const mockStore: {
  planId: PlanId;
  hasStoreSubscription: boolean;
  source: 'APPLE' | 'GOOGLE' | 'ADMIN' | null;
  storeProductId: string | null;
} = {
  planId: 'free',
  hasStoreSubscription: false,
  source: null,
  storeProductId: null,
};
jest.mock('../../hooks/useSubscription', () => ({ useSubscription: () => mockStore }));

/** The purchase store as the screen reads it. */
const mockPurchases = {
  platform: 'android' as 'android' | 'ios' | null,
  billing: 'idle' as string,
  productsState: 'idle' as string,
  flow: 'idle' as string,
  restoring: false,
  canBuy: false,
  isBusy: false,
  prices: {} as Record<string, string>,
  storeCurrency: null as string | null,
  productFor: jest.fn((plan: string, period: string): { productId: string; displayPrice: string; offerToken: string } | null => {
    const price: string | undefined = mockPurchases.prices[`${plan}:${period}`];
    return price ? { productId: `${plan}:${period}`, displayPrice: price, offerToken: 'offer' } : null;
  }),
  buy: jest.fn(async (..._args: unknown[]) => undefined),
  restore: jest.fn(async () => undefined),
  retry: jest.fn(async () => undefined),
  loadProducts: jest.fn(async () => undefined),
  manageSubscriptions: jest.fn(async () => undefined),
  dismissOutcome: jest.fn(),
};
jest.mock('../../hooks/usePurchaseBridge', () => ({ usePurchases: () => mockPurchases }));

/** The store connected with every product loaded. */
function storeReady(prices: Record<string, string> = {}) {
  mockPurchases.billing = 'ready';
  mockPurchases.productsState = 'ready';
  mockPurchases.canBuy = true;
  mockPurchases.prices = prices;
}

const mockShowDialog = jest.fn();
jest.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ showDialog: mockShowDialog, hideDialog: jest.fn() }),
}));

async function renderScreen(theme: PaletteKey = 'gece-mavisi') {
  const utils = renderWithProviders(<SubscriptionScreen />, { theme });
  await act(async () => undefined);
  return utils;
}

const flatStyle = (node: { props: { style?: unknown } }) =>
  Object.assign({}, ...[node.props.style].flat(4).filter(Boolean));

/** Whether `node` sits inside the element with `testID`. */
function isInside(node: { parent: unknown }, testID: string): boolean {
  let current = node.parent as { props?: { testID?: string }; parent: unknown } | null;
  while (current) {
    if (current.props?.testID === testID) return true;
    current = current.parent as typeof current;
  }
  return false;
}

const originalOS = Platform.OS;

beforeEach(async () => {
  mockStore.planId = 'free';
  mockStore.hasStoreSubscription = false;
  mockStore.source = null;
  mockStore.storeProductId = null;
  Object.assign(mockPurchases, {
    platform: 'android',
    billing: 'idle',
    productsState: 'idle',
    flow: 'idle',
    restoring: false,
    canBuy: false,
    isBusy: false,
    prices: {},
    storeCurrency: null,
  });
  // A previous test's tree is unmounted after its afterEach cleared the mocks.
  mockPurchases.dismissOutcome.mockClear();
  mockShowDialog.mockReset();
  mockNavigation.goBack.mockClear();
  await i18n.changeLanguage('tr');
});

afterEach(() => {
  Platform.OS = originalOS;
});

describe('pure helpers', () => {
  it('names the primary button after the selection', () => {
    expect(ctaKeyFor('premium', 'yearly')).toBe('cta.premiumYearly');
    expect(ctaKeyFor('premium', 'monthly')).toBe('cta.premiumMonthly');
    expect(ctaKeyFor('mini', 'yearly')).toBe('cta.mini');
    expect(ctaKeyFor('mini', 'monthly')).toBe('cta.mini');
  });

  it('prices the title row with the selected period, or the one a plan sells', () => {
    expect(titlePeriodFor(PLANS.premium, 'yearly')).toBe('yearly');
    expect(titlePeriodFor(PLANS.premium, 'monthly')).toBe('monthly');
    // Mini sells one period whatever is selected; the free plan has no price.
    expect(titlePeriodFor(PLANS.mini, 'yearly')).toBe('monthly');
    expect(titlePeriodFor(PLANS.free, 'monthly')).toBeNull();
    const yearlyOnly = { ...PLANS.premium, prices: { monthly: null, yearly: 99 } };
    expect(titlePeriodFor(yearlyOnly, 'monthly')).toBe('yearly');
  });

  it('offers only plans above the current one', () => {
    expect(isUpgrade('mini', 'free')).toBe(true);
    expect(isUpgrade('premium', 'free')).toBe(true);
    expect(isUpgrade('premium', 'mini')).toBe(true);
    expect(isUpgrade('mini', 'mini')).toBe(false);
    expect(isUpgrade('mini', 'premium')).toBe(false);
    expect(isUpgrade('premium', 'premium')).toBe(false);
  });

  it('buys Mini monthly whatever period Premium keeps', () => {
    expect(purchasePeriodFor('mini', 'yearly')).toBe('monthly');
    expect(purchasePeriodFor('premium', 'yearly')).toBe('yearly');
    expect(purchasePeriodFor('premium', 'monthly')).toBe('monthly');
  });

  it('decides the button from the plan, or from the store product of a store subscription', () => {
    const base = { platform: 'android' as const, storeSource: null, storeProductId: null };
    expect(decideCta({ ...base, selected: 'premium', period: 'yearly', currentPlan: 'free' })).toEqual({
      show: true,
      change: null,
    });
    // An admin grant counts as the plan: nothing below or equal to it.
    expect(decideCta({ ...base, selected: 'mini', period: 'monthly', currentPlan: 'premium' }).show).toBe(false);

    const google = { platform: 'android' as const, storeSource: 'GOOGLE' as const, currentPlan: 'premium' as const };
    expect(decideCta({ ...google, storeProductId: 'pro_monthly', selected: 'premium', period: 'yearly' })).toEqual({
      show: true,
      change: 'upgrade',
    });
    expect(decideCta({ ...google, storeProductId: 'pro_monthly', selected: 'premium', period: 'monthly' })).toEqual({
      show: false,
      change: null,
    });
    expect(decideCta({ ...google, storeProductId: 'pro_yearly', selected: 'mini', period: 'yearly' })).toEqual({
      show: true,
      change: 'downgrade',
    });
    // The other store's subscription is changed there.
    expect(
      decideCta({ ...google, platform: 'ios', storeProductId: 'pro_monthly', selected: 'premium', period: 'yearly' }),
    ).toEqual({ show: false, change: null });
    // iOS: the App Store ids.
    expect(
      decideCta({
        platform: 'ios',
        storeSource: 'APPLE',
        currentPlan: 'mini',
        storeProductId: 'io.sesly.mini_monthly',
        selected: 'premium',
        period: 'monthly',
      }),
    ).toEqual({ show: true, change: 'upgrade' });
    // An unknown store product falls back to the plan order.
    expect(decideCta({ ...google, storeProductId: 'old_product', selected: 'premium', period: 'yearly' })).toEqual({
      show: false,
      change: null,
    });
  });

  it('picks the one notice by importance', () => {
    const base = {
      flow: 'idle',
      billing: 'ready',
      productsState: 'ready',
      platform: 'android' as const,
      otherStore: null,
      downgrade: false,
    };
    expect(purchaseNotice(base)).toBeNull();
    expect(purchaseNotice({ ...base, flow: 'pending', billing: 'unavailable' })?.kind).toBe('pending');
    expect(purchaseNotice({ ...base, flow: 'deferred' })?.kind).toBe('deferred');
    expect(purchaseNotice({ ...base, otherStore: 'App Store', downgrade: true })).toMatchObject({
      kind: 'otherStore',
      params: { store: 'App Store' },
    });
    expect(purchaseNotice({ ...base, billing: 'unavailable' })).toMatchObject({
      kind: 'unavailable',
      messageKey: 'status.unavailableAndroid',
      retry: true,
    });
    expect(purchaseNotice({ ...base, billing: 'unavailable', platform: 'ios' })?.messageKey).toBe(
      'status.unavailableIos',
    );
    expect(purchaseNotice({ ...base, productsState: 'error' })?.kind).toBe('products');
    expect(purchaseNotice({ ...base, productsState: 'empty' })?.retry).toBe(true);
    expect(purchaseNotice({ ...base, productsState: 'loading' })).toBeNull();
    expect(purchaseNotice({ ...base, downgrade: true })?.kind).toBe('downgrade');
  });

  it('writes the limit lines of each plan from models/Plans', () => {
    const t = i18n.getFixedT('tr', 'plans');
    expect(planLimitLines(PLANS.free, t)).toEqual([
      'Hazır anlatıcılarla ayda 20 masal',
      'Kendi sesinle toplam 1 masal',
      'Ekran kapanınca masal durur',
    ]);
    expect(planLimitLines(PLANS.mini, t)).toEqual([
      'Hazır anlatıcılarla sınırsız masal',
      'Kendi sesinle ayda 5 masal',
      'Ekran kapalıyken dinleme',
      'Premium masallar',
    ]);
    const en = i18n.getFixedT('en', 'plans');
    expect(planLimitLines(PLANS.free, en)[1]).toBe('Own voice: 1 story in total');
    expect(planLimitLines(PLANS.premium, en)[1]).toBe('Own voice: 20 stories a month');
  });
});

describe('SubscriptionScreen', () => {
  it('puts the title in the app bar row and draws the three plans', async () => {
    await renderScreen();

    const title = screen.getByRole('header', { name: 'Planını seç' });
    // Not inside the scroll: the title shares the row with the close button.
    expect(isInside(title, 'plans-scroll')).toBe(false);

    const free = within(screen.getByTestId('plan-free-face'));
    expect(free.getByText('Ücretsiz')).toBeOnTheScreen();
    expect(free.getByText('Şu anki planın')).toBeOnTheScreen();
    expect(free.getByText('Hazır anlatıcılarla ayda 20 masal')).toBeOnTheScreen();
    expect(free.getByText('Kendi sesinle toplam 1 masal')).toBeOnTheScreen();
    expect(free.getByText('Ekran kapanınca masal durur')).toBeOnTheScreen();

    const mini = within(screen.getByTestId('plan-mini-face'));
    expect(mini.getByText('Mini')).toBeOnTheScreen();
    expect(mini.getByText(/49,99 TL/)).toBeOnTheScreen();
    expect(mini.getByText('Kendi sesinle ayda 5 masal')).toBeOnTheScreen();
    expect(mini.getByText('Ekran kapalıyken dinleme')).toBeOnTheScreen();
    expect(mini.getByText('Premium masallar')).toBeOnTheScreen();
    expect(mini.queryByText('Şu anki planın')).toBeNull();

    const premium = within(screen.getByTestId('plan-premium-face'));
    expect(premium.getByText('Premium')).toBeOnTheScreen();
    expect(premium.getByText('Kendi sesinle ayda 20 masal')).toBeOnTheScreen();
    expect(within(screen.getByTestId('plan-premium-monthly')).getByText('199,99 TL / ay')).toBeOnTheScreen();
    expect(within(screen.getByTestId('plan-premium-yearly')).getByText('1.499,99 TL / yıl')).toBeOnTheScreen();
  });

  it('every paid card prices its title row, Premium with the selected period as billed', async () => {
    await renderScreen();
    expect(screen.queryByTestId('plan-free-price')).toBeNull();
    expect(screen.getByTestId('plan-mini-price')).toHaveTextContent('49,99 TL / ay');
    // Premium yearly is selected: the yearly price as it is, no per-month figure.
    expect(screen.getByTestId('plan-premium-price')).toHaveTextContent('1.499,99 TL / yıl');
    fireEvent.press(screen.getByTestId('plan-premium-monthly'));
    expect(screen.getByTestId('plan-premium-price')).toHaveTextContent('199,99 TL / ay');
    expect(screen.getByRole('radio', { name: /^Premium planı/ }).props.accessibilityLabel).toMatch(
      /, 199,99 TL \/ ay$/,
    );
    // Picking Mini keeps Premium's last period on its title row.
    fireEvent.press(screen.getByTestId('plan-mini'));
    expect(screen.getByTestId('plan-premium-price')).toHaveTextContent('199,99 TL / ay');
  });

  it('has no badge, struck-through price, countdown or per-month equivalent', async () => {
    await renderScreen();
    expect(screen.queryByText(/popüler|yaygın|indirim|%/i)).toBeNull();
    // 1499.99 / 12
    expect(screen.queryByText(/124|125/)).toBeNull();
    const struck = screen
      .getAllByText(/./)
      .filter(node => flatStyle(node).textDecorationLine === 'line-through');
    expect(struck).toHaveLength(0);
  });

  it('each plan head is one radio whose label holds the limits and the price', async () => {
    await renderScreen();

    const mini = screen.getByRole('radio', { name: /^Mini planı/ });
    expect(mini.props.testID).toBe('plan-mini');
    expect(mini.props.accessibilityLabel).toContain('Kendi sesinle ayda 5 masal');
    expect(mini.props.accessibilityLabel).toContain('49,99 TL / ay');
    expect(mini).not.toBeSelected();

    const premium = screen.getByRole('radio', { name: /^Premium planı/ });
    expect(premium).toBeSelected();
    expect(premium.props.accessibilityLabel).toBe(
      'Premium planı, Hazır anlatıcılarla sınırsız masal, Kendi sesinle ayda 20 masal, Ekran kapalıyken dinleme, Premium masallar, 1.499,99 TL / yıl',
    );

    // The free card is not a choice; its label still says what it includes.
    const free = screen.getByTestId('plan-free');
    expect(free.props.accessibilityRole).toBeUndefined();
    expect(free.props.accessibilityLabel).toContain('Ücretsiz planı, şu anki planın');
    expect(free.props.accessibilityLabel).toContain('Hazır anlatıcılarla ayda 20 masal');
  });

  it('the period chips are radios of their own, outside the plan head', async () => {
    await renderScreen();
    const yearly = screen.getByRole('radio', { name: /Yıllık, 1.499,99 TL/ });
    const monthly = screen.getByRole('radio', { name: /Aylık, 199,99 TL/ });
    expect(isInside(yearly, 'plan-premium')).toBe(false);
    expect(isInside(monthly, 'plan-premium')).toBe(false);
    // Still on the Premium card.
    expect(isInside(yearly, 'plan-premium-face')).toBe(true);
    expect(yearly).toBeSelected();
    expect(monthly).not.toBeSelected();
  });

  it('starts on Premium yearly and follows the selection', async () => {
    await renderScreen();
    expect(screen.getByTestId('plan-premium')).toBeSelected();
    expect(screen.getByTestId('plan-premium-yearly')).toBeSelected();

    fireEvent.press(screen.getByTestId('plan-premium-monthly'));
    expect(screen.getByTestId('plan-premium-monthly')).toBeSelected();
    expect(screen.getByTestId('plan-premium-yearly')).not.toBeSelected();

    fireEvent.press(screen.getByTestId('plan-mini'));
    expect(screen.getByTestId('plan-mini')).toBeSelected();
    expect(screen.getByTestId('plan-premium')).not.toBeSelected();
    // Premium keeps its period: still the value of its own group.
    expect(screen.getByTestId('plan-premium-monthly')).toBeSelected();
    expect(screen.getByTestId('plan-premium-yearly')).not.toBeSelected();

    // Picking a billing period inside the Premium card selects Premium too.
    fireEvent.press(screen.getByTestId('plan-premium-yearly'));
    expect(screen.getByTestId('plan-premium')).toBeSelected();
    expect(screen.getByTestId('plan-mini')).not.toBeSelected();
  });

  it("with another plan selected, Premium's remembered period stays marked in a quiet ring", async () => {
    await renderScreen();
    const T = themes['gece-mavisi'];
    const chip = (billing: 'monthly' | 'yearly') => flatStyle(screen.getByTestId(`plan-premium-${billing}-face`));

    // Premium yearly picked: the action face, its ring in the face colour.
    expect(chip('yearly')).toMatchObject({ backgroundColor: T.action, borderColor: T.action, borderWidth: 2 });
    expect(chip('monthly')).toMatchObject({ backgroundColor: T.line, borderColor: 'transparent', borderWidth: 2 });

    fireEvent.press(screen.getByTestId('plan-mini'));
    // Mini is the selection; Premium's title row still prices the yearly
    // period, and that chip says so: the idle face with a text2 ring.
    expect(screen.getByTestId('plan-premium-price')).toHaveTextContent('1.499,99 TL / yıl');
    expect(chip('yearly')).toMatchObject({ backgroundColor: T.line, borderColor: T.text2, borderWidth: 2 });
    expect(chip('monthly')).toMatchObject({ backgroundColor: T.line, borderColor: 'transparent', borderWidth: 2 });
    expect(flatStyle(screen.getByTestId('plan-premium-yearly-lip')).backgroundColor).toBe(T.lineLip);
    expect(flatStyle(screen.getByText('Yıllık')).color).toBe(T.text);
    // The radios: Mini is the plan, yearly stays the value of Premium's period group.
    expect(screen.getByRole('radio', { name: /^Mini planı/ })).toBeSelected();
    expect(screen.getByRole('radio', { name: /^Premium planı/ })).not.toBeSelected();
    expect(screen.getByRole('radio', { name: /Yıllık, 1.499,99 TL/ })).toBeSelected();
    expect(screen.getByRole('radio', { name: /Aylık, 199,99 TL/ })).not.toBeSelected();

    // Monthly picked, then Mini again: the ring follows the remembered period.
    fireEvent.press(screen.getByTestId('plan-premium-monthly'));
    expect(chip('monthly')).toMatchObject({ backgroundColor: T.action, borderColor: T.action });
    expect(chip('yearly').borderColor).toBe('transparent');
    fireEvent.press(screen.getByTestId('plan-mini'));
    expect(screen.getByTestId('plan-premium-price')).toHaveTextContent('199,99 TL / ay');
    expect(chip('monthly')).toMatchObject({ backgroundColor: T.line, borderColor: T.text2 });
    expect(chip('yearly').borderColor).toBe('transparent');
    expect(screen.getByTestId('plan-premium-monthly')).toBeSelected();
  });

  it.each(PALETTE_KEYS)('in %s the remembered period ring stands out from its chip and its card', async scheme => {
    await renderScreen(scheme);
    fireEvent.press(screen.getByTestId('plan-mini'));
    const ring = flatStyle(screen.getByTestId('plan-premium-yearly-face')).borderColor as string;
    const face = flatStyle(screen.getByTestId('plan-premium-yearly-face')).backgroundColor as string;
    const card = flatStyle(screen.getByTestId('plan-premium-face')).backgroundColor as string;
    expect(ring).toBe(themes[scheme].text2);
    // A state mark: at least 3:1 on the chip face and on the card around it.
    expect(contrastRatio(ring, face)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ring, card)).toBeGreaterThanOrEqual(3);
  });

  it('until the store has the products the button names the selection but waits', async () => {
    await renderScreen();
    const cta = screen.getByTestId('plans-cta');
    expect(cta).toBeDisabled();
    expect(screen.getByRole('button', { name: "Yıllık Premium'a geç" })).toBe(cta);

    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await user.press(cta);
    expect(mockShowDialog).not.toHaveBeenCalled();
    expect(mockPurchases.buy).not.toHaveBeenCalled();
  });

  it('keeps restore while the store is not connected (App Review looks for it)', async () => {
    await renderScreen();
    expect(screen.getByTestId('plans-restore')).toBeOnTheScreen();
    fireEvent.press(screen.getByText('Satın alımları geri yükle'));
    expect(mockPurchases.restore).toHaveBeenCalledTimes(1);
  });

  it('the dock holds the button alone; restore and the legal text end the scroll', async () => {
    storeReady();
    const view = await renderScreen();

    const dock = screen.getByTestId('plans-dock');
    expect(within(dock).getAllByRole('button')).toHaveLength(1);
    expect(within(dock).getByTestId('plans-cta')).toBeOnTheScreen();
    expect(flatStyle(dock)).toMatchObject({ paddingTop: 8, paddingBottom: dockBottom(0) });

    const scroll = view.UNSAFE_getByType(ScrollView);
    expect(within(scroll).getByTestId('plans-restore')).toBeOnTheScreen();
    expect(within(scroll).getByTestId('plans-legal')).toBeOnTheScreen();
    expect(within(dock).queryByTestId('plans-legal')).toBeNull();

    // The primary button is the lg one of the screen.
    expect(flatStyle(screen.getByTestId('plans-cta-face')).minHeight).toBe(52);
  });

  it('with the products in, the button buys the selection and restore restores', async () => {
    storeReady();
    await renderScreen();
    expect(screen.getByRole('button', { name: "Yıllık Premium'a geç" })).toBeEnabled();
    fireEvent.press(screen.getByTestId('plans-cta'));
    expect(mockPurchases.buy).toHaveBeenCalledWith('premium', 'yearly');

    fireEvent.press(screen.getByTestId('plan-premium-monthly'));
    fireEvent.press(screen.getByTestId('plans-cta'));
    expect(mockPurchases.buy).toHaveBeenLastCalledWith('premium', 'monthly');

    // Mini sells monthly only, whatever period Premium keeps.
    fireEvent.press(screen.getByTestId('plan-premium-yearly'));
    fireEvent.press(screen.getByTestId('plan-mini'));
    expect(screen.getByRole('button', { name: "Mini'ye geç" })).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('plans-cta'));
    expect(mockPurchases.buy).toHaveBeenLastCalledWith('mini', 'monthly');

    fireEvent.press(screen.getByTestId('plans-restore'));
    expect(mockPurchases.restore).toHaveBeenCalledTimes(1);
    expect(mockShowDialog).not.toHaveBeenCalled();
    // Not a store subscription: nothing to manage.
    expect(screen.queryByTestId('plans-manage')).toBeNull();
  });

  it("shows the store's localised prices once the products are in", async () => {
    storeReady({ 'mini:monthly': '₺54,99', 'premium:monthly': '₺219,99', 'premium:yearly': '₺1.599,99' });
    await renderScreen();
    expect(screen.getByTestId('plan-mini-price')).toHaveTextContent('₺54,99 / ay');
    expect(screen.getByTestId('plan-premium-price')).toHaveTextContent('₺1.599,99 / yıl');
    expect(within(screen.getByTestId('plan-premium-monthly')).getByText('₺219,99 / ay')).toBeOnTheScreen();
    expect(screen.getByTestId('plan-premium').props.accessibilityLabel).toContain('₺1.599,99 / yıl');
  });

  it('a busy purchase keeps the button loading and restore waits', async () => {
    storeReady();
    mockPurchases.flow = 'verifying';
    mockPurchases.isBusy = true;
    await renderScreen();
    expect(screen.getByTestId('plans-cta')).toBeDisabled();
    expect(screen.getByTestId('plans-restore')).toBeDisabled();
  });

  it.each([
    ['pending', 'Ödemen onay bekliyor', 'Ödeme onaylanınca planın kendiliğinden açılır. Bu ekranı kapatabilirsin.'],
    [
      'deferred',
      'Satın alımın alındı',
      'Doğrulama şu an yapılamıyor. Bağlantı düzelince kendiliğinden tamamlanacak, yeniden ödeme yapma.',
    ],
  ])('a %s purchase says so above the cards and the button waits', async (flow, title, message) => {
    storeReady();
    mockPurchases.flow = flow;
    await renderScreen();
    const notice = screen.getByTestId(`plans-notice-${flow}`);
    expect(within(notice).getByText(title)).toBeOnTheScreen();
    expect(within(notice).getByText(message)).toBeOnTheScreen();
    expect(within(notice).queryByTestId('plans-notice-retry')).toBeNull();
    expect(screen.getByTestId('plans-cta')).toBeDisabled();
  });

  it('without a store on this phone it says why and offers a retry', async () => {
    mockPurchases.billing = 'unavailable';
    await renderScreen();
    const notice = screen.getByTestId('plans-notice-unavailable');
    expect(within(notice).getByText('Satın alma şu an kullanılamıyor')).toBeOnTheScreen();
    expect(within(notice).getByText(/Google Play'den yüklenmiş/)).toBeOnTheScreen();
    expect(screen.getByTestId('plans-cta')).toBeDisabled();
    expect(screen.getByTestId('plans-restore')).toBeOnTheScreen();
    fireEvent.press(screen.getByTestId('plans-notice-retry'));
    expect(mockPurchases.retry).toHaveBeenCalledTimes(1);
  });

  it('products that did not load are asked for again on open and offer a retry', async () => {
    mockPurchases.billing = 'ready';
    mockPurchases.productsState = 'empty';
    await renderScreen();
    expect(mockPurchases.loadProducts).toHaveBeenCalledTimes(1);
    const notice = screen.getByTestId('plans-notice-products');
    expect(within(notice).getByText('Planlar şu an yüklenemedi')).toBeOnTheScreen();
    // The reference prices stay readable.
    expect(screen.getByTestId('plan-mini-price')).toHaveTextContent('49,99 TL / ay');
    expect(screen.getByTestId('plans-cta')).toBeDisabled();
    fireEvent.press(screen.getByTestId('plans-notice-retry'));
    expect(mockPurchases.retry).toHaveBeenCalledTimes(1);
  });

  describe('with a store subscription', () => {
    beforeEach(() => {
      storeReady();
      mockStore.planId = 'premium';
      mockStore.hasStoreSubscription = true;
      mockStore.source = 'GOOGLE';
      mockStore.storeProductId = 'pro_monthly';
    });

    it('offers every other product as a plan change, and manage', async () => {
      await renderScreen();
      // Premium yearly is selected: an upgrade of Premium monthly.
      expect(screen.getByRole('button', { name: "Yıllık Premium'a geç" })).toBeEnabled();
      expect(screen.queryByTestId('plans-notice-downgrade')).toBeNull();
      fireEvent.press(screen.getByTestId('plans-cta'));
      expect(mockPurchases.buy).toHaveBeenCalledWith('premium', 'yearly');

      // The product the user has: nothing to buy.
      fireEvent.press(screen.getByTestId('plan-premium-monthly'));
      expect(screen.queryByTestId('plans-cta')).toBeNull();

      // Mini is a downgrade: it starts at the renewal, and the notice says so.
      fireEvent.press(screen.getByTestId('plan-mini'));
      expect(screen.getByRole('button', { name: "Mini'ye geç" })).toBeOnTheScreen();
      expect(
        within(screen.getByTestId('plans-notice-downgrade')).getByText(
          'Yeni planın, şu anki dönemin bitince başlar. O zamana kadar şu anki planın sürer.',
        ),
      ).toBeOnTheScreen();

      fireEvent.press(screen.getByTestId('plans-manage'));
      expect(mockPurchases.manageSubscriptions).toHaveBeenCalledTimes(1);
      expect(screen.getByText('Aboneliği yönet')).toBeOnTheScreen();
    });

    it('a subscription from the other store is changed there', async () => {
      mockStore.source = 'APPLE';
      mockStore.storeProductId = 'io.sesly.pro_monthly';
      await renderScreen();
      expect(
        within(screen.getByTestId('plans-notice-otherStore')).getByText(
          'Aboneliğin App Store üzerinden alındı. Planını orada değiştirebilirsin.',
        ),
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('plans-cta')).toBeNull();
      fireEvent.press(screen.getByTestId('plan-mini'));
      expect(screen.queryByTestId('plans-cta')).toBeNull();
    });
  });

  it('ends on a calm success state; Tamam closes the plans', async () => {
    storeReady();
    await renderScreen();
    // The store answers at once here: the backend granted Premium.
    mockPurchases.buy.mockImplementationOnce(async () => {
      mockPurchases.flow = 'success';
      mockStore.planId = 'premium';
    });
    fireEvent.press(screen.getByTestId('plans-cta'));
    expect(mockPurchases.buy).toHaveBeenCalledWith('premium', 'yearly');

    const success = screen.getByTestId('plans-success');
    expect(within(success).getByText('Premium planın açıldı')).toBeOnTheScreen();
    expect(within(success).getByText('Keyifli dinlemeler. Planını ve haklarını profilinde görebilirsin.')).toBeOnTheScreen();
    // No plan cards, restore or manage behind it.
    expect(screen.queryByTestId('plan-free')).toBeNull();
    expect(screen.queryByTestId('plans-restore')).toBeNull();

    const done = screen.getByRole('button', { name: 'Tamam' });
    expect(done).toBeEnabled();
    fireEvent.press(done);
    expect(mockPurchases.dismissOutcome).toHaveBeenCalled();
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('a downgrade that waits for the renewal says when the new plan starts', async () => {
    storeReady();
    mockStore.planId = 'premium';
    mockStore.hasStoreSubscription = true;
    mockStore.source = 'GOOGLE';
    mockStore.storeProductId = 'pro_yearly';
    await renderScreen();
    fireEvent.press(screen.getByTestId('plan-mini'));
    mockPurchases.buy.mockImplementationOnce(async () => {
      mockPurchases.flow = 'success';
    });
    fireEvent.press(screen.getByTestId('plans-cta'));
    expect(mockPurchases.buy).toHaveBeenCalledWith('mini', 'monthly');

    expect(screen.getByText('Plan değişikliğin kaydedildi')).toBeOnTheScreen();
    expect(
      screen.getByText('Mini planın, şu anki dönemin bitince başlar. O zamana kadar şu anki planın sürer.'),
    ).toBeOnTheScreen();
  });

  it('leaving the plans after a success forgets it; any other state stays', async () => {
    const first = await renderScreen();
    first.unmount();
    expect(mockPurchases.dismissOutcome).not.toHaveBeenCalled();

    mockPurchases.flow = 'success';
    const second = await renderScreen();
    second.unmount();
    expect(mockPurchases.dismissOutcome).toHaveBeenCalled();
  });

  it('a Mini user sees Mini as the current plan and is offered only Premium', async () => {
    mockStore.planId = 'mini';
    await renderScreen();

    expect(within(screen.getByTestId('plan-mini-face')).getByText('Şu anki planın')).toBeOnTheScreen();
    expect(within(screen.getByTestId('plan-free-face')).queryByText('Şu anki planın')).toBeNull();
    expect(screen.getByTestId('plan-mini').props.accessibilityLabel).toMatch(/^Mini planı, şu anki planın/);

    // Premium is selected by default: an upgrade, so the button is there.
    expect(screen.getByTestId('plans-cta')).toBeOnTheScreen();
    // Mini itself is the current plan: no button.
    fireEvent.press(screen.getByTestId('plan-mini'));
    expect(screen.queryByTestId('plans-cta')).toBeNull();
    expect(screen.queryByTestId('plans-dock')).toBeNull();
  });

  it.each(['free', 'mini', 'premium'] as const)(
    'the current-plan tag of %s has its own line under the name, so the name is never squeezed',
    async plan => {
      mockStore.planId = plan;
      await renderScreen();
      const tag = screen.getByTestId(`plan-${plan}-current`);
      const name = screen.getByTestId(`plan-${plan}-name`);
      // Not on the title row: only the radio, the name and the price share it.
      const row = screen.getByTestId(`plan-${plan}-current-row`);
      expect(isInside(tag, `plan-${plan}-current-row`)).toBe(true);
      expect(within(row).queryByTestId(`plan-${plan}-name`)).toBeNull();
      expect(within(row).queryByTestId(`plan-${plan}-price`)).toBeNull();
      // The name takes the room left by the radio and the price on one line.
      expect(name.props.numberOfLines).toBe(1);
      expect(flatStyle(name)).toMatchObject({ flex: 1, minWidth: 0 });
      if (plan !== 'free') expect(flatStyle(screen.getByTestId(`plan-${plan}-price`)).flexShrink).toBe(0);
      // It starts where the name starts: past the radio column on a selectable card.
      expect(flatStyle(row).marginTop).toBe(4);
      expect(flatStyle(row).marginLeft).toBe(plan === 'free' ? undefined : 24 + 12);
      // The other cards carry no tag.
      (['free', 'mini', 'premium'] as const)
        .filter(other => other !== plan)
        .forEach(other => expect(screen.queryByTestId(`plan-${other}-current`)).toBeNull());
    },
  );

  it('a Premium user is offered nothing', async () => {
    mockStore.planId = 'premium';
    await renderScreen();
    expect(within(screen.getByTestId('plan-premium-face')).getByText('Şu anki planın')).toBeOnTheScreen();
    expect(screen.queryByTestId('plans-cta')).toBeNull();
    fireEvent.press(screen.getByTestId('plan-mini'));
    expect(screen.queryByTestId('plans-cta')).toBeNull();
  });

  it('without the dock the scroll keeps clear of the system bar; with it the dock does', async () => {
    const SafeArea = jest.requireMock<typeof import('react-native-safe-area-context')>(
      'react-native-safe-area-context',
    );
    const insets = jest
      .spyOn(SafeArea, 'useSafeAreaInsets')
      .mockReturnValue({ top: 24, right: 0, bottom: 48, left: 0 });
    try {
      mockStore.planId = 'premium';
      const first = await renderScreen();
      expect(screen.queryByTestId('plans-dock')).toBeNull();
      expect(flatStyle({ props: { style: first.UNSAFE_getByType(ScrollView).props.contentContainerStyle } })
        .paddingBottom).toBe(48 + 24);
      first.unmount();

      mockStore.planId = 'free';
      const second = await renderScreen();
      expect(flatStyle(screen.getByTestId('plans-dock')).paddingBottom).toBe(dockBottom(48));
      expect(flatStyle({ props: { style: second.UNSAFE_getByType(ScrollView).props.contentContainerStyle } })
        .paddingBottom).toBe(24);
    } finally {
      insets.mockRestore();
    }
  });

  it('marks what the free plan does not do with a minus, never the success tick', async () => {
    await renderScreen();
    const free = within(screen.getByTestId('plan-free-face'));
    // Two allowances with a tick, the screen-off limitation with a minus.
    expect(free.getAllByTestId('plan-free-mark-check')).toHaveLength(2);
    const minus = free.getByTestId('plan-free-mark-minus');
    expect(within(minus).getByTestId('icon-minus', { includeHiddenElements: true })).toBeOnTheScreen();
    expect(flatStyle(minus).backgroundColor).toBe(themes['gece-mavisi'].surface2);
    expect(free.getByText('Ekran kapanınca masal durur')).toBeOnTheScreen();
    // The paid plans list perks only.
    for (const id of ['mini', 'premium']) {
      expect(screen.queryByTestId(`plan-${id}-mark-minus`)).toBeNull();
      expect(screen.getAllByTestId(`plan-${id}-mark-check`)).toHaveLength(4);
    }
  });

  it('names Google Play on Android and the App Store on iOS', async () => {
    Platform.OS = 'android';
    const first = await renderScreen();
    expect(screen.getByText(/Google Play'den istediğin zaman iptal edebilirsin\./)).toBeOnTheScreen();
    expect(screen.queryByText(/App Store/)).toBeNull();
    first.unmount();

    Platform.OS = 'ios';
    await renderScreen();
    expect(screen.getByText(/App Store'dan istediğin zaman iptal edebilirsin\./)).toBeOnTheScreen();
    expect(screen.queryByText(/Google Play/)).toBeNull();
  });

  it('opens the terms and the privacy policy in the legal sheet', async () => {
    await renderScreen();
    expect(screen.queryByTestId('legal-sheet-slug')).toBeNull();

    fireEvent.press(screen.getByText('Kullanım Şartları'));
    expect(screen.getByTestId('legal-sheet-slug')).toHaveTextContent('tos');

    fireEvent.press(screen.getByText('Gizlilik Politikası'));
    expect(screen.getByTestId('legal-sheet-slug')).toHaveTextContent('privacy');
  });

  it('closes with the X in the app bar', async () => {
    await renderScreen();
    fireEvent.press(screen.getByRole('button', { name: 'Kapat' }));
    expect(mockNavigation.goBack).toHaveBeenCalledTimes(1);
  });

  it('lines the limit checks up under the radio and the text under the name', async () => {
    await renderScreen();
    // The radio and each check's slot are the same width, with the same gap.
    expect(flatStyle(screen.getByTestId('plan-mini-radio')).width).toBe(24);
    const slot = screen.getByText('Kendi sesinle ayda 5 masal').parent?.parent as unknown as {
      props: { style?: unknown };
    };
    expect(flatStyle(slot).gap).toBe(12);
    // Every card carries the 2dp ring, so the free card lines up with the others.
    for (const id of ['free', 'mini', 'premium']) {
      expect(flatStyle(screen.getByTestId(`plan-${id}-face`)).borderWidth).toBe(2);
    }
  });

  it('a press on a plan head sinks the whole card by its lip', async () => {
    const timing = jest.spyOn(Animated, 'timing').mockImplementation(((
      value: Animated.Value,
      config: { toValue: number },
    ) => ({
      start: () => value.setValue(config.toValue),
      stop: () => undefined,
      reset: () => undefined,
    })) as unknown as typeof Animated.timing);
    await renderScreen();
    const head = screen.getByTestId('plan-mini');
    const face = () => flatStyle(screen.getByTestId('plan-mini-face'));
    fireEvent(head, 'pressIn');
    expect(face().transform).toEqual([{ translateY: LIP.md }]);
    fireEvent(head, 'pressOut');
    expect(face().transform).toEqual([{ translateY: 0 }]);
    timing.mockRestore();
  });

  it.each(PALETTE_KEYS)('in %s every face stands out from what it sits on', async scheme => {
    await renderScreen(scheme);
    const T = themes[scheme];
    const bg = (testID: string) => flatStyle(screen.getByTestId(testID)).backgroundColor as string;
    const apart = (face: string, container: string) => {
      expect(face).not.toBe(container);
      expect(contrastRatio(face, container)).toBeGreaterThan(1.05);
    };
    // Cards on the canvas, the selected card raised above the others.
    apart(bg('plan-mini-face'), T.bg);
    apart(bg('plan-premium-face'), T.bg);
    apart(bg('plan-premium-face'), bg('plan-mini-face'));
    // The idle radio and the idle period chip on their cards.
    apart(bg('plan-mini-radio'), bg('plan-mini-face'));
    apart(bg('plan-premium-monthly-face'), bg('plan-premium-face'));
    apart(bg('plan-premium-yearly-face'), bg('plan-premium-face'));
    // The free plan's minus on its card.
    apart(bg('plan-free-mark-minus'), bg('plan-free-face'));
  });

  it.each(['gece-mavisi', 'kitaplik'] as const)('takes its colours from the %s theme', async scheme => {
    await renderScreen(scheme);
    const T = themes[scheme];

    expect(flatStyle(screen.getByText('Planını seç'))).toMatchObject({
      color: T.text,
      fontFamily: T.fontDisplay,
      fontSize: 21,
    });
    // The selected card is raised with the action ring on the action lip,
    // the others plain surface cards on the neutral lip. No hairlines.
    expect(flatStyle(screen.getByTestId('plan-premium-face'))).toMatchObject({
      backgroundColor: T.surface2,
      borderColor: T.action,
      borderRadius: RADIUS.xl,
    });
    expect(flatStyle(screen.getByTestId('plan-premium-lip')).backgroundColor).toBe(T.actionLip);
    expect(flatStyle(screen.getByTestId('plan-mini-face'))).toMatchObject({
      backgroundColor: T.surface,
      borderWidth: 2,
      borderColor: 'transparent',
    });
    expect(flatStyle(screen.getByTestId('plan-mini-lip')).backgroundColor).toBe(T.lip);
    expect(flatStyle(screen.getByTestId('plan-free-face')).backgroundColor).toBe(T.surface);
    expect(flatStyle(screen.getByTestId('plan-premium-radio')).backgroundColor).toBe(T.action);
    expect(flatStyle(screen.getByTestId('plan-mini-radio')).backgroundColor).toBe(T.line);
    // The picked billing period is a card in the action colour with dark
    // text, on a 3dp lip with 20dp corners.
    expect(flatStyle(screen.getByTestId('plan-premium-yearly-face'))).toMatchObject({
      backgroundColor: T.action,
      borderRadius: RADIUS.lg,
      paddingVertical: 6,
    });
    expect(flatStyle(screen.getByTestId('plan-premium-yearly-lip')).top).toBe(LIP.md);
    expect(flatStyle(screen.getByTestId('plan-premium-monthly-face')).backgroundColor).toBe(T.line);
    expect(flatStyle(screen.getByText('Yıllık')).color).toBe(T.onAction);
    expect(flatStyle(screen.getByText('Aylık')).color).toBe(T.text);
    // The current plan wears the "Hazır" tint.
    expect(flatStyle(screen.getByTestId('plan-free-current')).backgroundColor).toBe(T.chipOkBg);
    expect(flatStyle(screen.getByText('Kullanım Şartları')).color).toBe(T.text2);
  });

  it('in English, shows no lira price before the store prices (another storefront)', async () => {
    await i18n.changeLanguage('en');
    Platform.OS = 'android';
    mockPurchases.billing = 'connecting';
    await renderScreen();

    expect(screen.queryByText(/TRY|TL/)).toBeNull();
    expect(screen.getByTestId('plan-mini-price')).toHaveTextContent('...');
    expect(within(screen.getByTestId('plan-premium-yearly')).getByText('...')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'Yearly: price not loaded yet' })).toBeOnTheScreen();

    // The store answered in euros: its own prices.
    storeReady({ 'mini:monthly': '1,99 €', 'premium:monthly': '6,99 €', 'premium:yearly': '49,99 €' });
    await renderScreen();
    expect(screen.getAllByTestId('plan-mini-price').pop()).toHaveTextContent('1,99 € / mo');

    // No store on this phone: a dash, never a lira price.
    mockPurchases.billing = 'unavailable';
    mockPurchases.prices = {};
    await renderScreen();
    expect(screen.getAllByTestId('plan-mini-price').pop()).toHaveTextContent('-');
    expect(screen.queryByText(/TRY/)).toBeNull();
  });

  it('a Turkish storefront may show the reference prices in an English UI', () => {
    expect(showsReferencePrices('en', 'TRY')).toBe(true);
    expect(showsReferencePrices('en', 'EUR')).toBe(false);
    expect(showsReferencePrices('en', null)).toBe(false);
    expect(showsReferencePrices('tr', null)).toBe(true);
    expect(pricePlaceholderFor('connecting', 'idle')).toBe('...');
    expect(pricePlaceholderFor('ready', 'loading')).toBe('...');
    expect(pricePlaceholderFor('ready', 'error')).toBe('-');
    expect(pricePlaceholderFor('unavailable', 'idle')).toBe('-');
  });

  it('is translated into English, with the store prices', async () => {
    await i18n.changeLanguage('en');
    Platform.OS = 'android';
    // An English phone on the Turkish store: TRY prices in the English format.
    mockPurchases.storeCurrency = 'TRY';
    await renderScreen();
    mockPurchases.storeCurrency = null;

    expect(screen.getByRole('header', { name: 'Choose your plan' })).toBeOnTheScreen();
    expect(screen.getByText('Free')).toBeOnTheScreen();
    expect(screen.getByText('Your current plan')).toBeOnTheScreen();
    expect(screen.getByText('Ready-made narrators: 20 stories a month')).toBeOnTheScreen();
    expect(screen.getByText('Own voice: 1 story in total')).toBeOnTheScreen();
    expect(screen.getByText(/TRY 49\.99/)).toBeOnTheScreen();
    // Short period marks, so a chip price stays on one line at 360dp.
    expect(within(screen.getByTestId('plan-premium-monthly')).getByText('TRY 199.99 / mo')).toBeOnTheScreen();
    expect(within(screen.getByTestId('plan-premium-yearly')).getByText('TRY 1,499.99 / yr')).toBeOnTheScreen();
    expect(screen.getByTestId('plan-premium-price')).toHaveTextContent('TRY 1,499.99 / yr');
    expect(screen.getByRole('button', { name: 'Get Premium yearly' })).toBeDisabled();
    expect(screen.getByText(/You can cancel in Google Play at any time\./)).toBeOnTheScreen();
    expect(screen.getByText('Terms of Use')).toBeOnTheScreen();
  });
});

describe('SubscriptionScreen reason (ux-22)', () => {
  it('without a reason there is no context line', async () => {
    await renderScreen();
    expect(screen.queryByTestId('plans-reason')).toBeNull();
  });

  it.each([
    ['quota', 'Bu planda masal hakkın doldu.'],
    ['voices', 'Daha fazla ses için bir plan seç.'],
    ['premiumStory', 'Bu masal ücretli planlarda var.'],
    ['background', 'Ekran kapalıyken dinlemek ücretli planlarda var.'],
  ])('reason %s says why above the cards', async (reason, line) => {
    setMockRouteParams({ reason });
    const view = await renderScreen();
    const text = screen.getByTestId('plans-reason');
    expect(text).toHaveTextContent(line);
    // Inside the scroll, before the cards.
    const scroll = view.UNSAFE_getByType(ScrollView);
    expect(within(scroll).getByTestId('plans-reason')).toBe(text);
    expect(flatStyle(text)).toMatchObject({ paddingHorizontal: 16, marginBottom: 12 });
    // Every plan stays and nothing else changes.
    expect(screen.getByTestId('plan-free-face')).toBeOnTheScreen();
    expect(screen.getByTestId('plans-cta')).toBeDisabled();
  });

  it('an unknown reason is ignored', async () => {
    setMockRouteParams({ reason: 'lottery' });
    await renderScreen();
    expect(screen.queryByTestId('plans-reason')).toBeNull();
  });

  it('speaks English', async () => {
    await i18n.changeLanguage('en');
    setMockRouteParams({ reason: 'background' });
    await renderScreen();
    expect(screen.getByTestId('plans-reason')).toHaveTextContent(
      'Listening with the screen off comes with the paid plans.',
    );
  });
});
