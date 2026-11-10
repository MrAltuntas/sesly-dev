/**
 * ProfileScreen: profile and settings as ONE screen (design/v4/playful; no
 * frame of its own, restyled in the system of the Sesim frame).
 *
 * Reached from the avatar on the tab screens. Top to bottom:
 *
 *   back bar, the account card (avatar, name, e-mail; a press opens the name
 *   sheet), the plan card (the GET /usage meters, skeleton rows while they
 *   load, the plan's limits when they cannot be read), a card with Masal
 *   dili and Uygulama dili, the Renk paleti picker, a card with Bildirimler
 *   (the permission notice and the two switches), a card with Yasal
 *   belgeler, Bize ulaşın and Önbelleği temizle, then Çıkış yap
 *   (secondary), Hesabı sil (danger) and the version.
 *
 * Profile, Notifications, Subscription and DataDeletion open through
 * `navigateSingleton`, so the stack never holds two of them. The account
 * deletion flow stays a pushed screen (`DataDeletion`).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { observer } from 'mobx-react-lite';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { RADIUS, SPACE, Theme, themedStyles, useT, useTextStyles } from '../../theme/theme';
import { PalettePicker } from '../../components/profile/PalettePicker';
import {
  Avatar,
  BottomSheet,
  Button,
  Card,
  Icon,
  SectionHeader,
  SegmentedControl,
  Bone,
  SkeletonPulse,
  SurfaceLevelProvider,
  TextBones,
  SwitchRow,
  TopAppBar,
} from '../../components/design';
import { LegalSheet } from '../../components/design/LegalSheet';
import {
  ROW_LABEL_INSET,
  ROW_PAD_H,
  SETTING_ROW_MIN_HEIGHT,
  SettingRow,
  SettingsGroup,
} from '../../components/profile/SettingRow';
import { PlanUsageCard, PlanUsageMeters } from '../../components/profile/PlanUsageCard';
import { ChoiceSheet } from '../../components/profile/ChoiceSheet';
import { NameEditSheet } from '../../components/profile/NameEditSheet';
import { SUPPORT_EMAIL, formatBytes, supportMailUrl } from '../../components/profile/support';
import { useDialog } from '../../hooks/useDialog';
import { useAuth } from '../../hooks/useAuth';
import { useSubscription } from '../../hooks/useSubscription';
import { useNotifications } from '../../hooks/useNotifications';
import { useContentLanguage } from '../../hooks/useContentLanguage';
import { setUiLanguage } from '../../i18n';
import { UI_LANGUAGES, UI_LANGUAGE_NAMES, UiLanguage } from '../../i18n/language';
import { currentLanguage, initialOf } from '../../i18n/text';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { navigateSingleton } from '../../navigation/navigateSingleton';
import { getUserFullName } from '../../models/User';
import type { LegalSlug } from '../../models/Legal';
import type { UserPreferences } from '../../models/UserPreferences';
import userPreferencesService from '../../services/UserPreferencesService';
import PushNotificationService, {
  PushPermissionStatus,
} from '../../services/PushNotificationService';
import CacheService from '../../services/CacheService';
import { getAppVersion } from '../../utils/appVersion';
import { createTestCrashTrigger } from '../../services/crashReporting';
import { showToast } from '../../utils/toast';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type NotificationPrefKey = 'narrationReadyNotifications' | 'voiceReadyNotifications';

/** A segmented control fits the row up to this many languages. */
export const MAX_LANGUAGE_SEGMENTS = 3;

const LEGAL_DOCUMENTS: readonly { slug: LegalSlug; labelKey: string }[] = [
  { slug: 'tos', labelKey: 'legal.tos' },
  { slug: 'privacy', labelKey: 'legal.privacy' },
  { slug: 'data-deletion', labelKey: 'legal.dataDeletion' },
];

