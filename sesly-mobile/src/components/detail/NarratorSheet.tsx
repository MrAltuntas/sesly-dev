/**
 * NarratorSheet: every narrator a story can be read with.
 *
 * The voices of THIS story's language come first. "Senin sesin": the
 * user's own voices of that language, or the way to record one. "Hazır
 * anlatıcılar": the ready-made narrators of that language: the ones the
 * user already has (`readyNarrators`, from `narratorsForStory`) and then the
 * first narrators of the catalogue for that language (`catalogue`), which
 * the caller requests with the story's language. "Başka dildeki sesler": the
 * user's voices of other languages (`otherVoices`); they stay selectable, the
 * story detail explains what that sounds like. Every row names the language
 * of its voice on its second line, a ready-made narrator also its voice
 * ("Türkçe, kadın sesi"), added or not. Every ready-made narrator is free:
 * no lock, no plan badge, no quality tier. Choosing a row applies at once (a
 * catalogue narrator is added to the user's voices first); the caller
 * closes the sheet, and the new choice stays drawn while the sheet leaves
 * (the sheet's content is never frozen).
 *
 * The sheet has no title of its own: the section headings are its
 * structure, so it never opens on two headings in a row (V3-10). The list is
 * named "Anlatıcı" for screen readers (the radio group's label).
 *
 * The ready-made section holds at most `SHEET_READY_ROWS` rows (the added
 * narrators, then the catalogue); a longer catalogue ends in "Tümünü gör",
 * which opens the whole catalogue of the language (`onAddReadyNarrator`,
 * NarratorCatalogue), like the Sesim tab. A language has dozens of
 * narrators, and mounting every row made the sheet appear about two seconds
 * after the tap (V3-02). The rows are memoised with stable callbacks, so a
 * sample starting or a narrator being added redraws only the rows it
 * touches.
 *
 * The sheet opens at its final height (SPEC-design 2.2). While the
 * catalogue loads, the section is drawn as bones for every catalogue row it
 * can still hold plus "Tümünü gör", on the rows' own heights, so the loaded
 * rows replace them in place (a short catalogue may shrink it, never grow
 * it). A row's voice line is fixed when the row is first drawn: a gender
 * that arrives with the catalogue while the sheet is open is named on the
 * next open, never swapped in under the user's eyes. The story page asks for
 * the catalogue once its push has finished, so the first open usually has it.
 *
 * Rows are the `.nr` cards of design/v4/playful (see `SheetRow`): the own
 * voice with the wave avatar in the own-voice colour, ready-made narrators
 * with their initial on a category colour, a round sample button, and the
 * action ring with a check badge on the chosen one. The badge sits on the
 * avatar's corner, so every row keeps its sample button in one column.
 */

