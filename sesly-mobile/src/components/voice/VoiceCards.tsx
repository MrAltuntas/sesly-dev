/**
 * The pieces of the Sesim tab (design/v4/playful, frame e): the own-voice
 * slots (a quiet card with the slot and new-voice allowances, one compact
 * slot card per own voice, and a modest "Ses ekle" row for the free room or
 * why there is none) and the ready-made narrator row (`.nr`).
 * Presentational; VoiceProfilesScreen owns the behaviour.
 */

import React from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  Avatar,
  Bone,
  Button,
  Card,
  CircleButton,
  ICON_SIZE_INLINE,
  Icon,
  IconButton,
  ProgressBar,
  RowSkeleton,
  Spinner,
  Tag,
  avatarRadius,
  usePressSink,
  usePressTint,
} from '../design';
import { BUTTON_TOUCH } from '../design/buttonMetrics';
import { RADIUS, LIP, SPACE, Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';
import { withAlpha } from '../../theme/color';
import { PRESS_DELAY_MS } from '../../theme/motion';
import type { CategoryKey } from '../../theme/palettes';
import { initialOf, languageCodeLabel } from '../../i18n/text';
import { DEFAULT_VOICE_LANGUAGE, languageCodeOf } from '../../models/VoiceProfile';
import { renewalLine } from '../../models/Quota';
import { USAGE_BAR_HEIGHT } from '../profile/PlanUsageCard';
import type { OwnVoiceLimits } from './cloneAllowance';

/**
 * `.nr`, a row card: a 40dp avatar tile with 12dp padding (64dp), 20dp
 * corners on the 3dp lip of every row card.
 */
const NARRATOR_AVATAR = 40;
const ROW_HEIGHT = NARRATOR_AVATAR + 2 * SPACE.md;
const ROW_RADIUS = RADIUS.lg;
const ROW_LIP = LIP.md;

/** The mic tile of an own-voice slot: 44dp, rounded, flat like the narrator tiles. */
const SLOT_AVATAR = 44;
/** The state tag line under the name (a sm tag). */
const SLOT_META_LINE = 24;
/** The name line (labelLarge). */
const SLOT_NAME_LINE = 21;
/**
 * Face height of a filled slot: the tallest of the tile, the text
 * block and the delete button's 48dp target, with the row padding.
 */
export const OWN_VOICE_SLOT_HEIGHT =
  2 * SPACE.md +
  Math.max(SLOT_AVATAR, SLOT_NAME_LINE + SPACE.xxs + SLOT_META_LINE, BUTTON_TOUCH);
const SLOT_HEIGHT = OWN_VOICE_SLOT_HEIGHT;
/** The "Ses ekle" row's tile and height (the title and one line of hint). */
const EMPTY_TILE = 40;
export const EMPTY_VOICE_SLOT_HEIGHT = 2 * SPACE.md + Math.max(EMPTY_TILE, SLOT_NAME_LINE + SPACE.xxs + 19);
const EMPTY_SLOT_HEIGHT = EMPTY_VOICE_SLOT_HEIGHT;
/** The bars of the allowance card: the usage bars of the profile. */
const LIMIT_BAR_HEIGHT = USAGE_BAR_HEIGHT;

/** The backend writes a voice's failure reason in Turkish only. */
function isTurkishUi(language: string | undefined): boolean {
  return languageCodeOf(language) === DEFAULT_VOICE_LANGUAGE;
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "Listende 1/3 anlatıcı var.": the ready-made places of the user's list
 * (GET /voice-profiles/slots `preset`), said before an add is refused, and
 * what to do once they are full. Null while they are not known.
 */
export function narratorSlotsLine(
  preset: { readonly used: number; readonly limit: number } | null | undefined,
  t: Translate,
): string | null {
  if (!preset || !(preset.limit > 0)) return null;
  const used = Math.max(0, preset.used);
  return t(used >= preset.limit ? 'voices:narrators.slotsFull' : 'voices:narrators.slots', {
    used,
    limit: preset.limit,
  });
}

// ─────────────────────────────────────────────────────────────
// VoiceAvatar
// ─────────────────────────────────────────────────────────────

export interface VoiceAvatarProps {
  name: string;
  /** 'accent': the user's own voice (own colour). 'tonal': a ready-made narrator. */
  tone?: 'accent' | 'tonal';
  /** A fill of its own (a category colour); text is dark on it. */
  color?: string;
  size?: number;
  testID?: string;
}

/** The initial of a voice on a rounded tile (`.nr .av`, the 40dp row tile). */
export const VoiceAvatar: React.FC<VoiceAvatarProps> = ({
  name,
  tone = 'tonal',
  color,
  size = NARRATOR_AVATAR,
  testID,
}) => {
  const T = useT();
  const fill = color ?? (tone === 'accent' ? T.own : T.surface2);
  const ink = color || tone === 'accent' ? T.onCat : T.text;
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Avatar
        initial={initialOf(name)}
        size={size}
        shape="rounded"
        color={fill}
        textColor={ink}
        testID={testID ? `${testID}-tile` : undefined}
        style={{ borderRadius: size <= NARRATOR_AVATAR ? RADIUS.sm : RADIUS.md }}
      />
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// OwnVoiceLimitsCard: "Ses yuvası 1/3", "Bu ay yeni ses hakkı 2/5"
// ─────────────────────────────────────────────────────────────

/** "1/3": in use (or used) of the limit; the unlimited word, or the limit alone when the use is unknown. */
function limitValue(used: number | null, limit: number | null, t: Translate): string {
  if (limit === null) return t('voices:slots.unlimited');
  if (used === null) return t('voices:slots.creationsLimitOnly', { limit });
  return `${used}/${limit}`;
}

export interface OwnVoiceLimitsCardProps {
  limits: OwnVoiceLimits;
  testID?: string;
}

/**
 * The own-voice allowances in one quiet card: the slots held of the plan's
 * slots, the new voices made of the period's allowance ("bu ay", or "toplam"
 * on the free plan), each with a bar in the colour of the usage bars of the
 * profile, and a line that the allowance never comes back with a delete.
 */
export const OwnVoiceLimitsCard: React.FC<OwnVoiceLimitsCardProps> = ({ limits, testID = 'own-voice-limits' }) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('voices');
  const { slots, creations } = limits;
  const lifetime = creations.period === 'lifetime';
  const creationsLabel = t(lifetime ? 'slots.creationsLifetime' : 'slots.creationsMonth');
  const caption = lifetime
    ? t('slots.lifetimeNote')
    : [creations.renewsAt ? renewalLine(creations.renewsAt) : null, t('slots.monthNote')].filter(Boolean).join(' ');

  const row = (
    id: string,
    label: string,
    used: number | null,
    limit: number | null,
    a11y: string | null,
  ) => {
    const value = limitValue(used, limit, t);
    const fraction = limit !== null && limit > 0 && used !== null ? Math.min(1, used / limit) : null;
    return (
      <View
        style={styles.limitRow}
        testID={`${testID}-${id}`}
        accessible
        accessibilityLabel={a11y ?? `${label}, ${value}`}
      >
        <View style={styles.limitTop}>
          <Text style={styles.limitLabel} numberOfLines={2}>
            {label}
          </Text>
          <Text style={styles.limitValue} testID={`${testID}-${id}-value`}>
            {value}
          </Text>
        </View>
        {fraction !== null ? (
          <ProgressBar value={fraction} height={LIMIT_BAR_HEIGHT} testID={`${testID}-${id}-bar`} style={styles.limitBar} />
        ) : null}
      </View>
    );
  };

  return (
    <Card testID={testID} contentStyle={styles.limitsContent}>
      {row('slots', t('slots.slotsLabel'), slots.used, slots.limit, t('slots.slotsA11y', slots))}
      {row(
        'creations',
        creationsLabel,
        creations.used,
        creations.limit,
        creations.used !== null && creations.limit !== null
          ? t(lifetime ? 'slots.creationsLifetimeA11y' : 'slots.creationsMonthA11y', {
              used: creations.used,
              limit: creations.limit,
            })
          : null,
      )}
      <Text style={styles.limitCaption} testID={`${testID}-caption`}>
        {caption}
      </Text>
    </Card>
  );
};

// ─────────────────────────────────────────────────────────────
// OwnVoiceSlot: one own (cloned) voice in its slot
// ─────────────────────────────────────────────────────────────

/**
 * 'waiting': a PENDING clone whose recording never reached the backend (an
 * upload that failed offline). It is not being prepared; the slot says so
 * and offers to start over.
 */
export type OwnVoiceState = 'ready' | 'preparing' | 'failed' | 'waiting';

export interface OwnVoiceSlotProps {
  id: string;
  name: string;
  state: OwnVoiceState;
  /** "Türkçe, 12 Ekim kaydı": the language of the voice, then the day it was recorded; hidden when empty. */
  recordedLabel?: string;
  /** The voice stories start with ("Varsayılan"). */
  isDefault?: boolean;
  /** The sample of this voice is playing. */
  playing?: boolean;
  /** The sample is being fetched or has not sounded yet. */
  loadingSample?: boolean;
  /** "0:12"; hidden until the player has reported the sample's length. */
  durationLabel?: string;
  /**
   * Why a failed voice failed, as the backend wrote it. Shown in the Turkish
   * UI only (the backend writes Turkish); otherwise, and without one, the
   * slot says it in the app's own words.
   */
  errorMessage?: string | null;
  onToggleSample: () => void;
  onDelete: () => void;
  /** Failed or waiting voice: discard it and record again. */
  onRetry: () => void;
}

/**
 * A filled slot: the plain row card of the narrator rows (the surface face
 * on the standard lip, no gradient, no glow and no ring), the mic tile with
 * its glyph in the own-voice colour (the one quiet mark of the user's own
 * voice), the name with its state, the sample button and delete. Compact, so
 * one to five voices stack without pushing the ready-made narrators off the
 * screen; it invites nothing.
 */
export const OwnVoiceSlot: React.FC<OwnVoiceSlotProps> = ({
  id,
  name,
  state,
  recordedLabel,
  isDefault = false,
  playing = false,
  loadingSample = false,
  durationLabel,
  errorMessage,
  onToggleSample,
  onDelete,
  onRetry,
}) => {
  const T = useT();
  const { t, i18n } = useTranslation('voices');
  const styles = stylesFor(T);
  const text = useTextStyles();

  let status: React.ReactNode = null;
  if (state === 'preparing') {
    status = <Tag tone="line" size="sm" icon="clock" label={t('own.preparing')} testID={`own-voice-status-${id}`} />;
  } else if (state === 'failed') {
    status = (
      <Tag
        size="sm"
        icon="alert"
        color={withAlpha(T.error, 0.16)}
        textColor={T.error}
        label={t('own.failed')}
        testID={`own-voice-status-${id}`}
      />
    );
  } else if (state === 'waiting') {
    status = <Tag tone="line" size="sm" label={t('own.waiting')} testID={`own-voice-status-${id}`} />;
  } else if (isDefault) {
    status = <Tag tone="act" size="sm" label={t('own.default')} testID={`own-voice-default-${id}`} />;
  }
  const meta = [recordedLabel, state === 'ready' ? durationLabel : null].filter(Boolean).join(', ');
  const reason = errorMessage?.trim() && isTurkishUi(i18n.language) ? errorMessage.trim() : null;

  return (
    <View testID={`own-voice-${id}`} style={styles.slotOuter}>
      <View pointerEvents="none" testID={`own-voice-${id}-lip`} style={styles.slotLip} />
      <View testID={`own-voice-${id}-face`} style={styles.slotFace}>
        <View style={styles.slotRow}>
          <Avatar
            icon="mic"
            size={SLOT_AVATAR}
            shape="rounded"
            color={T.surface2}
            textColor={T.own}
            testID={`own-voice-avatar-${id}`}
          />
          <View style={styles.flex}>
            <Text style={text.labelLarge} numberOfLines={1} testID={`own-voice-name-${id}`}>
              {name}
            </Text>
            {status || meta ? (
              <View style={styles.slotMeta}>
                {status}
                {meta ? (
                  <Text style={[text.meta, styles.slotMetaText]} numberOfLines={1}>
                    {meta}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
          {state === 'ready' ? (
            <CircleButton
              icon={playing ? 'stop' : 'play'}
              variant={playing ? 'action' : 'neutral'}
              busy={loadingSample}
              onPress={onToggleSample}
              accessibilityLabel={t(playing ? 'a11y.stopSample' : 'a11y.playSample', { name })}
              testID={`own-voice-sample-${id}`}
            />
          ) : null}
          <IconButton
            icon="trash"
            color={T.text2}
            size={ICON_SIZE_INLINE}
            onPress={onDelete}
            accessibilityLabel={t('a11y.delete', { name })}
            testID={`own-voice-delete-${id}`}
            style={styles.slotControl}
          />
        </View>

        {state === 'failed' || state === 'waiting' ? (
          <View style={styles.slotProblem}>
            <Text
              style={[text.bodySmall, styles.slotProblemText]}
              testID={state === 'failed' ? `own-voice-error-${id}` : `own-voice-waiting-${id}`}
            >
              {state === 'failed' ? reason ?? t('voiceFlow:processing.failedMessage') : t('own.waitingNote')}
            </Text>
            <Button
              variant="secondary"
              size="sm"
              icon="restart"
              label={t(state === 'failed' ? 'own.retry' : 'own.startOver')}
              onPress={onRetry}
              testID={`own-voice-retry-${id}`}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// EmptyVoiceSlot: "Ses ekle", or why no voice can be added
// ─────────────────────────────────────────────────────────────

export interface EmptyVoiceSlotProps {
  /** Target length of the recording, from the clone config. */
  seconds: number;
  /** Why no new voice can be added now; null when one can (see `newVoiceBlock`). */
  block: string | null;
  onAdd: () => void;
  /** "Planları gör" beside a block, while a bigger plan helps. */
  onSeePlans?: () => void;
}

/**
 * The room for a new own voice: a modest dashed row, no fill and no lip,
 * never a call to action of its own. Open: "Ses ekle" with what a recording
 * takes, the whole row opens the flow. Blocked (slots full, the period's new
 * voices used up, cloning closed): the lock and why, with "Planları gör"
 * when a bigger plan helps; the row itself opens nothing.
 */
export const EmptyVoiceSlot: React.FC<EmptyVoiceSlotProps> = ({ seconds, block, onAdd, onSeePlans }) => {
  const T = useT();
  const styles = stylesFor(T);
  const { t } = useTranslation('voices');
  const text = useTextStyles();
  const tint = usePressTint(!!block);
  const title = t('slots.add');
  const line = block ?? t('slots.addHint', { seconds });

  const body = (
    <>
      <View style={styles.emptyTile}>
        <Icon name={block ? 'lock' : 'plus'} size={ICON_SIZE_INLINE} color={block ? T.text3 : T.text2} />
      </View>
      <View style={styles.flex}>
        <Text style={[text.labelLarge, block ? styles.emptyTitleBlocked : null]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={[text.bodySmall, styles.emptyLine]} testID={block ? 'own-voice-add-block' : 'own-voice-add-hint'}>
          {line}
        </Text>
      </View>
    </>
  );

  if (!block) {
    return (
      <Pressable
        onPress={onAdd}
        onPressIn={tint.onPressIn}
        onPressOut={tint.onPressOut}
        unstable_pressDelay={PRESS_DELAY_MS}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${line}`}
        testID="own-voice-add-slot"
      >
        <Animated.View style={[styles.emptySlot, { opacity: tint.opacity }]}>
          {body}
          <Icon name="chevronRight" size={ICON_SIZE_INLINE} color={T.text3} />
        </Animated.View>
      </Pressable>
    );
  }
  return (
    <View style={[styles.emptySlot, styles.emptySlotBlocked]} testID="own-voice-add-slot">
      <View style={styles.emptyBlockedRow} accessible accessibilityLabel={`${title}, ${line}`}>
        {body}
      </View>
      {onSeePlans ? (
        <Button
          variant="text"
          size="sm"
          label={t('dialogs.seePlans')}
          onPress={onSeePlans}
          testID="own-voice-see-plans"
          style={styles.emptySeePlans}
        />
      ) : null}
    </View>
  );
};

// ─────────────────────────────────────────────────────────────
// Skeletons of the slots, in their shapes
// ─────────────────────────────────────────────────────────────

/** A filled slot while the voices load: the row card's height, corners, lip and the mic tile. */
export const OwnVoiceSlotSkeleton: React.FC = () => (
  <View testID="own-voice-slot-skeleton">
    <RowSkeleton
      height={SLOT_HEIGHT}
      radius={ROW_RADIUS}
      lip={ROW_LIP}
      leadingSize={SLOT_AVATAR}
      leadingRadius={avatarRadius(SLOT_AVATAR, 'rounded')}
    />
  </View>
);

/** The "Ses ekle" row while the voices load: its dashed frame's height and corners. */
export const EmptyVoiceSlotSkeleton: React.FC = () => (
  <View testID="own-voice-add-skeleton">
    <Bone height={EMPTY_SLOT_HEIGHT} radius={ROW_RADIUS} />
  </View>
);

// ─────────────────────────────────────────────────────────────
// NarratorRow: a ready-made narrator (`.nr`)
// ─────────────────────────────────────────────────────────────

export interface NarratorRowProps {
  id: string;
  name: string;
  /** "Türkçe, kadın sesi": the language of the voice in its own name, then its description. */
  line: string;
  /**
   * Content language or locale of the voice ("tr", "en-US"): the `.lg` code
   * badge. Pass it only while the list offers several languages; on a list
   * of one language it repeats what the line says.
   */
  languageCode?: string | null;
  /** Category colour slot of the avatar (see `narratorAvatarSlotFor`); neutral when omitted. */
  avatarSlot?: CategoryKey;
  /** Already in the user's list: shows "Eklendi" and can be removed. */
  added?: boolean;
  /** Replaces "Eklendi" for an added narrator that is not ready ("Hazırlanıyor"). */
  statusLabel?: string;
  playing?: boolean;
  loadingPreview?: boolean;
  /**
   * The narrator is being added: the row takes no taps and its plus spins.
   * The sample button stays as it is (a spinner there would read as the
   * sample loading).
   */
  adding?: boolean;
  /** Row tap: adds a catalogue narrator (a plus marks it). Omit for a row that only previews. */
  onPress?: () => void;
  onTogglePreview: () => void;
  /** Shown as a trash button; only for an added narrator. */
  onRemove?: () => void;
}

export const NarratorRow: React.FC<NarratorRowProps> = ({
  id,
  name,
  line,
  languageCode,
  avatarSlot,
  added = false,
  statusLabel,
  playing = false,
  loadingPreview = false,
  adding = false,
  onPress,
  onTogglePreview,
  onRemove,
}) => {
  const T = useT();
  const { t } = useTranslation('voices');
  const styles = stylesFor(T);
  const pressable = !!onPress && !adding;
  const { translateY, onPressIn, onPressOut } = usePressSink(ROW_LIP, pressable);
  const code = languageCode ? languageCodeLabel(languageCode) : '';
  const okColor = T.chipOkFg;
  const status = added ? statusLabel ?? t('narrators.added') : null;

  const info = (
    <>
      <VoiceAvatar
        name={name}
        color={avatarSlot ? T.cat[avatarSlot].color : undefined}
        testID={`narrator-avatar-${id}`}
      />
      <View style={styles.flex}>
        <View style={styles.nameLine}>
          <Text style={styles.rowName} numberOfLines={1}>
            {name}
          </Text>
          {code ? (
            <View style={styles.code} testID={`narrator-code-${id}`}>
              <Text style={styles.codeText}>{code}</Text>
            </View>
          ) : null}
        </View>
        {status || line ? (
          <View style={styles.rowLine}>
            {added && !statusLabel ? <Icon name="check" size={16} color={okColor} /> : null}
            {/* One line: "Eklendi, Türkçe, kadın sesi", the state in its own colour. */}
            <Text style={[styles.rowSmall, styles.flexShrink]} numberOfLines={1}>
              {status ? (
                <Text
                  testID={`narrator-status-${id}`}
                  style={[styles.statusText, statusLabel ? null : { color: okColor }]}
                >
                  {status}
                </Text>
              ) : null}
              {status && line ? ', ' : null}
              {line}
            </Text>
          </View>
        ) : null}
      </View>
      {onPress ? (
        // The add's own place: the plus, or a spinner of the same size while it is added.
        <View testID={`narrator-plus-${id}`} style={styles.plus}>
          {adding ? (
            <Spinner size={ICON_SIZE_INLINE} color={T.text2} testID={`narrator-adding-${id}`} />
          ) : (
            <Icon name="plus" size={ICON_SIZE_INLINE} color={T.text2} />
          )}
        </View>
      ) : null}
    </>
  );

  return (
    <View testID={`narrator-${id}`} style={styles.rowOuter}>
      <View pointerEvents="none" testID={`narrator-${id}-lip`} style={styles.rowLip} />
      <Animated.View
        testID={`narrator-${id}-face`}
        style={[styles.rowFace, { transform: [{ translateY }] }]}
      >
        {onPress ? (
          <Pressable
            onPress={pressable ? onPress : undefined}
            onPressIn={onPressIn}
            onPressOut={onPressOut}
            unstable_pressDelay={PRESS_DELAY_MS}
            disabled={adding}
            accessibilityRole="button"
            accessibilityLabel={t('a11y.add', { name })}
            accessibilityState={{ disabled: adding, busy: adding }}
            testID={`narrator-add-${id}`}
            style={styles.rowInfo}
          >
            {info}
          </Pressable>
        ) : (
          <View style={styles.rowInfo}>{info}</View>
        )}
        {onRemove ? (
          <IconButton
            icon="trash"
            color={T.text2}
            size={22}
            onPress={onRemove}
            accessibilityLabel={t('a11y.remove', { name })}
            testID={`narrator-remove-${id}`}
          />
        ) : null}
        <CircleButton
          icon={playing ? 'stop' : 'play'}
          variant={playing ? 'action' : 'neutral'}
          size={42}
          busy={loadingPreview}
          onPress={onTogglePreview}
          accessibilityLabel={t(playing ? 'a11y.stopSample' : 'a11y.playSample', { name })}
          testID={`narrator-preview-${id}`}
        />
      </Animated.View>
    </View>
  );
};

/** A narrator row while the catalogue loads: the same height, corners, lip and tile. */
export const NarratorRowSkeleton: React.FC = () => (
  <RowSkeleton
    height={ROW_HEIGHT}
    radius={ROW_RADIUS}
    lip={ROW_LIP}
    leadingSize={NARRATOR_AVATAR}
    leadingRadius={RADIUS.sm}
  />
);

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    flex: { flex: 1, minWidth: 0 },
    flexShrink: { flexShrink: 1 },

    // The allowance card
    limitsContent: { padding: SPACE.lg, gap: SPACE.md },
    limitRow: {},
    limitTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SPACE.md },
    limitLabel: { flex: 1, minWidth: 0, fontFamily: T.fontLabel, fontSize: 13.5, lineHeight: 19, color: T.text },
    limitValue: {
      fontFamily: T.fontLabel,
      fontSize: 13.5,
      lineHeight: 19,
      color: T.text,
      fontVariant: ['tabular-nums'],
    },
    limitBar: { marginTop: SPACE.sm },
    limitCaption: { fontFamily: T.fontBody, fontSize: 12, lineHeight: 16, color: T.text3 },

    // A filled slot: the plain row card of `.nr` (surface face, standard lip)
    slotOuter: { paddingBottom: ROW_LIP },
    slotLip: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: ROW_LIP,
      bottom: 0,
      borderRadius: ROW_RADIUS,
      backgroundColor: T.lip,
    },
    slotFace: {
      minHeight: SLOT_HEIGHT,
      borderRadius: ROW_RADIUS,
      overflow: 'hidden',
      paddingVertical: SPACE.md,
      paddingLeft: SPACE.md,
      paddingRight: SPACE.xs,
      backgroundColor: T.surface,
      justifyContent: 'center',
    },
    slotRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    slotMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.tight,
      marginTop: SPACE.xxs,
      minHeight: SLOT_META_LINE,
    },
    slotMetaText: { flexShrink: 1, color: T.text2 },
    // The trash's 48dp target reaches the card edge; its glyph sits on the inset.
    slotControl: { marginLeft: -SPACE.xs },
    slotProblem: { marginTop: SPACE.md, gap: SPACE.sm, alignItems: 'flex-start', paddingRight: SPACE.sm },
    slotProblemText: { color: T.text },

    // The "Ses ekle" row: dashed, no fill, no lip
    emptySlot: {
      minHeight: EMPTY_SLOT_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      padding: SPACE.md,
      borderRadius: ROW_RADIUS,
      borderWidth: T.ring,
      borderStyle: 'dashed',
      borderColor: T.line,
    },
    emptySlotBlocked: { flexDirection: 'column', alignItems: 'stretch', gap: SPACE.sm },
    emptyBlockedRow: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md },
    emptyTile: {
      width: EMPTY_TILE,
      height: EMPTY_TILE,
      borderRadius: RADIUS.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: T.surface,
    },
    emptyTitleBlocked: { color: T.text2 },
    emptyLine: { marginTop: SPACE.xxs, color: T.text2 },
    // The text button pads its label by 12: the label starts under the title.
    emptySeePlans: { alignSelf: 'flex-start', marginLeft: EMPTY_TILE },

    // `.nr`
    rowOuter: { paddingBottom: ROW_LIP },
    rowLip: {
      position: 'absolute',
      left: 0,
      right: 0,
      top: ROW_LIP,
      bottom: 0,
      borderRadius: ROW_RADIUS,
      backgroundColor: T.lip,
    },
    rowFace: {
      minHeight: ROW_HEIGHT,
      borderRadius: ROW_RADIUS,
      backgroundColor: T.surface,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: SPACE.md,
      gap: SPACE.xs,
    },
    rowInfo: {
      flex: 1,
      minWidth: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.md,
      paddingVertical: SPACE.md,
    },
    nameLine: { flexDirection: 'row', alignItems: 'center', gap: SPACE.tight },
    rowName: {
      fontFamily: T.fontLabel,
      fontSize: 15,
      lineHeight: 20,
      color: T.text,
      flexShrink: 1,
    },
    code: {
      minHeight: 17,
      paddingHorizontal: SPACE.xs,
      borderRadius: RADIUS.xs,
      justifyContent: 'center',
      backgroundColor: T.line,
    },
    codeText: {
      fontFamily: T.fontLabel,
      fontSize: 10,
      lineHeight: 14,
      letterSpacing: 0.3,
      color: T.text2,
    },
    rowLine: { flexDirection: 'row', alignItems: 'center', gap: SPACE.xs, marginTop: SPACE.xxs },
    rowSmall: { fontFamily: T.fontBody, fontSize: 12.5, lineHeight: 17, color: T.text3 },
    statusText: { fontFamily: T.fontLabel, fontSize: 12, lineHeight: 17, color: T.text2 },
    // The plus of an addable row, before the sample button.
    plus: { paddingHorizontal: SPACE.xs },
  });

const stylesFor = themedStyles(makeStyles);
