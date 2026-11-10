/**
 * PlanUsageCard: the plan and usage card of the profile (design/v4/playful,
 * a `.card` on its lip).
 *
 * The plan name (Baloo 2) and the "Planları gör" button are always shown.
 * Under them, the narration allowances from GET /usage
 * (`SubscriptionStore.usage`, models/Quota.ts):
 *   - known: a bar per allowance, ready-made narrators and the own voice
 *     (`usage-preset`, `usage-cloned`); an unlimited one has no bar;
 *   - loading with nothing known yet: two skeleton rows of the same height,
 *     so nothing jumps when the numbers land;
 *   - failed with nothing known: the plan's two narration limits as plain
 *     lines (`planLimitLines`), never an invented count.
 * Voice creations are not shown here (Sesim shows those).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { Bone, Button, Card, ProgressBar, SkeletonPulse } from '../design';
import { PLANS, PlanId, planLimitLines, usageFraction } from '../../models/Plans';
import { UsageBucket, renewalLine } from '../../models/Quota';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Height of a usage bar (dp). */
export const USAGE_BAR_HEIGHT = 8;

const METER_LINE = 19;
const BAR_GAP = SPACE.sm;
const CAPTION_GAP = SPACE.tight;
const CAPTION_LINE = 16;

/**
 * Height of one usage row with its bar and caption (dp): the skeleton rows
 * have it, and a real row never draws shorter (an unlimited allowance has
 * no bar), so the card keeps its height when the numbers land.
 */
export const USAGE_METER_HEIGHT = METER_LINE + BAR_GAP + USAGE_BAR_HEIGHT + CAPTION_GAP + CAPTION_LINE;

/** The allowances the card draws. */
export interface PlanUsageMeters {
  /** Narrations with ready-made narrators. */
  preset: UsageBucket;
  /** Narrations with the user's own voice. */
  cloned: UsageBucket;
}

type Meter = Pick<UsageBucket, 'used' | 'limit' | 'period' | 'renewsAt'>;

/**
 * "12 / 20 masal", or "12 masal" when the plan has no limit. A count of 1
 * uses the `One` key (Hermes has no plural rules).
 */
export function usageValue(meter: Meter, t: Translate): string {
  if (meter.limit === null) {
    return meter.used === 1 ? t('usage.valueUnlimitedOne') : t('usage.valueUnlimited', { used: meter.used });
  }
  return meter.limit === 1
    ? t('usage.valueOne', { used: meter.used })
    : t('usage.value', { used: meter.used, limit: meter.limit });
}

/** The line under a bar: when it renews, or that it never does. */
export function usageCaption(meter: Meter, planId: PlanId, t: Translate): string | null {
  if (meter.limit === null) return t('usage.unlimited');
  if (meter.period === 'lifetime') {
    const key = planId === 'free' ? 'usage.lifetimeFree' : 'usage.lifetime';
    return meter.limit === 1 ? t(`${key}One`) : t(key, { limit: meter.limit });
  }
  return meter.renewsAt ? renewalLine(meter.renewsAt) : null;
}

export interface PlanUsageCardProps {
  planId: PlanId;
  /** The allowances from GET /usage; null until they were read. */
  meters: PlanUsageMeters | null;
  /** GET /usage is on its way (skeleton rows while nothing is known). */
  loading?: boolean;
  onSeePlans: () => void;
  testID?: string;
}