import React, { useCallback, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { LIP, RADIUS, SPACE, Theme, textStylesFor, themedStyles, useT } from '../../theme/theme';
import { Avatar, BottomSheet, Icon, RowSkeleton, SectionHeader, SkeletonPulse, Spinner } from '../design';
import { circleLip } from '../design/feedback';
import type { IconName } from '../design';
import { AvailableGoogleVoice, VoiceProfile, isCloneProfile } from '../../models/VoiceProfile';
import { narratorLine, presetPreviewKey } from '../voice/narratorRows';
import { getNarratorDisplay } from '../../models/Narrator';
import { contentLanguageLabel, contentLanguageNativeName } from '../../hooks/useContentLanguage';
import { NarratorAvatar, roundedAvatarRadius } from './NarratorAvatar';
import { CheckBadge, SAMPLE_BUTTON_SIZE, SampleButton, SheetRow, sheetRowHeight } from './SheetRow';

/** Avatar of a sheet row: the 40dp leading tile of a row card (SPEC-design 1.4). */
const ROW_AVATAR = 40;
/** The check badge on the avatar's corner. */
const ROW_CHECK = 20;

/**
 * Rows of the ready-made section before "Tümünü gör": the added narrators
 * first, then the catalogue (the Sesim tab shows six too).
 */
export const SHEET_READY_ROWS = 6;

/**
 * Tallest part of a narrator row: the sample button on its lip. The loading
 * bones are this tall, so the rows land on their height.
 */
const CATALOGUE_ROW_CONTENT = SAMPLE_BUTTON_SIZE + circleLip(SAMPLE_BUTTON_SIZE);
/**
 * Tallest part of the "Tümünü gör" row: the 40dp tile (its two text lines,
 * 21 + 2 + 17, are as tall; the chevron is shorter).
 */
const SEE_ALL_ROW_CONTENT = ROW_AVATAR;

/** Catalogue rows the ready-made section holds after the `added` narrators. */
export function sheetCatalogueRoom(added: number): number {
  return Math.max(0, SHEET_READY_ROWS - added);
}

/**
 * The catalogue narrators the sheet lists: enough to fill the ready-made
 * section up to `SHEET_READY_ROWS` after the `added` ones, never fewer than
 * none. `more` is true when the catalogue has more than that.
 */
export function sheetCatalogueRows<V>(
  added: number,
  catalogue: readonly V[],
): { shown: readonly V[]; more: boolean } {
  const room = sheetCatalogueRoom(added);
  const shown = catalogue.length > room ? catalogue.slice(0, room) : catalogue;
  return { shown, more: shown.length < catalogue.length };
}

/** "12 Ekim kaydı": the day a voice was recorded. '' for an invalid date. */
export function recordingDateLabel(
  date: Date | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return t('narratorSheet.recordedOn', {
    day: date.getDate(),
    month: t(`month.${date.getMonth() + 1}`),
  });
}

export interface NarratorSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The exit finished (the window is gone). */
  onClosed?: () => void;
  /** The user's own READY voices of the story's language. */
  ownVoices: readonly VoiceProfile[];
  /**
   * READY voices of other languages (own voices, then added ready-made
   * narrators), listed last under "Başka dildeki sesler".
   */
  otherVoices?: readonly VoiceProfile[];
  /**
   * The user has an own voice in some language. Decides how the way to a
   * new recording is worded when `ownVoices` is empty. Default: `ownVoices`
   * has one.
   */
  hasOwnVoice?: boolean;
  /** READY ready-made narrators of the story's language. */
  readyNarrators: readonly VoiceProfile[];
  /**
   * Narrators of the story's language the user has not added yet
   * (`GET /voice-profiles/available-voices?language=`). The first ones are
   * shown after `readyNarrators`.
   */
  catalogue?: readonly AvailableGoogleVoice[];
  /**
   * The voice ("female", "male") of a ready-made narrator by its voice id,
   * from the catalogues that are loaded: an added narrator names its voice
   * like the ones not added yet. Read when the row is first drawn (see the
   * file comment).
   */
  voiceGenders?: ReadonlyMap<string, string>;
  /** The catalogue is being requested and nothing is listed yet. */
  catalogueLoading?: boolean;
  /** Choose a catalogue narrator: the caller adds it, then selects it. */
  onSelectCatalogue?: (voice: AvailableGoogleVoice) => void;
  onToggleCataloguePreview?: (voice: AvailableGoogleVoice) => void;
  /** Voice id of the catalogue narrator that is being added. */
  addingVoiceId?: string | null;
  selectedId: string | null;
  /** Content language of the story (ISO code), named in the footnote. */
  storyLanguage: string;
  onSelect: (profile: VoiceProfile) => void;
  /** Starts the own-voice flow (slot check, then CreateVoiceProfile). */
  onAddOwnVoice: () => void;
  /** Opens the ready-made narrator catalogue ("Hazır anlatıcı ekle", "Tümünü gör"). */
  onAddReadyNarrator: () => void;
  onTogglePreview: (profile: VoiceProfile) => void;
  previewPlayingId?: string | null;
  previewLoadingId?: string | null;
}

// ─────────────────────────────────────────────────────────────
// Rows (memoised: only a row whose props changed is drawn again)
// ─────────────────────────────────────────────────────────────

interface VoiceRowProps {
  profile: VoiceProfile;
  /** Drawn as the user's own voice (wave avatar, recording date). */
  own: boolean;
  /** Voice of a ready-made narrator from the loaded catalogues ("female"). */
  gender: string | undefined;
  selected: boolean;
  playing: boolean;
  busy: boolean;
  onSelect: (profile: VoiceProfile) => void;
  onTogglePreview: (profile: VoiceProfile) => void;
}

