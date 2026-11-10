/**
 * SubscriptionScreen: the plans screen (design/v4/playful; no frame of its
 * own, restyled in the system of the story detail's narrator cards).
 *
 * The app bar holds the close button and the title. A plan CTA that opened
 * the screen says why in one line above the cards (`reason` route param: a
 * used-up allowance, a full voice list, a premium story, listening with the
 * screen off). Three plan cards on their lips, Ücretsiz, Mini and Premium,
 * drawn from the typed constant in models/Plans.ts, then the restore button
 * (only once there are store purchases to restore) and the legal line at the
 * end of the scroll. The dock holds the primary button alone.
 *
 * A plan card is a face on its lip. Its head (radio, name, the current-plan
 * tag, the limits and Mini's price) is one radio for screen readers, with
 * the limits and the price in its label. Its title row holds only the radio,
 * the name (one line, all the room the price leaves) and the price; "Şu anki
 * planın" sits on its own line under the name, from the name's left edge, so
 * it never squeezes the name. Premium's billing periods are
 * radios of their own next to the head, never inside it, so VoiceOver
 * reaches each. Every paid card has a price on its title row, so the cards
 * end on one edge: Mini's one price, Premium's selected period as it is
 * billed (no per-month equivalent, no saving badge: design v3, the yearly
 * price is stated as it is). With another plan selected, Premium keeps its
 * period: that chip stays marked with a quiet text2 ring on the idle face
 * (and stays the selected radio of its own group), so the price on the
 * title row always names a visible choice. Pressing the head sinks the
 * whole card. Each limit line has
 * a success tick, except what a plan does not do (the free plan's story
 * stops with the screen), which has a neutral minus.
 *
 * The current plan comes from `SubscriptionStore.planId` (Mini is a paid
 * plan). Prices are the store's own localised prices once `PurchaseStore`
 * has the products (the reference prices of models/Plans.ts until then).
 * The primary button buys the selection (`PurchaseStore.buy`): for a plan
 * above the current one, or, for a user whose subscription comes from this
 * platform's store, any other product (a plan change: Google Play replaces
 * the old purchase, an upgrade now and a downgrade at the next renewal, with
 * a note saying so). A subscription bought in the other store is changed
 * there (a note, no button). One notice above the cards says what the store
 * is doing: the payment waits (Google pending purchase), paid but not
 * verified yet (kept and retried), purchases unavailable on this phone or
 * the products did not load (with "Yeniden dene"). After the backend
 * granted the plan the screen shows a calm success state with "Tamam".
 * "Satın alımları geri yükle" shows while the store is connected, "Aboneliği
 * yönet" while the plan comes from a store.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { observer } from 'mobx-react-lite';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  LIP,
  RADIUS,
  SPACE,
  Theme,
  dockBottom,
  themedStyles,
  useT,
  useTextStyles,
} from '../../theme/theme';
import { PRESS_DELAY_MS } from '../../theme/motion';
import {
  Button,
  Icon,
  IconButton,
  StateView,
  SurfaceLevelProvider,
  Tactile,
  Tag,
  usePressSink,
} from '../../components/design';
import type { IconName } from '../../components/design';
import { LegalSheet } from '../../components/design/LegalSheet';
import { useSubscription } from '../../hooks/useSubscription';
import { usePurchases } from '../../hooks/usePurchaseBridge';
import { planChange, productIdFor, productRefFor, type PlanChange } from '../../services/iap/storeProducts';
import { currentLanguage } from '../../i18n/text';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import type { LegalSlug } from '../../models/Legal';
import {
  BillingPeriod,
  PLANS,
  PLAN_ORDER,
  PlanDefinition,
  PlanId,
  formatPlanPrice,
  planLimitLines,
  storeNameFor,
} from '../../models/Plans';
import { parseSubscriptionReason } from './subscriptionReason';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Rt = RouteProp<RootStackParamList, 'Subscription'>;

/** The plans a user can pick; the free plan is where you start, not a purchase. */
export type SelectablePlanId = Exclude<PlanId, 'free'>;