const ProfileScreen: React.FC = observer(() => {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const T = useT();
  const styles = stylesFor(T);
  const text = useTextStyles();
  const { t } = useTranslation('profile');
  const { showDialog } = useDialog();
  const authStore = useAuth();
  const subscriptionStore = useSubscription();
  const notificationsStore = useNotifications();
  const contentLanguageStore = useContentLanguage();
  const uiLanguage = currentLanguage();

  // ── Account ─────────────────────────────────────────────────
  // The names the user gave, then the sign-in name, then a neutral one;
  // never the e-mail's local part (a private relay address is a random id).
  const backendUser = authStore.backendUser;
  const fullName =
    (backendUser && getUserFullName(backendUser)) ||
    authStore.user?.displayName?.trim() ||
    t('fallbackName');
  const email = backendUser?.email ?? authStore.user?.email ?? '';
  const [nameSheetOpen, setNameSheetOpen] = useState(false);

  // ── Plan and usage (GET /usage) ─────────────────────────────
  const planId = subscriptionStore.planId;
  const usage = subscriptionStore.usage;
  const meters: PlanUsageMeters | null = usage
    ? { preset: usage.buckets.presetNarrations, cloned: usage.buckets.cloneNarrations }
    : null;
  const usageLoading = !usage && !subscriptionStore.usageError;

  // ── Fresh on every focus: the unread count, and usage older than a minute ──
  useFocusEffect(
    useCallback(() => {
      void notificationsStore.refreshUnreadCount();
      void subscriptionStore.loadUsageIfStale();
    }, [notificationsStore, subscriptionStore]),
  );
  const unread = notificationsStore.unreadCount;

  // ── Content language ("Masal dili") ─────────────────────────
  // Asked again every time the profile opens: the enabled languages are a
  // panel setting, and the row only exists once two of them have stories.
  // Without a pick the row shows the language in use (the UI language when
  // it has stories); a pick overrides it.
  useEffect(() => {
    void contentLanguageStore.load(true);
  }, [contentLanguageStore]);
  const contentLanguages = contentLanguageStore.pickableLanguages;
  const [languageSheetOpen, setLanguageSheetOpen] = useState(false);
  const languageOptions = useMemo(
    () => contentLanguages.map(language => ({ value: language.code, label: language.nativeName })),
    [contentLanguages],
  );

  // The store updates at once and rolls back when the backend refuses.
  const handleContentLanguage = useCallback(
    (code: string) => {
      contentLanguageStore.setContentLanguage(code).catch(err => {
        console.warn('Content language change failed:', err);
        showToast.error(t('contentLanguage.saveFailed'));
      });
    },
    [contentLanguageStore, t],
  );

  // ── App language ────────────────────────────────────────────
  // The segmented control moves its pill at the press and hands the choice
  // over in the next frame, so the whole-app re-render of a language switch
  // never holds the pill back.
  const uiLanguageSegments = useMemo(
    () => UI_LANGUAGES.map(value => ({ value, label: UI_LANGUAGE_NAMES[value] })),
    [],
  );

  // ── Notification preferences (GET / PATCH /users/me/preferences) ──
  // The sync cache draws the switches in the first frame; without it the
  // skeleton is there from the first frame too.
  const [prefs, setPrefs] = useState<UserPreferences | null>(() =>
    userPreferencesService.getCachedSync(),
  );
  const [prefsLoading, setPrefsLoading] = useState(prefs === null);
  const [prefsFailed, setPrefsFailed] = useState(false);
  const [pendingPrefKey, setPendingPrefKey] = useState<NotificationPrefKey | null>(null);

  const loadPrefs = useCallback(async () => {
    setPrefsLoading(true);
    setPrefsFailed(false);
    try {
      setPrefs(await userPreferencesService.get());
    } catch (err) {
      // The service already fell back to its cache; this is "nothing known".
      console.warn('Failed to load notification preferences:', err);
      setPrefsFailed(true);
    } finally {
      setPrefsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPrefs();
  }, [loadPrefs]);

  const togglePref = useCallback(
    async (key: NotificationPrefKey, nextValue: boolean) => {
      if (!prefs) return;
      // Optimistic: flip now, put it back when the backend refuses.
      const previous = prefs;
      setPrefs({ ...prefs, [key]: nextValue });
      setPendingPrefKey(key);
      try {
        setPrefs(await userPreferencesService.update({ [key]: nextValue }));
      } catch (err) {
        console.warn('Preference toggle failed:', err);
        setPrefs(previous);
        showToast.error(t('notifications.saveFailed'));
      } finally {
        setPendingPrefKey(null);
      }
    },
    [prefs, t],
  );

  // The switches are server-side preferences; the OS permission is a separate
  // gate. Read it again when the app returns from the system settings.
  const [pushStatus, setPushStatus] = useState<PushPermissionStatus | null>(null);
  const [pushRequesting, setPushRequesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const readStatus = () => {
      PushNotificationService.getPermissionStatus()
        .then(status => {
          if (!cancelled) setPushStatus(status);
        })
        .catch(() => undefined);
    };
    readStatus();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active') readStatus();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  // Undetermined: the system dialog. Denied: the system settings page (the
  // OS does not show the dialog again).
  const handlePushPermission = useCallback(async () => {
    setPushRequesting(true);
    try {
      setPushStatus(await PushNotificationService.requestPermissionFromSettings());
    } finally {
      setPushRequesting(false);
    }
  }, []);

  // ── Legal documents ─────────────────────────────────────────
  const [legalListOpen, setLegalListOpen] = useState(false);
  const [legalSlug, setLegalSlug] = useState<LegalSlug | null>(null);

  // ── Sign out ────────────────────────────────────────────────
  // The dialog closes at the press; from then until Login replaces this
  // screen (the store stays busy after the session is dropped, so the
  // frames before the navigator switches never show an idle button) the
  // button says so and the account actions take no second press.
  const signingOut = authStore.isSigningOut;
  const handleSignOut = () => {
    if (authStore.isSigningOut) return;
    showDialog({
      title: t('signOut.label'),
      message: t('signOut.message'),
      buttons: [
        {
          text: t('signOut.label'),
          style: 'destructive',
          onPress: async () => {
            try {
              await authStore.signOut();
            } catch {
              // The store already told the user.
            }
          },
        },
        { text: t('common:cancel'), style: 'cancel' },
      ],
    });
  };

  // ── Contact ─────────────────────────────────────────────────
  const handleContact = useCallback(() => {
    Linking.openURL(supportMailUrl(t('contact.subject'))).catch(() => {
      showDialog({
        title: t('contact.failedTitle'),
        message: t('contact.failedMessage', { email: SUPPORT_EMAIL }),
        buttons: [{ text: t('common:ok') }],
      });
    });
  }, [showDialog, t]);

  // ── Cache ───────────────────────────────────────────────────
  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const [cacheClearing, setCacheClearing] = useState(false);

  const loadCacheSize = useCallback(async () => {
    try {
      const size = await CacheService.getCacheSize();
      setCacheSize(size.total);
    } catch (err) {
      console.warn('Failed to load cache size:', err);
    }
  }, []);

  useEffect(() => {
    void loadCacheSize();
  }, [loadCacheSize]);

  const handleClearCache = useCallback(() => {
    // Nothing to clear: no question to answer.
    if (cacheSize === 0) {
      showToast.info(t('cache.empty'));
      return;
    }
    showDialog({
      title: t('cache.label'),
      message: t('cache.message'),
      buttons: [
        {
          text: t('cache.confirm'),
          style: 'destructive',
          onPress: async () => {
            setCacheClearing(true);
            try {
              await CacheService.clearAllCache();
              setCacheSize(0);
              showToast.success(t('cache.cleared'));
            } catch (err) {
              console.warn('Failed to clear cache:', err);
              showToast.error(t('cache.failed'));
            } finally {
              setCacheClearing(false);
              void loadCacheSize();
            }
          },
        },
        { text: t('common:cancel'), style: 'cancel' },
      ],
    });
  }, [cacheSize, loadCacheSize, showDialog, t]);

  // ── Pull to refresh ─────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        subscriptionStore.refresh(),
        notificationsStore.refreshUnreadCount(),
        loadPrefs(),
        loadCacheSize(),
        contentLanguageStore.load(true),
      ]);
    } catch (err) {
      console.warn('Profile refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [subscriptionStore, notificationsStore, loadPrefs, loadCacheSize, contentLanguageStore]);

  const version = getAppVersion();
  const [testCrash] = useState(createTestCrashTrigger);
  const pushDenied = pushStatus === 'denied';
  const permissionMissing = pushDenied || pushStatus === 'undetermined';

  return (
    <View style={styles.container} testID="profile-screen">
      <TopAppBar variant="back" title={t('title')} onBack={() => nav.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + SPACE.xxl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={T.action}
            colors={[T.action]}
            progressBackgroundColor={T.surface}
          />
        }
      >
        {/* Account: a press opens the name sheet (the greeting uses it). */}
        <Card
          testID="profile-account"
          onPress={backendUser ? () => setNameSheetOpen(true) : undefined}
          accessibilityLabel={
            backendUser ? [fullName, email, t('name.title')].filter(Boolean).join(', ') : undefined
          }
          style={styles.card}
          contentStyle={styles.account}
        >
          <Avatar initial={initialOf(fullName)} size={56} testID="profile-avatar" />
          <View style={styles.accountText}>
            <Text accessibilityRole="header" numberOfLines={2} style={text.heading}>
              {fullName}
            </Text>
            {email ? (
              <Text numberOfLines={1} style={text.bodySmall}>
                {email}
              </Text>
            ) : null}
          </View>
          {backendUser ? (
            <Icon name="chevronRight" size={20} color={T.text3} testID="profile-account-chevron" />
          ) : null}
        </Card>

        {/* Plan and usage */}
        <PlanUsageCard
          planId={planId}
          meters={meters}
          loading={usageLoading}
          onSeePlans={() => navigateSingleton(nav, 'Subscription')}
          testID="profile-plan"
        />

        {/* Languages */}
        <SettingsGroup testID="profile-group-language">
          {/* Masal dili: needs at least two languages with stories to be a
              choice. With one (or while the list could not be loaded)
              nothing is drawn: a row with a single option would be a dead
              control. */}
          {contentLanguages.length >= 2 ? (
            contentLanguages.length <= MAX_LANGUAGE_SEGMENTS ? (
              <SettingRow
                icon="language"
                label={t('contentLanguage.label')}
                testID="profile-content-language"
                trailing={
                  <SegmentedControl
                    compact
                    segments={languageOptions}
                    value={contentLanguageStore.selectable}
                    onChange={handleContentLanguage}
                    accessibilityLabel={t('contentLanguage.label')}
                  />
                }
              />
            ) : (
              <SettingRow
                icon="language"
                label={t('contentLanguage.label')}
                value={contentLanguageStore.nativeName(contentLanguageStore.selectable)}
                chevron
                onPress={() => setLanguageSheetOpen(true)}
                testID="profile-content-language"
              />
            )
          ) : null}

          {/* Uygulama dili */}
          <SettingRow
            icon="text"
            label={t('uiLanguage.label')}
            testID="profile-ui-language"
            trailing={
              <SegmentedControl<UiLanguage>
                compact
                segments={uiLanguageSegments}
                value={uiLanguage}
                onChange={next => setUiLanguage(next)}
                accessibilityLabel={t('uiLanguage.label')}
              />
            }
          />
        </SettingsGroup>

        {/* Renk paleti: the user's choice of palette, kept on the device. */}
        <View style={styles.paletteBlock} testID="profile-palette">
          <SectionHeader title={t('palette.label')} size="sub" style={styles.paletteTitle} />
          <PalettePicker />
        </View>

        {/* Bildirimler */}
        <SettingsGroup testID="profile-group-notifications">
          <SettingRow
            icon="bell"
            label={t('notifications.label')}
            value={unread > 0 ? t('notifications.unread', { unread }) : undefined}
            chevron
            onPress={() => navigateSingleton(nav, 'Notifications')}
            testID="profile-notifications"
          />
          {permissionMissing ? (
            // A surface2 box: its controls take the next step up (SPEC-design 1.6.1).
            <SurfaceLevelProvider level="surface2">
              <View style={styles.permission} testID="profile-push-permission">
                <View style={styles.permissionHead}>
                  {/* Never asked yet: a question, not a warning. */}
                  {pushDenied ? (
                    <Icon name="alert" size={20} color={T.warning} />
                  ) : (
                    <Icon name="bell" size={20} color={T.text2} />
                  )}
                  <Text style={styles.permissionTitle}>
                    {pushDenied
                      ? t('notifications.permission.deniedTitle')
                      : t('notifications.permission.neededTitle')}
                  </Text>
                </View>
                <Text style={styles.permissionMessage}>
                  {pushDenied
                    ? t('notifications.permission.deniedMessage')
                    : t('notifications.permission.neededMessage')}
                </Text>
                <Button
                  label={
                    pushDenied
                      ? t('notifications.permission.openSettings')
                      : t('notifications.permission.allow')
                  }
                  size="sm"
                  disabled={pushRequesting}
                  onPress={handlePushPermission}
                  style={styles.permissionAction}
                  testID="profile-push-permission-action"
                />
              </View>
            </SurfaceLevelProvider>
          ) : null}
          {prefs ? (
            <>
              {/* With the permission off nothing arrives: the switches are
                  shown as they are stored, but not as active controls. */}
              <SwitchRow
                label={t('notifications.narrationReady')}
                value={prefs.narrationReadyNotifications}
                disabled={pushDenied || pendingPrefKey === 'narrationReadyNotifications'}
                onValueChange={next => void togglePref('narrationReadyNotifications', next)}
                style={styles.switchRow}
                testID="profile-pref-narration"
              />
              <SwitchRow
                label={t('notifications.voiceReady')}
                value={prefs.voiceReadyNotifications}
                disabled={pushDenied || pendingPrefKey === 'voiceReadyNotifications'}
                onValueChange={next => void togglePref('voiceReadyNotifications', next)}
                style={styles.switchRow}
                testID="profile-pref-voice"
              />
            </>
          ) : prefsLoading ? (
            <SkeletonPulse testID="profile-prefs-loading">
              {[0, 1].map(i => (
                <View key={i} style={styles.prefsLoading} testID={`profile-prefs-skeleton-${i}`}>
                  <TextBones lines={1} style={styles.prefsLoadingText} />
                  <Bone tone="line" width={52} height={32} radius={RADIUS.md} />
                </View>
              ))}
            </SkeletonPulse>
          ) : prefsFailed ? (
            <SettingRow
              indent
              label={t('notifications.prefsFailed')}
              trailing={
                <Button
                  label={t('common:retry')}
                  variant="text"
                  size="sm"
                  onPress={() => void loadPrefs()}
                  testID="profile-prefs-retry"
                />
              }
              testID="profile-prefs-error"
            />
          ) : null}
        </SettingsGroup>

        {/* Help and the device */}
        <SettingsGroup testID="profile-group-more">
          <SettingRow
            icon="document"
            label={t('legal.label')}
            chevron
            onPress={() => setLegalListOpen(true)}
            testID="profile-legal"
          />
          <SettingRow
            icon="mail"
            label={t('contact.label')}
            chevron
            onPress={handleContact}
            testID="profile-contact"
          />
          <SettingRow
            icon="phone"
            label={t('cache.label')}
            value={cacheSize === null ? undefined : formatBytes(cacheSize, uiLanguage)}
            disabled={cacheClearing}
            onPress={handleClearCache}
            testID="profile-clear-cache"
          />
        </SettingsGroup>

        {/* Account actions: sign-out spans the gutter as a md button (owner
            feedback: the label-wide pill read too small). */}
        <View style={styles.accountActions}>
          <Button
            label={signingOut ? t('signOut.progress') : t('signOut.label')}
            variant="secondary"
            size="md"
            block
            icon="signOut"
            loading={signingOut}
            onPress={handleSignOut}
            testID="profile-sign-out"
          />
          <Button
            label={t('deleteAccount.label')}
            variant="text"
            tone="danger"
            icon="trash"
            disabled={signingOut}
            onPress={() => navigateSingleton(nav, 'DataDeletion')}
            style={styles.deleteAccount}
            testID="profile-delete-account"
          />
        </View>

        {version ? (
          <Text
            style={[text.meta, styles.version]}
            // Development builds only: seven quick taps crash the app to
            // test Crashlytics (services/crashReporting). Nothing in release.
            onPress={__DEV__ ? testCrash.tap : undefined}
            testID="profile-version"
          >
            {t('version', { version })}
          </Text>
        ) : null}
      </ScrollView>

      <NameEditSheet
        visible={nameSheetOpen}
        onClose={() => setNameSheetOpen(false)}
        testID="profile-name-sheet"
      />

      <ChoiceSheet
        visible={languageSheetOpen}
        title={t('contentLanguage.label')}
        options={languageOptions}
        value={contentLanguageStore.selectable}
        onSelect={handleContentLanguage}
        onClose={() => setLanguageSheetOpen(false)}
        testID="profile-language-sheet"
      />

      <BottomSheet
        visible={legalListOpen}
        onClose={() => setLegalListOpen(false)}
        title={t('legal.label')}
        contentStyle={styles.legalSheet}
        testID="profile-legal-sheet"
      >
        {LEGAL_DOCUMENTS.map(document => (
          <SettingRow
            key={document.slug}
            icon="document"
            label={t(document.labelKey)}
            chevron
            onPress={() => setLegalSlug(document.slug)}
            testID={`profile-legal-${document.slug}`}
          />
        ))}
        {/* Inside the list sheet, so the document opens above it on both
            platforms and closing it returns to the list. */}
        <LegalSheet slug={legalSlug} onClose={() => setLegalSlug(null)} context="profile" />
      </BottomSheet>
    </View>
  );
});

const makeStyles = (T: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: T.bg },
    scroll: { paddingTop: SPACE.md },
    card: { marginHorizontal: T.screenPadH, marginBottom: SPACE.lg },

    account: { flexDirection: 'row', alignItems: 'center', gap: SPACE.md, padding: SPACE.lg },
    accountText: { flex: 1, minWidth: 0 },

    paletteBlock: { paddingHorizontal: T.screenPadH, paddingTop: 0, paddingBottom: SPACE.lg },
    paletteTitle: { marginBottom: SPACE.sm },

    // The switch labels line up with the labels of the rows with an icon.
    switchRow: { paddingLeft: ROW_LABEL_INSET, paddingRight: ROW_PAD_H },
    prefsLoading: {
      // The height of the switch row it stands for, so nothing jumps.
      minHeight: SETTING_ROW_MIN_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: SPACE.lg,
      paddingLeft: ROW_LABEL_INSET,
      paddingRight: ROW_PAD_H,
    },
    prefsLoadingText: { flex: 1 },

    permission: {
      marginHorizontal: ROW_PAD_H,
      marginTop: SPACE.xxs,
      marginBottom: SPACE.tight,
      padding: SPACE.md,
      borderRadius: RADIUS.md,
      backgroundColor: T.surface2,
    },
    permissionHead: { flexDirection: 'row', alignItems: 'center', gap: SPACE.sm },
    permissionTitle: {
      flex: 1,
      fontFamily: T.fontLabel,
      fontSize: 14,
      lineHeight: 19,
      color: T.text,
    },
    permissionMessage: {
      fontFamily: T.fontBody,
      fontSize: 13,
      lineHeight: 18,
      color: T.text2,
      marginTop: SPACE.xs,
    },
    permissionAction: { marginTop: SPACE.md },

    accountActions: {
      paddingHorizontal: T.screenPadH,
      paddingTop: SPACE.xs,
      alignItems: 'center',
      gap: SPACE.tight,
    },
    deleteAccount: { alignSelf: 'center' },

    version: { textAlign: 'center', marginTop: SPACE.md },

    // The rows' tiles line up with the sheet title on the page gutter.
    legalSheet: { paddingHorizontal: T.screenPadH - ROW_PAD_H },
  });

const stylesFor = themedStyles(makeStyles);

export default ProfileScreen;