const VoiceRow = React.memo(function VoiceRow({
  profile,
  own,
  gender,
  selected,
  playing,
  busy,
  onSelect,
  onTogglePreview,
}: VoiceRowProps) {
  const T = useT();
  const { t } = useTranslation('detail');
  const styles = stylesFor(T);
  const display = getNarratorDisplay(profile);
  const name = display?.name ?? profile.name;
  // The voice as the row was first drawn: a catalogue that arrives while the
  // sheet is open never rewrites "Türkçe" into "Türkçe, kadın sesi" under
  // the user's eyes. The sheet's rows mount with every open, so the next
  // open names the voice.
  const [shownGender] = useState(gender);
  // "Türkçe, 12 Ekim kaydı" / "Türkçe, kadın sesi": the language of the
  // voice, in its own name, then what tells this voice from the next.
  const subtitle = own
    ? [contentLanguageNativeName(profile.contentLanguage), recordingDateLabel(profile.createdAt, t)]
        .filter(Boolean)
        .join(', ')
    : narratorLine({ ...profile, name, gender: shownGender });
  return (
    <SheetRow
      title={name}
      subtitle={subtitle}
      selected={selected}
      onPress={() => onSelect(profile)}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      testID={`narrator-row-${profile.id}`}
      style={styles.row}
      leading={
        <View style={styles.avatarSlot}>
          <NarratorAvatar
            name={name}
            tone={own ? 'own' : 'ready'}
            colorKey={profile.voiceId || profile.id}
            size={ROW_AVATAR}
            shape="rounded"
            testID={`narrator-avatar-${profile.id}`}
          />
          {selected ? (
            <CheckBadge size={ROW_CHECK} style={styles.check} testID={`narrator-check-${profile.id}`} />
          ) : null}
        </View>
      }
      trailing={
        <SampleButton
          playing={playing}
          busy={busy}
          onPress={() => onTogglePreview(profile)}
          accessibilityLabel={t(playing ? 'narratorSheet.stopPreview' : 'narratorSheet.preview', { name })}
          testID={`narrator-preview-${profile.id}`}
        />
      }
    />
  );
});

interface CatalogueRowProps {
  voice: AvailableGoogleVoice;
  playing: boolean;
  busy: boolean;
  /** This narrator is being added. */
  adding: boolean;
  /** A narrator (this one or another) is being added: every row waits. */
  locked: boolean;
  onSelect: (voice: AvailableGoogleVoice) => void;
  onTogglePreview: (voice: AvailableGoogleVoice) => void;
}

// A narrator of the catalogue: same row, chosen by adding it first.
const CatalogueRow = React.memo(function CatalogueRow({
  voice,
  playing,
  busy,
  adding,
  locked,
  onSelect,
  onTogglePreview,
}: CatalogueRowProps) {
  const T = useT();
  const { t } = useTranslation('detail');
  const styles = stylesFor(T);
  const subtitle = narratorLine(voice);
  return (
    <SheetRow
      title={voice.name}
      subtitle={subtitle}
      onPress={() => onSelect(voice)}
      disabled={locked}
      dimmed={locked && !adding}
      accessibilityRole="radio"
      accessibilityState={{ selected: false, busy: adding }}
      testID={`narrator-catalogue-${voice.voiceId}`}
      style={styles.row}
      leading={
        <View style={styles.avatarSlot}>
          <NarratorAvatar name={voice.name} colorKey={voice.voiceId} size={ROW_AVATAR} shape="rounded" />
          {adding ? (
            <View style={styles.adding}>
              <Spinner size={ROW_CHECK} color={T.onCat} testID={`narrator-catalogue-adding-${voice.voiceId}`} />
            </View>
          ) : null}
        </View>
      }
      trailing={
        <SampleButton
          playing={playing}
          busy={busy}
          onPress={() => onTogglePreview(voice)}
          accessibilityLabel={t(playing ? 'narratorSheet.stopPreview' : 'narratorSheet.preview', {
            name: voice.name,
          })}
          testID={`narrator-catalogue-preview-${voice.voiceId}`}
        />
      }
    />
  );
});

// ─────────────────────────────────────────────────────────────
// Sheet
// ─────────────────────────────────────────────────────────────