/** Lip and corner of a plan card (the `Card` defaults). */
const PLAN_LIP = LIP.md;
const PLAN_RADIUS = RADIUS.xl;
/** Edge of the radio dot and of the box each limit check is centred in (dp). */
const RADIO_SIZE = 24;
const CHECK_SIZE = 18;

/** i18n key of the primary button for a selection, once purchases are open. */
export function ctaKeyFor(plan: SelectablePlanId, period: BillingPeriod): string {
  if (plan === 'mini') return 'cta.mini';
  return period === 'yearly' ? 'cta.premiumYearly' : 'cta.premiumMonthly';
}

/** A plan above `current`: the only selection the primary button offers without a store subscription. */
export function isUpgrade(selected: PlanId, current: PlanId): boolean {
  return PLAN_ORDER.indexOf(selected) > PLAN_ORDER.indexOf(current);
}

/** The period a selection is bought with: Mini sells only monthly. */
export function purchasePeriodFor(plan: SelectablePlanId, period: BillingPeriod): BillingPeriod {
  return PLANS[plan].prices[period] !== null ? period : 'monthly';
}

export interface CtaDecision {
  /** The primary button is offered. */
  readonly show: boolean;
  /** A store plan change (Android replacement, App Store group change); null for a first purchase. */
  readonly change: PlanChange | null;
}

/**
 * Whether the selection can be bought. A subscription from the other store
 * is changed there (no button). One from this platform's store can move to
 * any other product (up now, down at the renewal). Otherwise only a plan
 * above the current one is offered (an admin grant counts as the plan).
 */
export function decideCta(input: {
  selected: SelectablePlanId;
  period: BillingPeriod;
  currentPlan: PlanId;
  platform: 'android' | 'ios';
  /** GET /subscriptions/current source, while the plan is paid. */
  storeSource: 'APPLE' | 'GOOGLE' | null;
  storeProductId: string | null;
}): CtaDecision {
  const ownSource = input.platform === 'ios' ? 'APPLE' : 'GOOGLE';
  if (input.storeSource && input.storeSource !== ownSource) return { show: false, change: null };
  const current = input.storeSource ? productRefFor(input.storeProductId) : null;
  if (current && input.storeProductId) {
    const target = productIdFor(input.selected, purchasePeriodFor(input.selected, input.period), input.platform);
    const change = target ? planChange(input.storeProductId, target) : 'same';
    return { show: change !== 'same', change: change === 'same' ? null : change };
  }
  return { show: isUpgrade(input.selected, input.currentPlan), change: null };
}

/**
 * The billing period a plan's title row prices: the selected one when the
 * plan sells both, else the one it sells; null for the free plan.
 */
/** The price slot before the store's price arrives (three periods, a loading mark). */
export const PRICE_LOADING = '...';
/** The price slot when the store gave no price (no store, products failed). */
export const PRICE_UNKNOWN = '-';

/**
 * The price slot without a price: the loading mark while the store may
 * still answer, a plain dash once it cannot (no store here, the products
 * failed or are missing).
 */
export function pricePlaceholderFor(billing: string, productsState: string): string {
  const gaveUp =
    billing === 'unavailable' ||
    (billing === 'ready' && (productsState === 'error' || productsState === 'empty'));
  return gaveUp ? PRICE_UNKNOWN : PRICE_LOADING;
}

/**
 * Whether the reference prices (Turkish lira, models/Plans.ts) may stand in
 * for the store's prices: in a Turkish UI, or for a storefront that charges
 * TRY. Any other user would read a lira price that is not what they pay.
 */
export function showsReferencePrices(language: string, storeCurrency: string | null): boolean {
  return language === 'tr' || storeCurrency === 'TRY';
}

export function titlePeriodFor(plan: PlanDefinition, selected: BillingPeriod): BillingPeriod | null {
  const { monthly, yearly } = plan.prices;
  if (monthly !== null && yearly !== null) return selected;
  if (monthly !== null) return 'monthly';
  return yearly !== null ? 'yearly' : null;
}

