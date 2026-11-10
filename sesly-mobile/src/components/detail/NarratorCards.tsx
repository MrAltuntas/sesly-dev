/**
 * NarratorCards: "Kimin sesiyle dinlesin?", the three narrator cards of the
 * story detail (`.narr` / `.nc` in design/v4/playful, frame c).
 *
 * The parent's own voice is always the first card (the wave avatar in the
 * own-voice colour); without one, the first card is the way to record it.
 * Then the ready-made narrators, their initial on a category colour. The
 * chosen card is raised (surface-2) with the action ring and a small check
 * badge. The narrator sheet ("Tümü") lists every voice.
 *
 * `CatalogueNarratorCards` is the row a user without any voice gets: the
 * first narrators of the catalogue in the same card look, each with its
 * sample under it. Tapping one adds it and selects it. `NarratorCardsSkeleton`
 * holds the row's place while the voices load.
 *
 * Both rows are memoised: the story page re-renders on every store change,
 * and with stable callbacks the cards are drawn again only when their
 * narrators, the choice or a sample change (V3-03).
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LIP, RADIUS, SPACE, Theme, themedStyles, useT } from '../../theme/theme';
import { Avatar, Bone, SkeletonPulse, Spinner, Tactile } from '../design';
import { circleLip } from '../design/feedback';
import {
  AvailableGoogleVoice,
  VoiceProfile,
  isCloneProfile,
  voiceMatchesLanguage,
} from '../../models/VoiceProfile';
import { StoryNarrators, getNarratorDisplay } from '../../models/Narrator';
import { contentLanguageNativeName } from '../../hooks/useContentLanguage';
import { presetPreviewKey } from '../voice/narratorRows';
import { NarratorAvatar } from './NarratorAvatar';
import { CheckBadge, SampleButton } from './SheetRow';

/** At most this many cards side by side (the mockup's row). */
export const NARRATOR_CARD_LIMIT = 3;
/** Face height of a narrator card. */
export const NARRATOR_CARD_HEIGHT = 96;
/** Diameter of the sample button under a catalogue card. */
const CARD_SAMPLE_SIZE = 36;

export interface NarratorCardModel {
  /** 'voice': a narrator to choose. 'addOwn': record the own voice. */
  readonly kind: 'voice' | 'addOwn';
  readonly profile: VoiceProfile | null;
}

/**
 * The cards of the row: the first own voice (of any language) or the
 * "record your voice" card, then the rest in the narrator sheet's order.
 * The chosen narrator is always on a card: when it is further down the
 * list it takes the last card.
 */
export function pickNarratorCards(
  narrators: StoryNarrators,
  selectedId: string | null,
): NarratorCardModel[] {
  if (narrators.all.length === 0) return [];
  const firstOwn =
    narrators.own[0] ?? narrators.other.find(profile => isCloneProfile(profile)) ?? null;
  const rest = narrators.all.filter(profile => profile !== firstOwn);
  const head: NarratorCardModel = firstOwn
    ? { kind: 'voice', profile: firstOwn }
    : { kind: 'addOwn', profile: null };
  const voices = rest.slice(0, NARRATOR_CARD_LIMIT - 1);
  const selected = rest.find(profile => profile.id === selectedId);
  if (selected && !voices.includes(selected)) voices[voices.length - 1] = selected;
  return [head, ...voices.map(profile => ({ kind: 'voice' as const, profile }))];
}

export interface NarratorCardsProps {
  cards: readonly NarratorCardModel[];
  selectedId: string | null;
  /** Content language of the story: a voice of another language says its language. */
  storyLanguage: string;
  onSelect: (profile: VoiceProfile) => void;
  onAddOwnVoice: () => void;
}