const NarratorSheetBase: React.FC<NarratorSheetProps> = ({
  visible,
  onClose,
  onClosed,
  ownVoices,
  otherVoices = [],
  hasOwnVoice,
  readyNarrators,
  catalogue = [],
  voiceGenders,
  catalogueLoading = false,
  onSelectCatalogue,
  onToggleCataloguePreview,
  addingVoiceId = null,
  selectedId,
  storyLanguage,
  onSelect,
  onAddOwnVoice,
  onAddReadyNarrator,
  onTogglePreview,
  previewPlayingId = null,
  previewLoadingId = null,
}) => {
  const T = useT();
  const { t } = useTranslation('detail');
  const styles = stylesFor(T);
  const text = textStylesFor(T);

  // The rows get callbacks that never change, so a caller passing new
  // functions on every render does not draw every row again.
  const latest = useRef({ onSelect, onTogglePreview, onSelectCatalogue, onToggleCataloguePreview });
  latest.current = { onSelect, onTogglePreview, onSelectCatalogue, onToggleCataloguePreview };
  const select = useCallback((profile: VoiceProfile) => latest.current.onSelect(profile), []);
  const togglePreview = useCallback((profile: VoiceProfile) => latest.current.onTogglePreview(profile), []);
  const selectCatalogue = useCallback(
    (voice: AvailableGoogleVoice) => latest.current.onSelectCatalogue?.(voice),
    [],
  );
  const toggleCataloguePreview = useCallback(
    (voice: AvailableGoogleVoice) => latest.current.onToggleCataloguePreview?.(voice),
    [],
  );

  const voiceRow = (profile: VoiceProfile, own: boolean) => (
    <VoiceRow
      key={profile.id}
      profile={profile}
      own={own}
      gender={own ? undefined : voiceGenders?.get(profile.voiceId)}
      selected={profile.id === selectedId}
      playing={previewPlayingId === profile.id}
      busy={previewLoadingId === profile.id}
      onSelect={select}
      onTogglePreview={togglePreview}
    />
  );

  const catalogueRow = (voice: AvailableGoogleVoice) => {
    const key = presetPreviewKey(voice);
    return (
      <CatalogueRow
        key={key}
        voice={voice}
        playing={previewPlayingId === key}
        busy={previewLoadingId === key}
        adding={addingVoiceId === voice.voiceId}
        locked={!!addingVoiceId}
        onSelect={selectCatalogue}
        onTogglePreview={toggleCataloguePreview}
      />
    );
  };

  const renderAdd = (label: string, icon: IconName, own: boolean, onPress: () => void, testID: string) => (
    <SheetRow
      title={label}
      onPress={onPress}
      testID={testID}
      style={styles.row}
      leading={
        <Avatar
          icon={icon}
          size={ROW_AVATAR}
          shape="rounded"
          color={own ? T.own : T.surface}
          textColor={own ? T.onCat : T.text}
          style={styles.addTile}
          testID={`${testID}-tile`}
        />
      }
    />
  );

  const hasOwn = ownVoices.length > 0;
  const hasAnyOwn = hasOwnVoice ?? hasOwn;
  const { shown: shownCatalogue, more: moreCatalogue } = sheetCatalogueRows(readyNarrators.length, catalogue);

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      contentStyle={styles.content}
      testID="narrator-sheet"
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('narratorSheet.title')}
        contentContainerStyle={styles.scroll}
        testID="narrator-sheet-list"
      >
        <SectionHeader size="sub" title={t('narratorSheet.own')} style={styles.firstSection} />
        {hasOwn
          ? ownVoices.map(profile => voiceRow(profile, true))
          : renderAdd(
              t(hasAnyOwn ? 'narratorSheet.addNew' : 'narratorSheet.addOwn'),
              'mic',
              true,
              onAddOwnVoice,
              'narrator-add-own',
            )}

        <SectionHeader size="sub" title={t('narratorSheet.ready')} style={styles.section} />
        {readyNarrators.map(profile => voiceRow(profile, false))}
        {shownCatalogue.map(catalogueRow)}
        {moreCatalogue ? (
          // The rest of the catalogue: its own screen, virtualised.
          <SheetRow
            title={t('narratorSheet.seeAll')}
            subtitle={t('narratorSheet.seeAllHint', { total: readyNarrators.length + catalogue.length })}
            onPress={onAddReadyNarrator}
            disabled={!!addingVoiceId}
            dimmed={!!addingVoiceId}
            testID="narrator-see-all"
            style={styles.row}
            leading={
              <Avatar
                icon="more"
                size={ROW_AVATAR}
                shape="rounded"
                color={T.surface}
                textColor={T.text}
                style={styles.addTile}
                testID="narrator-see-all-tile"
              />
            }
            trailing={
              <View style={styles.trailingIcon}>
                <Icon name="chevronRight" size={20} color={T.text2} />
              </View>
            }
          />
        ) : null}
        {catalogueLoading && catalogue.length === 0 ? (
          // The final geometry (SPEC-design 2.2): a bone for every catalogue
          // row the section can still hold and one for "Tümünü gör", each on
          // the height and margin of the row it stands for. The narrators
          // replace them in place; a shorter catalogue may shrink the sheet,
          // the loaded one never makes it grow.
          <SkeletonPulse testID="narrator-catalogue-loading" label={t('narratorSheet.loadingReady')}>
            {Array.from({ length: sheetCatalogueRoom(readyNarrators.length) }, (_, i) => (
              <RowSkeleton
                key={i}
                tone="raised"
                height={sheetRowHeight(CATALOGUE_ROW_CONTENT, T.ring)}
                radius={RADIUS.lg}
                lip={LIP.md}
                leadingSize={ROW_AVATAR}
                leadingRadius={roundedAvatarRadius(ROW_AVATAR)}
                style={styles.row}
              />
            ))}
            <RowSkeleton
              tone="raised"
              height={sheetRowHeight(SEE_ALL_ROW_CONTENT, T.ring)}
              radius={RADIUS.lg}
              lip={LIP.md}
              leadingSize={ROW_AVATAR}
              leadingRadius={roundedAvatarRadius(ROW_AVATAR)}
              trailing={false}
              style={styles.row}
            />
          </SkeletonPulse>
        ) : null}
        {/* Nothing to list (the catalogue could not be loaded, or has no
            narrator for this language): the voice list is the way in. */}
        {readyNarrators.length === 0 && catalogue.length === 0 && !catalogueLoading
          ? renderAdd(t('narratorSheet.addReady'), 'plus', false, onAddReadyNarrator, 'narrator-add-ready')
          : null}

        {/* With no own voice the first section already offers the same flow. */}
        {hasOwn ? renderAdd(t('narratorSheet.addNew'), 'plus', false, onAddOwnVoice, 'narrator-add-new') : null}

        {/* Voices of another language: never hidden, listed after the rest. */}
        {otherVoices.length > 0 ? (
          <View testID="narrator-other-languages">
            <SectionHeader size="sub" title={t('narratorSheet.otherLanguages')} style={styles.section} />
            {otherVoices.map(profile => voiceRow(profile, isCloneProfile(profile)))}
          </View>
        ) : null}

        <Text style={[text.bodySmall, styles.note]}>
          {t('narratorSheet.footnote', { language: contentLanguageLabel(storyLanguage) })}
        </Text>
      </ScrollView>
    </BottomSheet>
  );
};

/** Memoised: the story page re-renders often while the sheet is closed. */
export const NarratorSheet = React.memo(NarratorSheetBase);
NarratorSheet.displayName = 'NarratorSheet';

const stylesFor = themedStyles((T: Theme) =>
  StyleSheet.create({
    content: { paddingHorizontal: 0 },
    scroll: { paddingHorizontal: T.screenPadH, paddingBottom: SPACE.xs },
    // The first heading of the sheet, just under the handle.
    firstSection: { marginTop: SPACE.xs, marginBottom: SPACE.md },
    section: { marginTop: SPACE.xl, marginBottom: SPACE.md },
    row: { marginBottom: SPACE.md },
    note: { marginTop: SPACE.md, marginBottom: SPACE.xs },
    avatarSlot: { width: ROW_AVATAR, height: ROW_AVATAR },
    addTile: { borderRadius: roundedAvatarRadius(ROW_AVATAR) },
    check: { position: 'absolute', top: -SPACE.xs, right: -SPACE.xs },
    adding: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
    // In the sample buttons' column, so the chevron lines up with them.
    trailingIcon: { width: SAMPLE_BUTTON_SIZE, alignItems: 'center', justifyContent: 'center' },
  }),
);