export const SubscriptionScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const insets = useSafeAreaInsets();
  const T = useT();
  const styles = stylesFor(T);
  const text = useTextStyles();
  const { t } = useTranslation('plans');
  const subscriptionStore = useSubscription();
  const purchases = usePurchases();
  const language = currentLanguage();

  // As drawn: Premium, yearly. A paid user keeps the same selection.
  const [selectedPlan, setSelectedPlan] = useState<SelectablePlanId>('premium');
  const [period, setPeriod] = useState<BillingPeriod>('yearly');
  const [activeSlug, setActiveSlug] = useState<LegalSlug | null>(null);
  const [bought, setBought] = useState<{ plan: SelectablePlanId; change: PlanChange | null } | null>(null);

  const reason = parseSubscriptionReason(route.params?.reason);
  const currentPlan = subscriptionStore.planId;
  const platform = purchases.platform ?? (Platform.OS === 'ios' ? 'ios' : 'android');
  const hasStoreSubscription = subscriptionStore.hasStoreSubscription;
  const storeSource =
    hasStoreSubscription && (subscriptionStore.source === 'APPLE' || subscriptionStore.source === 'GOOGLE')
      ? subscriptionStore.source
      : null;
  const cta = decideCta({
    selected: selectedPlan,
    period,
    currentPlan,
    platform,
    storeSource,
    storeProductId: subscriptionStore.storeProductId,
  });
  const otherStore = storeSource !== null && storeSource !== (platform === 'ios' ? 'APPLE' : 'GOOGLE');
  const flow = purchases.flow;
  const succeeded = flow === 'success';
  const showCta = succeeded || cta.show;
  const storeLoading =
    purchases.billing === 'connecting' || (purchases.billing === 'ready' && purchases.productsState === 'loading');

  // Products that failed to load are asked for again when the plans open;
  // a success state is left behind when the screen closes.
  useEffect(() => {
    if (purchases.billing === 'ready' && (purchases.productsState === 'error' || purchases.productsState === 'empty')) {
      void purchases.loadProducts();
    }
    return () => {
      if (purchases.flow === 'success') purchases.dismissOutcome();
    };
  }, [purchases]);

  const planName = useCallback(
    (plan: PlanDefinition) => plan.brandName ?? t('free'),
    [t],
  );

  // The reference prices are Turkish lira: shown before the store's prices
  // only to a Turkish UI or a Turkish storefront. Anyone else sees a
  // neutral placeholder until the store's own price arrives.
  const referencePrices = showsReferencePrices(language, purchases.storeCurrency);
  const pricePlaceholder = pricePlaceholderFor(purchases.billing, purchases.productsState);

  /**
   * The store's localised price once the products are in, else the
   * reference price where it may show; null when the plan is not sold that
   * way or no price may show yet.
   */
  const priceText = (plan: PlanDefinition, billing: BillingPeriod): string | null => {
    const amount = plan.prices[billing];
    if (amount === null) return null;
    const product = plan.id === 'free' ? null : purchases.productFor(plan.id, billing);
    if (product) return product.displayPrice;
    return referencePrices ? formatPlanPrice(amount, language) : null;
  };

  const priceWithPeriod = (plan: PlanDefinition, billing: BillingPeriod): string | null => {
    const price = priceText(plan, billing);
    if (price === null) return null;
    return `${price} ${t(`per.${billing}`)}`;
  };

  const notice = purchaseNotice({
    flow,
    billing: purchases.billing,
    productsState: purchases.productsState,
    platform,
    otherStore: otherStore ? storeNameFor(storeSource === 'APPLE' ? 'ios' : 'android') : null,
    downgrade: cta.show && cta.change === 'downgrade',
  });

  const onCta = () => {
    if (succeeded) {
      purchases.dismissOutcome();
      nav.goBack();
      return;
    }
    setBought({ plan: selectedPlan, change: cta.change });
    void purchases.buy(selectedPlan, purchasePeriodFor(selectedPlan, period));
  };

  // What the success state names: the plan bought, and whether it waits for
  // the renewal (a downgrade).
  const successPlan = PLANS[bought?.plan ?? (currentPlan === 'free' ? selectedPlan : currentPlan)];
  const successDeferred = bought?.change === 'downgrade';

  const renderPlan = (id: PlanId) => {
    const plan = PLANS[id];
    const name = planName(plan);
    const isCurrent = currentPlan === id;
    const lines = planLimitLines(plan, t);
    // What a plan does not do (the free plan's story stops with the screen)
    // is a fact, not a perk: it gets a neutral minus, never the success tick.
    const limitation = plan.backgroundPlayback ? null : t('limits.screenOffStops');
    const hasPeriodChoice = plan.prices.monthly !== null && plan.prices.yearly !== null;
    // Every paid plan has a price on its title row, so the cards end on one
    // edge: Mini's one price, Premium's selected period as it is billed.
    const titlePeriod = titlePeriodFor(plan, period);
    const titlePrice = titlePeriod ? plan.prices[titlePeriod] : null;
    const titleText = titlePeriod ? priceText(plan, titlePeriod) : null;
    const label = [
      isCurrent ? t('a11y.currentPlan', { name }) : t('a11y.plan', { name }),
      ...lines,
      titlePeriod ? priceWithPeriod(plan, titlePeriod) : null,
    ]
      .filter(Boolean)
      .join(', ');

    const selectable = id !== 'free';
    const selected = selectable && selectedPlan === id;

    const head = (
      <>
        <View style={styles.cardTop}>
          {selectable ? (
            <View style={[styles.radio, selected && styles.radioOn]} testID={`plan-${id}-radio`}>
              {selected ? <Icon name="check" size={16} color={T.onAction} /> : null}
            </View>
          ) : null}
          <Text style={styles.planName} numberOfLines={1} testID={`plan-${id}-name`}>
            {name}
          </Text>
          {titlePeriod && titlePrice !== null ? (
            titleText !== null ? (
              <Text style={styles.price} testID={`plan-${id}-price`}>
                {titleText}
                <Text style={styles.pricePer}>{` ${t(`per.${titlePeriod}`)}`}</Text>
              </Text>
            ) : (
              <Text style={styles.price} testID={`plan-${id}-price`} accessible={false}>
                {pricePlaceholder}
              </Text>
            )
          ) : null}
        </View>
        {isCurrent ? (
          // Its own line under the name, starting where the name starts: on
          // the title row it squeezed the name between itself and the price.
          <View style={[styles.currentRow, selectable && styles.currentRowIndented]} testID={`plan-${id}-current-row`}>
            <Tag label={t('currentTag')} tone="ok" size="sm" testID={`plan-${id}-current`} />
          </View>
        ) : null}
        <View style={styles.limits}>
          {lines.map(line => {
            const missing = line === limitation;
            return (
              <View key={line} style={styles.limitRow}>
                {/* Centred in the radio's column, so the text starts under the name. */}
                <View style={styles.limitSlot}>
                  <View
                    style={[styles.limitCheck, missing && styles.limitMissing]}
                    testID={`plan-${id}-mark-${missing ? 'minus' : 'check'}`}
                  >
                    <Icon
                      name={missing ? 'minus' : 'check'}
                      size={14}
                      color={missing ? T.text2 : T.onCat}
                    />
                  </View>
                </View>
                <Text style={styles.limitText}>{line}</Text>
              </View>
            );
          })}
        </View>
      </>
    );

    const periods = hasPeriodChoice ? (
      <View accessibilityRole="radiogroup" style={styles.periods}>
        {(['monthly', 'yearly'] as const).map(billing => {
          // The group's value is the plan's period, the one its title row
          // prices, whichever plan is selected. Picked (the plan is the
          // selection): the action face. Remembered (another plan is): the
          // idle face with a quiet text2 ring, so the priced period stays
          // visible. Every chip carries the 2dp ring, so nothing moves.
          const chosen = period === billing;
          const on = selected && chosen;
          const remembered = !selected && chosen;
          const known = priceWithPeriod(plan, billing);
          const price = known ?? pricePlaceholder;
          return (
            <Tactile
              key={billing}
              testID={`plan-${id}-${billing}`}
              color={on ? T.action : T.line}
              lipColor={on ? T.actionLip : T.lineLip}
              borderColor={on ? T.action : remembered ? T.text2 : 'transparent'}
              borderWidth={T.ring}
              lip={LIP.md}
              radius={RADIUS.lg}
              onPress={() => {
                setSelectedPlan(id as SelectablePlanId);
                setPeriod(billing);
              }}
              accessibilityRole="radio"
              accessibilityLabel={t('a11y.periodOption', {
                period: t(`period.${billing}`),
                price: known ?? t('priceNotLoaded'),
              })}
              accessibilityState={{ selected: chosen }}
              style={styles.period}
              faceStyle={styles.periodFace}
            >
              <Text style={[styles.periodName, { color: on ? T.onAction : T.text }]}>
                {t(`period.${billing}`)}
              </Text>
              <Text style={[styles.periodPrice, { color: on ? T.onAction : T.text2 }]}>{price}</Text>
            </Tactile>
          );
        })}
      </View>
    ) : null;

    return (
      <PlanCard
        key={id}
        id={id}
        selected={selected}
        onSelect={selectable ? () => setSelectedPlan(id as SelectablePlanId) : undefined}
        accessibilityLabel={label}
        head={head}
        footer={periods}
      />
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.appBarWrap, { paddingTop: insets.top }]}>
        <View style={styles.appBar}>
          <IconButton
            variant="tactile"
            icon="close"
            onPress={() => nav.goBack()}
            accessibilityLabel={t('common:close')}
            testID="plans-close"
          />
          <Text accessibilityRole="header" numberOfLines={2} style={[text.heading, styles.title]}>
            {t('title')}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        // Without the dock (nothing to offer) the scroll ends on the system
        // bar itself, so it keeps clear of it.
        contentContainerStyle={[
          styles.scrollContent,
          !showCta && { paddingBottom: insets.bottom + SPACE.xxl },
        ]}
        showsVerticalScrollIndicator={false}
        testID="plans-scroll"
      >
        {succeeded ? (
          <StateView
            icon="check"
            title={t(successDeferred ? 'success.changeTitle' : 'success.title', { name: planName(successPlan) })}
            message={t(successDeferred ? 'success.changeMessage' : 'success.message', { name: planName(successPlan) })}
            testID="plans-success"
          />
        ) : (
          <>
            {reason ? (
              <Text style={[text.bodySmall, styles.reason]} accessibilityLiveRegion="polite" testID="plans-reason">
                {t(`reason.${reason}`)}
              </Text>
            ) : null}
            {notice ? (
              <PurchaseNotice
                notice={notice}
                onRetry={notice.retry ? () => void purchases.retry() : undefined}
              />
            ) : null}
            {PLAN_ORDER.map(renderPlan)}
          </>
        )}

        {/* Restore always (App Review looks for it; the store connects again
            first when it is down); manage while the plan comes from a store. */}
        {!succeeded ? (
          <Button
            label={t('restore')}
            variant="text"
            size="sm"
            loading={purchases.restoring}
            disabled={purchases.isBusy}
            onPress={() => void purchases.restore()}
            style={styles.restore}
            testID="plans-restore"
          />
        ) : null}
        {!succeeded && hasStoreSubscription ? (
          <Button
            label={t('manage')}
            variant="text"
            size="sm"
            onPress={() => void purchases.manageSubscriptions()}
            style={styles.restore}
            testID="plans-manage"
          />
        ) : null}
        <Text style={styles.legal} testID="plans-legal">
          {t(Platform.OS === 'ios' ? 'legal.ios' : 'legal.android')}{' '}
          <Text accessibilityRole="link" onPress={() => setActiveSlug('tos')} style={styles.legalLink}>
            {t('legal.terms')}
          </Text>
          {', '}
          <Text
            accessibilityRole="link"
            onPress={() => setActiveSlug('privacy')}
            style={styles.legalLink}
          >
            {t('legal.privacy')}
          </Text>
        </Text>
      </ScrollView>

      {showCta ? (
        <View style={[styles.dock, { paddingBottom: dockBottom(insets.bottom) }]} testID="plans-dock">
          {/* The selection to buy, or "Tamam" after a purchase. */}
          <Button
            label={succeeded ? t('success.done') : t(ctaKeyFor(selectedPlan, period))}
            size="lg"
            block
            disabled={!succeeded && (!purchases.canBuy || flow === 'pending' || flow === 'deferred')}
            loading={!succeeded && (purchases.isBusy || storeLoading)}
            onPress={onCta}
            pressDelay={0}
            testID="plans-cta"
          />
        </View>
      ) : null}

      <LegalSheet slug={activeSlug} onClose={() => setActiveSlug(null)} context="profile" />
    </View>
  );
});