const NarratorCardsBase: React.FC<NarratorCardsProps> = ({
  cards,
  selectedId,
  storyLanguage,
  onSelect,
  onAddOwnVoice,
}) => {
  const T = useT();
  const { t } = useTranslation('detail');
  const styles = stylesFor(T);

  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('cards.title')} style={styles.row} testID="narrator-cards">
      {cards.map(card => {
        if (card.kind === 'addOwn' || !card.profile) {
          return (
            <Tactile
              key="add-own"
              color={T.surface}
              lipColor={T.lip}
              borderColor="transparent"
              radius={RADIUS.lg}
              onPress={onAddOwnVoice}
              accessibilityLabel={`${t('cards.addOwn')}, ${t('cards.addOwnHint')}`}
              testID="narrator-card-add-own"
              style={styles.card}
              faceStyle={styles.face}
            >
              <Avatar icon="mic" size={40} color={T.own} textColor={T.onCat} style={styles.avatar} />
              <Text numberOfLines={1} style={styles.name}>
                {t('cards.addOwn')}
              </Text>
              <Text numberOfLines={1} style={styles.small}>
                {t('cards.addOwnHint')}
              </Text>
            </Tactile>
          );
        }
        const profile = card.profile;
        const own = isCloneProfile(profile);
        const name = getNarratorDisplay(profile)?.name ?? profile.name;
        const selected = profile.id === selectedId;
        // "Senin sesin" / "Hazır anlatıcı"; a voice of another language
        // names its language instead.
        const hint = voiceMatchesLanguage(profile, storyLanguage)
          ? t(own ? 'cards.own' : 'cards.ready')
          : contentLanguageNativeName(profile.contentLanguage);
        return (
          <Tactile
            key={profile.id}
            color={selected ? T.surface2 : T.surface}
            lipColor={selected ? T.actionLip : T.lip}
            // The ring is always drawn, so the chosen card's content stays put.
            borderColor={selected ? T.action : 'transparent'}
            radius={RADIUS.lg}
            onPress={() => onSelect(profile)}
            accessibilityRole="radio"
            accessibilityLabel={`${name}, ${hint}`}
            accessibilityState={{ selected }}
            testID={`narrator-card-${profile.id}`}
            style={styles.card}
            faceStyle={styles.face}
          >
            <NarratorAvatar
              name={name}
              tone={own ? 'own' : 'ready'}
              colorKey={profile.voiceId || profile.id}
              style={styles.avatar}
              testID={`narrator-card-avatar-${profile.id}`}
            />
            <Text numberOfLines={1} style={styles.name}>
              {name}
            </Text>
            <Text numberOfLines={1} style={[styles.small, selected && styles.smallSelected]}>
              {hint}
            </Text>
            {selected ? <CheckBadge style={styles.check} testID="narrator-card-check" /> : null}
          </Tactile>
        );
      })}
    </View>
  );
};

export const NarratorCards = React.memo(NarratorCardsBase);
NarratorCards.displayName = 'NarratorCards';

export interface CatalogueNarratorCardsProps {
  /** The narrators to offer (the first NARRATOR_CARD_LIMIT are shown). */
  voices: readonly AvailableGoogleVoice[];
  /** Add the narrator to the user's voices, then select it. */
  onSelect: (voice: AvailableGoogleVoice) => void;
  onTogglePreview: (voice: AvailableGoogleVoice) => void;
  /** Sample keys (`presetPreviewKey`) of the sample playing and the one on its way. */
  previewPlayingKey?: string | null;
  previewLoadingKey?: string | null;
  /** Voice id of the narrator being added: its card shows a spinner, the others wait. */
  addingVoiceId?: string | null;
}