export const PlanUsageCard: React.FC<PlanUsageCardProps> = ({
  planId,
  meters,
  loading = false,
  onSeePlans,
  testID,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('profile');
  const { t: tPlans } = useTranslation('plans');

  const brandName = PLANS[planId].brandName;
  const planLabel = brandName ? t('plan.paid', { name: brandName }) : t('plan.free');

  const renderMeter = (meter: Meter, label: string, id: string) => {
    const fraction = usageFraction(meter);
    const value = usageValue(meter, t);
    const caption = usageCaption(meter, planId, t);
    return (
      <View key={id} testID={`usage-${id}`} style={styles.meter}>
        <View style={styles.meterTop}>
          <Text style={styles.meterLabel}>{label}</Text>
          <Text style={styles.meterValue}>{value}</Text>
        </View>
        {fraction !== null ? (
          <ProgressBar
            value={fraction}
            height={USAGE_BAR_HEIGHT}
            accessibilityLabel={`${label}, ${value}`}
            testID={`usage-${id}-bar`}
            style={styles.bar}
          />
        ) : null}
        {caption ? <Text style={styles.caption}>{caption}</Text> : null}
      </View>
    );
  };

  let body: React.ReactNode;
  if (meters) {
    body = (
      <>
        {renderMeter(meters.preset, t('usage.presetMonth'), 'preset')}
        {renderMeter(
          meters.cloned,
          meters.cloned.period === 'lifetime' ? t('usage.cloned') : t('usage.clonedMonth'),
          'cloned',
        )}
      </>
    );
  } else if (loading) {
    body = (
      <SkeletonPulse testID="usage-loading">
        {[0, 1].map(i => (
          <View key={i} style={[styles.meter, styles.meterSkeleton]} testID={`usage-skeleton-${i}`}>
            <View style={styles.meterTop}>
              <Bone tone="line" width="55%" height={12} />
              <Bone tone="line" width={56} height={12} />
            </View>
            <Bone tone="line" height={USAGE_BAR_HEIGHT} radius={USAGE_BAR_HEIGHT / 2} style={styles.bar} />
            <Bone tone="line" width="40%" height={10} style={styles.captionBone} />
          </View>
        ))}
      </SkeletonPulse>
    );
  } else {
    // The live numbers could not be read: what the plan includes, in words.
    body = (
      <View style={styles.limits} testID="usage-limits">
        {planLimitLines(PLANS[planId], tPlans)
          .slice(0, 2)
          .map(line => (
            <Text key={line} style={styles.limitLine}>
              {line}
            </Text>
          ))}
      </View>
    );
  }

  return (
    <Card testID={testID} style={styles.card} contentStyle={styles.content}>
      <View style={styles.top} testID="profile-plan-top">
        <Text style={styles.plan} testID="profile-plan-name">
          {planLabel}
        </Text>
        <Button
          label={t('plan.seePlans')}
          size="sm"
          onPress={onSeePlans}
          testID="profile-see-plans"
          style={styles.seePlans}
        />
      </View>
      {body}
    </Card>
  );
};

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    card: { marginHorizontal: T.screenPadH, marginBottom: SPACE.lg },
    content: { padding: SPACE.lg },
    // One row, centred on its middle line. It wraps instead of overflowing:
    // with a large font the button moves under the plan name.
    top: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: SPACE.md,
      rowGap: SPACE.sm,
    },
    plan: {
      flexGrow: 1,
      flexShrink: 1,
      minWidth: 0,
      fontFamily: T.fontDisplay,
      fontSize: 20,
      lineHeight: 28,
      color: T.text,
    },
    seePlans: { flexShrink: 0, maxWidth: '100%' },
    meter: { marginTop: SPACE.md, minHeight: USAGE_METER_HEIGHT },
    meterSkeleton: { height: USAGE_METER_HEIGHT },
    meterTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: SPACE.md,
      minHeight: METER_LINE,
    },
    meterLabel: { flex: 1, fontFamily: T.fontLabel, fontSize: 13.5, lineHeight: METER_LINE, color: T.text },
    meterValue: {
      fontFamily: T.fontLabel,
      fontSize: 13.5,
      lineHeight: METER_LINE,
      color: T.text,
      fontVariant: ['tabular-nums'],
    },
    bar: { marginTop: BAR_GAP },
    caption: {
      fontFamily: T.fontBody,
      fontSize: 12,
      lineHeight: CAPTION_LINE,
      color: T.text3,
      marginTop: CAPTION_GAP,
    },
    captionBone: { marginTop: CAPTION_GAP },
    limits: { marginTop: SPACE.xs },
    limitLine: { fontFamily: T.fontBody, fontSize: 13.5, lineHeight: 19, color: T.text2 },
  });

const stylesFor = themedStyles(makeStyles);

export default PlanUsageCard;