// ─────────────────────────────────────────────────────────────
// Plan card: a face on its lip, a radio head and an optional footer
// ─────────────────────────────────────────────────────────────

interface PlanCardProps {
  id: PlanId;
  selected: boolean;
  /** Absent for the free plan: it is where you start, not a choice. */
  onSelect?: () => void;
  /** The head's screen reader label: name, limits and price. */
  accessibilityLabel: string;
  head: React.ReactNode;
  /** Controls of their own under the head (the billing periods). */
  footer?: React.ReactNode;
}

/**
 * The face carries the 2dp ring in every state (transparent unless
 * selected), so a selection never moves the content and the free card lines
 * up with the others. The head is `plan-${id}`, the face `plan-${id}-face`,
 * the lip `plan-${id}-lip`.
 */
const PlanCard: React.FC<PlanCardProps> = ({ id, selected, onSelect, accessibilityLabel, head, footer }) => {
  const T = useT();
  const styles = stylesFor(T);
  const { translateY, onPressIn, onPressOut } = usePressSink(PLAN_LIP, !!onSelect);
  const level = selected ? 'surface2' : 'surface';

  const headStyle = [styles.head, footer ? styles.headWithFooter : null];
  return (
    <View style={styles.cardWrap}>
      <View
        pointerEvents="none"
        testID={`plan-${id}-lip`}
        style={[styles.lip, { backgroundColor: selected ? T.actionLip : T.lip }]}
      />
      <Animated.View
        testID={`plan-${id}-face`}
        style={[
          styles.face,
          {
            backgroundColor: selected ? T.surface2 : T.surface,
            borderColor: selected ? T.action : 'transparent',
            transform: [{ translateY }],
          },
        ]}
      >
        <SurfaceLevelProvider level={level}>
          {onSelect ? (
            <Pressable
              onPress={onSelect}
              onPressIn={onPressIn}
              onPressOut={onPressOut}
              // Inside the scrolling list: a swipe never sinks a card.
              unstable_pressDelay={PRESS_DELAY_MS}
              accessibilityRole="radio"
              accessibilityLabel={accessibilityLabel}
              accessibilityState={{ selected }}
              testID={`plan-${id}`}
              style={headStyle}
            >
              {head}
            </Pressable>
          ) : (
            <View accessible accessibilityLabel={accessibilityLabel} testID={`plan-${id}`} style={headStyle}>
              {head}
            </View>
          )}
          {footer}
        </SurfaceLevelProvider>
      </Animated.View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Purchase notice: one card above the plans saying what the store does
// ─────────────────────────────────────────────────────────────

export interface Notice {
  readonly kind: 'pending' | 'deferred' | 'unavailable' | 'products' | 'otherStore' | 'downgrade';
  readonly icon: IconName;
  /** i18n keys in `plans` (title optional). */
  readonly titleKey: string | null;
  readonly messageKey: string;
  readonly params?: Record<string, string>;
  /** "Yeniden dene" is offered. */
  readonly retry: boolean;
}

/**
 * The one notice the plans screen shows, most important first: a payment
 * that waits, a purchase kept for a retry, no store on this phone, products
 * that did not load, a subscription from the other store, a downgrade that
 * starts at the renewal. Null when there is nothing to say.
 */
export function purchaseNotice(input: {
  flow: string;
  billing: string;
  productsState: string;
  platform: 'android' | 'ios';
  /** The other store's name when the subscription was bought there. */
  otherStore: string | null;
  downgrade: boolean;
}): Notice | null {
  if (input.flow === 'pending') {
    return { kind: 'pending', icon: 'clock', titleKey: 'status.pendingTitle', messageKey: 'status.pendingMessage', retry: false };
  }
  if (input.flow === 'deferred') {
    return { kind: 'deferred', icon: 'clock', titleKey: 'status.deferredTitle', messageKey: 'status.deferredMessage', retry: false };
  }
  if (input.otherStore) {
    return {
      kind: 'otherStore',
      icon: 'info',
      titleKey: null,
      messageKey: 'status.otherStore',
      params: { store: input.otherStore },
      retry: false,
    };
  }
  if (input.billing === 'unavailable') {
    return {
      kind: 'unavailable',
      icon: 'alert',
      titleKey: 'status.unavailableTitle',
      messageKey: input.platform === 'ios' ? 'status.unavailableIos' : 'status.unavailableAndroid',
      retry: true,
    };
  }
  if (input.billing === 'ready' && (input.productsState === 'empty' || input.productsState === 'error')) {
    return { kind: 'products', icon: 'alert', titleKey: 'status.productsTitle', messageKey: 'status.productsMessage', retry: true };
  }
  if (input.downgrade) {
    return { kind: 'downgrade', icon: 'info', titleKey: null, messageKey: 'status.downgrade', retry: false };
  }
  return null;
}

const PurchaseNotice: React.FC<{ notice: Notice; onRetry?: () => void }> = ({ notice, onRetry }) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('plans');
  const tone = notice.icon === 'alert' ? T.warning : T.text2;
  return (
    <View style={styles.notice} accessibilityLiveRegion="polite" testID={`plans-notice-${notice.kind}`}>
      <SurfaceLevelProvider level="surface">
        <View style={styles.noticeRow}>
          <Icon name={notice.icon} size={20} color={tone} />
          <View style={styles.noticeText}>
            {notice.titleKey ? <Text style={styles.noticeTitle}>{t(notice.titleKey)}</Text> : null}
            <Text style={styles.noticeMessage}>{t(notice.messageKey, notice.params)}</Text>
          </View>
        </View>
        {notice.retry && onRetry ? (
          <Button
            label={t('status.retry')}
            variant="secondary"
            size="sm"
            onPress={onRetry}
            style={styles.noticeAction}
            testID="plans-notice-retry"
          />
        ) : null}
      </SurfaceLevelProvider>
    </View>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    // The back-bar row of TopAppBar, with the close button.
    appBarWrap: { backgroundColor: T.bg },
    appBar: {
      minHeight: 60,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      paddingHorizontal: T.screenPadH,
      paddingTop: SPACE.sm,
    },
    title: { flex: 1, minWidth: 0 },
    scroll: { flex: 1 },
    scrollContent: { paddingTop: SPACE.sm, paddingBottom: SPACE.xxl },

    cardWrap: { marginHorizontal: T.screenPadH, marginBottom: SPACE.lg, paddingBottom: PLAN_LIP },
    lip: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      top: PLAN_LIP,
      borderRadius: PLAN_RADIUS,
    },
    face: { borderRadius: PLAN_RADIUS, borderWidth: T.ring },
    head: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.lg },
    headWithFooter: { paddingBottom: SPACE.md },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    // The name has the row to itself next to the radio and the price.
    planName: {
      flex: 1,
      minWidth: 0,
      fontFamily: T.fontDisplay,
      fontSize: 20,
      lineHeight: 26,
      color: T.text,
    },
    price: { flexShrink: 0, fontFamily: T.fontDisplay, fontSize: 17, lineHeight: 23, color: T.text },
    // "Şu anki planın" under the name, from the name's left edge.
    currentRow: { flexDirection: 'row', marginTop: SPACE.xs },
    currentRowIndented: { marginLeft: RADIO_SIZE + SPACE.md },
    pricePer: { fontFamily: T.fontBody, fontSize: 12.5, lineHeight: 23, color: T.text2 },

    radio: {
      width: RADIO_SIZE,
      height: RADIO_SIZE,
      borderRadius: RADIO_SIZE / 2,
      backgroundColor: T.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOn: { backgroundColor: T.action },

    limits: { marginTop: SPACE.md, gap: SPACE.sm },
    limitRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    limitSlot: { width: RADIO_SIZE, alignItems: 'center' },
    // A small success tick: a dark check on the success colour.
    limitCheck: {
      width: CHECK_SIZE,
      height: CHECK_SIZE,
      borderRadius: CHECK_SIZE / 2,
      backgroundColor: T.success,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // A limitation: the raised step of the card (the free card is never
    // selected, so it is always on surface) with a text2 minus.
    limitMissing: { backgroundColor: T.surface2 },
    limitText: {
      flex: 1,
      fontFamily: T.fontBody,
      fontSize: 13.5,
      lineHeight: 19,
      color: T.text,
    },

    periods: {
      flexDirection: 'row',
      gap: SPACE.sm,
      paddingHorizontal: SPACE.lg,
      paddingBottom: SPACE.lg,
    },
    period: { flex: 1 },
    periodFace: {
      minHeight: 52,
      justifyContent: 'center',
      paddingVertical: SPACE.tight,
      paddingHorizontal: SPACE.md,
    },
    periodName: { fontFamily: T.fontLabel, fontSize: 14, lineHeight: 19 },
    periodPrice: { fontFamily: T.fontBody, fontSize: 12.5, lineHeight: 17 },
    // Why the plans opened: one line on the gutter above the cards.
    reason: { paddingHorizontal: T.screenPadH, marginBottom: SPACE.md, color: T.text },

    // What the store is doing: a flat surface card (information, not a
    // control, so no lip) above the plan cards.
    notice: {
      marginHorizontal: T.screenPadH,
      marginBottom: SPACE.lg,
      padding: SPACE.lg,
      borderRadius: RADIUS.lg,
      backgroundColor: T.surface,
    },
    noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACE.md },
    noticeText: { flex: 1, minWidth: 0, gap: SPACE.xs },
    noticeTitle: { fontFamily: T.fontLabel, fontSize: 14.5, lineHeight: 20, color: T.text },
    noticeMessage: { fontFamily: T.fontBody, fontSize: 13.5, lineHeight: 19, color: T.text2 },
    noticeAction: { alignSelf: 'flex-start', marginTop: SPACE.md, marginLeft: 20 + SPACE.md },

    restore: { alignSelf: 'center', marginBottom: SPACE.sm },
    legal: {
      paddingHorizontal: T.screenPadH,
      fontFamily: T.fontBody,
      fontSize: 11.5,
      lineHeight: 16,
      color: T.text3,
      textAlign: 'center',
    },
    legalLink: { fontFamily: T.fontLabel, color: T.text2, textDecorationLine: 'underline' },

    // The primary button alone (SPEC-design 1.1, the dock rule).
    dock: {
      paddingTop: SPACE.sm,
      paddingHorizontal: T.screenPadH,
      backgroundColor: T.bg,
    },
  });

const stylesFor = themedStyles(makeStyles);

export default SubscriptionScreen;