const CatalogueNarratorCardsBase: React.FC<CatalogueNarratorCardsProps> = ({
  voices,
  onSelect,
  onTogglePreview,
  previewPlayingKey = null,
  previewLoadingKey = null,
  addingVoiceId = null,
}) => {
  const T = useT();
  const { t } = useTranslation('detail');
  const styles = stylesFor(T);
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('cards.title')}
      style={styles.row}
      testID="narrator-catalogue-cards"
    >
      {voices.slice(0, NARRATOR_CARD_LIMIT).map(voice => {
        const key = presetPreviewKey(voice);
        const playing = previewPlayingKey === key;
        const adding = addingVoiceId === voice.voiceId;
        return (
          <View key={key} style={styles.card}>
            <Tactile
              color={T.surface}
              lipColor={T.lip}
              borderColor="transparent"
              radius={RADIUS.lg}
              onPress={() => onSelect(voice)}
              disabled={!!addingVoiceId}
              dimWhenDisabled={false}
              dimmed={!!addingVoiceId && !adding}
              accessibilityRole="radio"
              accessibilityLabel={`${voice.name}, ${t('cards.ready')}`}
              accessibilityState={{ selected: false, busy: adding }}
              testID={`narrator-catalogue-card-${voice.voiceId}`}
              faceStyle={styles.face}
            >
              <NarratorAvatar name={voice.name} colorKey={voice.voiceId} style={styles.avatar} />
              <Text numberOfLines={1} style={styles.name}>
                {voice.name}
              </Text>
              <Text numberOfLines={1} style={styles.small}>
                {t('cards.ready')}
              </Text>
              {adding ? (
                <View style={styles.check}>
                  <Spinner size={16} color={T.text2} testID={`narrator-catalogue-card-adding-${voice.voiceId}`} />
                </View>
              ) : null}
            </Tactile>
            <View style={styles.sample}>
              <SampleButton
                playing={playing}
                busy={previewLoadingKey === key}
                size={CARD_SAMPLE_SIZE}
                variant="neutral"
                onPress={() => onTogglePreview(voice)}
                accessibilityLabel={t(playing ? 'narratorSheet.stopPreview' : 'narratorSheet.preview', {
                  name: voice.name,
                })}
                testID={`narrator-catalogue-card-preview-${voice.voiceId}`}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
};

export const CatalogueNarratorCards = React.memo(CatalogueNarratorCardsBase);
CatalogueNarratorCards.displayName = 'CatalogueNarratorCards';

/**
 * The narrator row while the voices load: three card bones on their lips.
 * `samples`: the catalogue row's shape, with the sample button under each
 * card, so the row does not grow when the narrators arrive.
 */
export const NarratorCardsSkeleton: React.FC<{ testID?: string; samples?: boolean }> = ({
  testID = 'narrator-cards-loading',
  samples = false,
}) => {
  const T = useT();
  const styles = stylesFor(T);
  return (
    <SkeletonPulse testID={testID} style={styles.row}>
      {Array.from({ length: NARRATOR_CARD_LIMIT }, (_, i) =>
        samples ? (
          <View key={i} style={styles.card}>
            <Bone height={NARRATOR_CARD_HEIGHT} radius={RADIUS.lg} lip={LIP.md} />
            <View style={styles.sample}>
              <Bone
                width={CARD_SAMPLE_SIZE}
                height={CARD_SAMPLE_SIZE}
                radius={CARD_SAMPLE_SIZE / 2}
                lip={circleLip(CARD_SAMPLE_SIZE)}
              />
            </View>
          </View>
        ) : (
          <Bone key={i} height={NARRATOR_CARD_HEIGHT} radius={RADIUS.lg} lip={LIP.md} style={styles.card} />
        ),
      )}
    </SkeletonPulse>
  );
};

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    row: { flexDirection: 'row', gap: SPACE.sm },
    card: { flex: 1, minWidth: 0 },
    face: {
      minHeight: NARRATOR_CARD_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      // Inside the 2dp ring.
      paddingHorizontal: SPACE.xs,
      paddingVertical: SPACE.tight,
    },
    avatar: { marginBottom: SPACE.xs },
    name: { fontFamily: T.fontLabel, fontSize: 13.5, lineHeight: 18, color: T.text },
    small: { fontFamily: T.fontBody, fontSize: 11.5, lineHeight: 15, color: T.text3 },
    // Never text-3 on surface-2.
    smallSelected: { color: T.text2 },
    check: { position: 'absolute', top: SPACE.xs, right: SPACE.xs },
    sample: { alignItems: 'center', marginTop: SPACE.sm },
  }),
);
