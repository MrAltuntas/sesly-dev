# SPEC-startup: startup, session, offline and quota

Release pass 2026-10-19, branch `release-pass`, worktree `E:\Coding\sesly-base\sesly-mobile-rp`.
Owner items: R1 (speed), R7 (tests), R8/R9 (bugs, UX), R10 (splash and loading).
Paths are relative to the worktree root unless they start with `../sesly-backend`.

This is an implementer's guide. Every decision below is final unless it is listed in
section 12 (owner questions, each with the default to build).

---

## 0. Scope, sources and what was verified

Sources: `code-audit.json` dimensions perf-startup, splash-loading, ui-onboarding-auth,
ux-journeys, ui-account, ui-voice (quota parts), coverage; `visual-auth.md` (emulator,
first launch and auth); REVAMP.md "2026-10-19 RELEASE-READINESS PASS".

Every claim this spec relies on was re-read in the worktree on 2026-10-19. The audit's
line numbers for `App.tsx` are correct (they count from line 1 of App.tsx). Corrections to
the audit that change the design:

- React Navigation 7 (`@react-navigation/routers` 7.5.3, `StackRouter.tsx:371-381`)
  pushes on `navigate()` unless the current route has the same name or `{ pop: true }` is
  passed. Besides Profile / Notifications (audit nav-1), two more call sites push a second
  `Main` shell: `CollectionDetailScreen.tsx:157` and `AllStoriesScreen.tsx:65`
  (`navigate('Main', { screen: 'Library' })` from a pushed screen). Sign-up also leaves
  Login under Main: `RegistrationScreen.tsx:140/150` call `replace('Main')` on top of
  `[Login, Registration]`, so the stack becomes `[Login, Main]` and Android back returns
  to Login while signed in.
- With Hermes the release bundle is built with `--minify false`
  (`@react-native/gradle-plugin` `TaskConfiguration.kt:81`), so a Metro/terser
  `drop_console` setting would do nothing. Console stripping must happen in Babel.
- Expo's Metro config already turns `inlineRequires` off on purpose
  (`expo/node_modules/@expo/metro-config/build/ExpoMetroConfig.js:322-327`), and
  `RootNavigator.tsx:150-176` builds every screen component at module load
  (`const S = { ...themed(X) }`), so inline requires alone would not make screens lazy.
- On Fabric, native-stack never freezes the screen directly below the focused one
  (`NativeStackView.native.tsx:540-544`). `enableFreeze` helps inactive tabs and screens
  two or more levels down only.
- `index.ts` is also evaluated for FCM headless tasks (`registerBackgroundMessageHandler`),
  so boot work (network, socket) must not start at module scope. It starts on App's first
  render.
- `android/gradle.properties` is tracked in git and contains the upload keystore
  passwords (`MYAPP_UPLOAD_STORE_PASSWORD`, `MYAPP_UPLOAD_KEY_PASSWORD`). See 12.
- The backend contract this spec builds on is live: `../sesly-backend` `main` equals
  `origin/main` (e5e58f7, 2026-10-17) and contains `GET /usage`
  (`usage.controller.ts:12-21`), `QUOTA_*` codes (`usage.service.ts:32-36, 208-233`),
  `CLONE_CREATION_LIMIT` (`voice-profiles.service.ts:241-252`, thrown at create and at
  upload) and the MINI plan (`prisma/schema.prisma:151-156`,
  `plans.constants.ts:50-88`). No backend change is needed for this spec.

### Findings routed to other specs (not built here)

| Finding | Why elsewhere |
|---|---|
| perf-4, perf-5, perf-10, perf-12..18, r10-7..12, r10-16, r10-20, ux-2 (UI note), ux-5..9, ux-12, ux-13, ux-20, ux-21, ux-25, ux-26, lib-*, shell-*, voice-1..5, voice-9..23, voice-27..34 | player, library, discover, voice UI specs |
| perf-19, r2-1, pal-1, visual-auth 15, 21 | palette-switch spec (instant palette and language switch) |
| r8a-3, r5-1, test-16, visual-auth 4, 14, 18 (field and button contrast, sizes, focus ring) | design-system / contrast spec. This spec only states what the auth screens need from it (7.9). |
| r8a-13, r8a-14, r8a-15, r10-17, test-3, test-20, visual-auth 5, 6, 7, 16 (BottomSheet, LegalSheet, nav bar under sheets) | sheets spec. This spec provides the native night mode it depends on (1.3) and the keyboard library (7.1). |
| sub-1, sub-2, prof-1, prof-3, lib-4, i18n-1, ux-22 layout parts, ux-31 | account UI spec. The plan logic of the plans screen is here (6.8). |

---

## 1. Native launch

### 1.1 What the user sees today (verified)

Android: `AndroidManifest.xml:33` starts MainActivity with `Theme.App.SplashScreen`, whose
`windowBackground` is the layer-list `res/drawable/ic_launcher_background.xml` (cream
`#F6F0EA` plus a 220dp `splashscreen_logo`). The logo PNGs are 1550 / 2325 / 3101 / 4651 /
6201 px (mdpi to xxxhdpi), an opaque navy square with the bird (`assets/splash-icon.png`
treated as mdpi by an old prebuild). `MainActivity.kt:18` then switches to `AppTheme`
(`styles.xml:2`, parent `Theme.AppCompat.Light.NoActionBar`, window `#F6F0EA`), and
`App.tsx:115-123` renders `null` until init and fonts finish, so the cream window stays up
during bundle load. `values-night/colors.xml` repeats the cream with a stale "light-only"
comment. No `windowSplashScreen*` attribute exists, so Android 12+ estimates a light
background. `expo-splash-screen` is not installed. Then the JS `SplashScreen.tsx` fades a
different layout in from opacity 0 (44dp mark beside a 44pt wordmark, 40dp above centre,
spinner and hint), holds 800 ms and slides Main in from the right.

iOS: `SplashScreenBackground.colorset` is `#06B6D4` (cyan) in the colorset and inline in
`SplashScreen.storyboard:44-46`; `SplashScreenLegacy` is the Expo template grid, the same
1024 px file three times; the image view is pinned to all four edges; `Info.plist:83-84`
`UIUserInterfaceStyle` is `Light`. `app.config.js:10` `userInterfaceStyle: "light"`,
`:13-17` splash cream.

### 1.2 Decision

One launch picture from the first pixel to the first screen, and no JS splash at all:

- The native splash is the default palette background `#121A29`
  (`palettes['gece-mavisi'].bg`, `DEFAULT_PALETTE` in `src/theme/palettes.ts:29`) with the
  bird mark (transparent, from `src/assets/images/logo.png`, 45 percent transparent,
  verified) at **120dp**, exactly centred on the full screen.
- Android structure (LA-1, 2026-10-20): `windowSplashScreenAnimatedIcon` names the bitmap
  `@drawable/splashscreen_logo` directly, with no wrapper drawable. Each density's PNG is
  the whole **288dp** splash icon box (no icon background): 288 / 432 / 576 / 864 /
  1152 px for mdpi to xxxhdpi, the 120dp mark (120 / 180 / 240 / 360 / 480 px) exactly in
  the middle and fully transparent around it, inside the 192dp circle the system keeps.
  This is what the expo-splash-screen plugin itself writes (it composites the mark at
  `imageWidth` onto a 288dp canvas); the earlier 84dp `<inset>` drawable around a 120dp
  PNG showed a plain navy window with no mark on the API 37 system splash. The padding is
  transparent where the plugin would paint `backgroundColor`: the same picture, since the
  splash window is already `#121A29`. iOS keeps the bare 120pt mark in a centred
  120 x 120 image view.
- Add **`expo-splash-screen`** (SDK 55 matched, `npx expo install expo-splash-screen`).
  It holds the native splash (Android 12 system splash, androidx core-splashscreen compat on
  Android 10/11, the iOS launch storyboard) until JS calls `hideAsync()`, so there is no
  second picture to match. A native rebuild is needed for the colour and theme fixes
  anyway, so the module costs no extra rebuild.
- The JS `Splash` route and `src/screens/splash/SplashScreen.tsx` are deleted. The
  navigator mounts directly on the decided first route (section 2) behind the native
  splash, which hides with a 200 ms fade once that route has drawn.
- The app is dark-only natively: night mode forced in `MainApplication`, a dark AppCompat
  parent, no `values-night` override, dark iOS interface style.
- Users on another palette still get `#121A29` natively. Every palette bg is between
  `#0C1710` and `#1D1322` (palettes.ts:170-256), so the 200 ms fade is dark to dark.
- The launcher icon (cream adaptive background, `ic_launcher_background` colour,
  `mipmap-*`) is not touched: it is branding, not the splash.

### 1.3 Android changes

1. **Install** `expo-splash-screen` (see 11.1 for the node_modules junction rule). After
   installing, open `node_modules/expo-splash-screen/plugin/build/` (the Android style and
   MainActivity mods) and hand-apply exactly what they would generate, adapted as below.
   Never run prebuild.
2. `android/app/src/main/java/com/sesly/MainActivity.kt` `onCreate`: replace
   `setTheme(R.style.AppTheme);` with
   `SplashScreenManager.registerOnActivity(this)` (import
   `expo.modules.splashscreen.SplashScreenManager`) before `super.onCreate(null)`, as the
   plugin template does.
3. `android/app/src/main/java/com/sesly/MainApplication.kt` `onCreate`, first line after
   `super.onCreate()`:
   `AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)`
   (import `androidx.appcompat.app.AppCompatDelegate`). Every activity and every RN Modal
   dialog window then has a night `uiMode` from its first frame (RN's
   `WindowUtil` picks the dialog navigation-bar icon colour from `uiMode`). The sheets spec
   (R3) relies on this. `configChanges` already contains `uiMode`
   (`AndroidManifest.xml:33`), so nothing recreates. Keep `ThemeProvider`'s
   `Appearance.setColorScheme('dark')`; it becomes a no-op on Android and still matters on
   iOS.
4. `res/values/styles.xml`:
   - `AppTheme` parent `Theme.AppCompat.NoActionBar` (always dark, no DayNight lookup).
     Keep the existing items and add
     `<item name="android:windowLightStatusBar">false</item>` and
     `<item name="android:windowLightNavigationBar" tools:targetApi="27">false</item>`.
   - `Theme.App.SplashScreen` becomes the plugin's shape: parent `Theme.SplashScreen`,
     `windowSplashScreenBackground` `@color/splashscreen_background`,
     `windowSplashScreenAnimatedIcon` `@drawable/splashscreen_logo` (the padded bitmap
     of item 8, as the plugin writes it), `postSplashScreenTheme` `@style/AppTheme`, plus
     `android:windowSplashScreenBehavior` `icon_preferred` (targetApi 33) if the plugin
     writes it. No `windowSplashScreenIconBackgroundColor` (no circle behind the mark).
5. `res/values/colors.xml`: `splashscreen_background` and `window_background` =
   `#121A29`. Leave `iconBackground`, `colorPrimary*` and
   `res/values/ic_launcher_background.xml` alone.
6. Delete `res/values-night/colors.xml` (the app is dark-only; with `MODE_NIGHT_YES` it
   would always win, so it must not exist as a second source of truth).
7. Delete `res/drawable/ic_launcher_background.xml` (the layer-list; only
   `styles.xml:11` used it). The adaptive icon uses the **colour** resource of the same
   name, which stays.
8. Replace the five `res/drawable-*/splashscreen_logo.png` with the 288dp splash icon box
   holding the transparent mark at 120dp in the middle: mdpi 288 px (mark 120), hdpi 432
   (180), xhdpi 576 (240), xxhdpi 864 (360), xxxhdpi 1152 (480), everything outside the
   central 120dp square fully transparent, each file under 72 KB. The cap was 60 KB for
   the bare marks; the transparent border makes every mark row 2.4 times longer and the
   xxxhdpi file needs about 63 KB with the same mark pixels. The cap guards against the
   old 1550 to 6201 px set (38 to 154 MB decoded); the 1152 px box decodes to 5.3 MB.
9. No wrapper drawable: `res/drawable/splashscreen_icon.xml` (an 84dp `<inset>` around
   the 120dp PNG) is deleted (LA-1: the API 37 system splash drew no mark from it). The
   box is 288dp with no icon background and the system keeps its central 192dp circle;
   84 + 120 + 84 = 288 is now baked into the bitmap, so the mark shows at 120dp, centred,
   unclipped, on both the Android 12+ system splash and the androidx compat splash (which
   scales the drawable into its own 288dp icon view).
10. Generate the PNGs (Android and iOS) with a committed script
    `scripts/generate-splash-assets.js` (node; uses `@expo/image-utils`
    `generateImageAsync` with `resizeMode: 'contain'`, transparent background, source
    `src/assets/images/logo.png`, the Android marks then centred on the transparent
    288dp canvas), so they can be regenerated if the logo changes.

### 1.4 iOS changes

Applied now, verified when iOS ships (iOS Firebase config is still missing per CLAUDE.md).

- `ios/Sesly/Images.xcassets/SplashScreenBackground.colorset/Contents.json`: red
  `0.0706`, green `0.1020`, blue `0.1608` (`#121A29`); the same values in the inline
  `namedColor` at `ios/Sesly/SplashScreen.storyboard:44-46`.
- `SplashScreenLegacy.imageset`: the transparent mark at 120 / 240 / 360 px
  (1x / 2x / 3x), with `Contents.json` naming three different files.
- `SplashScreen.storyboard:25-30`: replace the four edge constraints with centerX,
  centerY, width 120 and height 120 on the image view.
- `ios/Sesly/Info.plist:83-84`: `UIUserInterfaceStyle` = `Dark`.
- `pod install` for expo-splash-screen and react-native-keyboard-controller (7.1).

### 1.5 app.config.js (mirror only, so a future prebuild agrees)

`userInterfaceStyle: "dark"`; remove the top-level `splash` block; add the plugin entry
`["expo-splash-screen", { backgroundColor: "#121A29", image: "./assets/splash-mark.png", imageWidth: 120 }]`
with `assets/splash-mark.png` = the transparent mark (1024 px, generated by the same
script). Delete the stale comment on `userInterfaceStyle`. Leave `icon`,
`android.adaptiveIcon` and `assets/splash-icon.png` as the launcher icon sources.

### 1.6 JS side of the splash

- `index.ts` (module scope, above `registerRootComponent`):
  `SplashScreen.preventAutoHideAsync()` and
  `SplashScreen.setOptions({ fade: true, duration: 200 })`, both wrapped so a rejection
  is only a warning.
- New `src/boot/splash.ts`: `releaseSplash(reason: string)` calls `hideAsync()` once
  (idempotent, swallows errors) and is the only caller of `hideAsync`. A safety timer of
  12 s from the first App render calls it too (12 s is above the longest boot wait in
  2.4, so it only fires on a bug).
- Release points: RootNavigator `onReady` runs
  `requestAnimationFrame(() => releaseSplash('first-route'))`, except on the Onboarding
  route, where release waits for the first onboarding picture's `onLoad` or 800 ms,
  whichever comes first (7.10), so the illustration never pops in.
- Delete `SplashScreen.tsx`, the `Splash` route, `screens/splash/index.ts`'s default
  export (ForceUpdateScreen stays in the folder) and the `common:splash.preparing` key
  (tr and en).

### 1.7 Tests (native config, `src/theme/nativeConfig.test.ts`, `@jest-environment node`)

Read files with `fs`; PNG width from IHDR (`buf.readUInt32BE(16)`).

- `values/colors.xml`: `splashscreen_background` and `window_background` equal
  `palettes[DEFAULT_PALETTE].bg` (case-insensitive).
- `values-night/colors.xml` does not exist.
- `styles.xml`: AppTheme parent contains no `Light` and no `DayNight`;
  `Theme.App.SplashScreen` has parent `Theme.SplashScreen`,
  `windowSplashScreenBackground`, `windowSplashScreenAnimatedIcon` =
  `@drawable/splashscreen_logo`, `postSplashScreenTheme` = `@style/AppTheme`.
- `drawable/splashscreen_icon.xml` does not exist, and the only `splashscreen_logo` or
  `splashscreen_icon` files are the five `drawable-<d>/splashscreen_logo.png`.
- Each `drawable-<d>/splashscreen_logo.png` is 288 x {1, 1.5, 2, 3, 4} px square, RGBA,
  under 72 KB; the bounds of its visible pixels lie inside the central 120dp square, their
  longer side is 118 to 120dp and their centre is within 1dp of the box centre; the
  corners are transparent, every visible pixel is inside the 192dp circle, and inside the
  120dp square more than 20 percent is transparent and more than 30 percent opaque. The
  mdpi, xhdpi and xxhdpi marks are pixel for pixel the iOS 1x, 2x and 3x images.
  `drawable/ic_launcher_background.xml` does not exist.
- `MainActivity.kt` contains `SplashScreenManager.registerOnActivity(this)` before
  `super.onCreate` and no `setTheme(`.
- `MainApplication.kt` contains `setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)`
  before `loadReactNative`.
- iOS colorset components round to `#121A29`; storyboard inline `namedColor` likewise;
  `Info.plist` has `<string>Dark</string>` after `UIUserInterfaceStyle`; the three
  `SplashScreenLegacy` files have widths 120, 240, 360.
- `app.config.js` (require it): `userInterfaceStyle === 'dark'`, no `splash` key, the
  `expo-splash-screen` plugin entry has `backgroundColor` = default bg.
- `src/boot/splash.test.ts`: `releaseSplash` calls `hideAsync` once for many calls; the
  safety timer releases after 12 s; a rejected `hideAsync` does not throw.

Manual check on a release build, on an API 33 to 35 device, on API 37 and on an Android 10
device or AVD: cold start from the launcher and via `am start` shows only `#121A29` with
the centred mark until the first screen, no plain navy window without the mark, no cream
frame, no second mark, no slide. Record with `adb shell screenrecord` and step the frames
(RELEASE-CHECKLIST section 4).

---

## 2. Boot sequence

### 2.1 Today (verified)

`App.tsx:49-95` awaits i18n and palette, then `AuthService.initialize()`, then
`WebSocketService.connect()`, and renders `null` until that and `useFonts` finish
(`:115-123`, 5 s font cap `:105-113`). The `AuthStore` is created lazily by the first
`useAuth()` (`useAuth.ts:529-539`) inside RootNavigator, so `GET /users/me` cannot start
before App's init and the fonts are done. `SplashScreen.tsx:90` waits 800 ms, `:95-102`
polls `isInitialized` every 100 ms for up to 12 s, `:104` awaits `/app/config` (5 s cap),
`:126-127` reads AsyncStorage then two encrypted tokens one after another, `:129-138`
routes to Main only with tokens and a backend user. `useAuth.ts:196-202`: the catch never
sets `isInitialized`, so any throw in `initialize` holds the splash for the full 12 s. A
signed-in user who starts offline or during a 5xx lands on Login (restore returns null,
`AuthService.ts:501-515`), and the 30 s axios timeout (`constants.ts:21`) outlives the 12 s
cap. Sign-out resets to `Splash` (`RootNavigator.tsx:225-243`) and replays all of it.

### 2.2 Target

- No fixed wait anywhere. Nothing waits for the network when the device already knows
  where to go.
- Returning signed-in user (cached user present): first route `Main`, decided from local
  storage only, fonts and i18n in parallel. Target on a Redmi 8 class device, release
  build: Home (skeleton or content) within 1.5 s of the launcher tap, the same with
  airplane mode on.
- Signed-out user: `Login` (or `Onboarding` on first launch) from local storage only.
- The force-update check and the session revalidation run after routing.

### 2.3 Structure (new files)

- `src/boot/bootSnapshot.ts`: `readBootSnapshot(): Promise<BootSnapshot>` with ONE
  `AsyncStorage.multiGet` for `hasSeenOnboarding`, `@sesly/me` (cached user, 3.1),
  `@sesly/appConfig` (last `/app/config`), the stored palette key and the stored UI
  language key, plus `ApiClient.hasValidTokens()` (one encrypted read pass thanks to the
  token cache, 3.5). `initUiLanguage` and `preloadStoredPalette` get an optional
  pre-read value parameter so they do not read storage again.
- `src/boot/decideBootRoute.ts` (pure):
  ```ts
  type BootRoute =
    | { name: 'ForceUpdate'; params: ForceUpdateInfo }
    | { name: 'Main' }
    | { name: 'Login'; params?: { firstRun?: boolean } }
    | { name: 'Onboarding' }
    | { name: 'NoInternet'; params: { reason: 'offline' | 'server' | 'maintenance' } };
  decideBootRoute(input: {
    forceUpdate: ForceUpdateInfo | null;   // from the cached config, evaluated now
    hasTokens: boolean;
    hasCachedUser: boolean;
    restore: RestoreOutcome | 'pending';   // 3.2
    hasSeenOnboarding: boolean;
  }): BootRoute | 'wait'
  ```
  Rules, in order: cached force update -> ForceUpdate; tokens and cached user -> Main;
  tokens without cached user -> `'wait'` while the restore is pending, then `restored`
  -> Main, `rejected` or `none` -> Login, `offline` / `server` / `maintenance` ->
  NoInternet with that reason; no tokens -> Login if onboarding was seen, else
  Onboarding.
- `src/boot/BootStore.ts` (MobX singleton, `getBootStore()`): observable `uiReady`
  (i18n and palette applied) and `route: BootRoute | null`; `start()` is idempotent.
  `start()`:
  1. `const snap = await readBootSnapshot()` (one storage round trip).
  2. In parallel: apply language and palette from `snap` and set `uiReady`;
     `getAuthStore().initialize(snap)` (3.2), not awaited here. Its first step is
     synchronous, so a cached user is in the store before `route` is set.
  3. Evaluate the cached config with `evaluateForceUpdate(parseAppConfigFromJSON(snap.appConfig), Platform.OS, getAppVersion())`.
  4. Compute `decideBootRoute`; if `'wait'`, `await when(() => auth.restoreOutcome !== 'pending', { timeout: 10000 })`
     (mobx 6.15) and treat a timeout as `offline`; set `route`.
  5. Start the background config refresh (2.5) and the idle preload (5.4) after the route
     is set.
- `src/session/userCache.ts`: see 3.1.

### 2.4 Files that change

- `index.ts`: keep the emulator hooks and `registerBackgroundMessageHandler()` where they
  are; add `enableFreeze(true)` (5.2) and the splash calls (1.6). No boot work here
  (headless tasks evaluate this file).
- `App.tsx`:
  - First render: `useState(() => { getBootStore().start(); startSplashSafetyTimer(); })`.
    Remove `initializeAppLocal`'s awaited `AuthService.initialize()` and
    `WebSocketService.connect()` (`App.tsx:71-87`). `configureErrorHandler` moves into
    `BootStore.start()` (sync). `PushNotificationService.initialize()` runs in
    `BootStore.start()` right after `AuthService.initialize()` settles (Firebase first,
    which matters on iOS), in a detached async block that rendering never awaits.
  - Render gate: `bootStore.uiReady && (fontsLoaded || fontError || fontTimeoutHit)`,
    font cap 3000 ms (fonts are local; past 3 s something is broken). `App` stays a
    plain component wrapped in `observer` only for `uiReady`.
  - Fonts: subpath imports (8.1).
  - `<SafeAreaProvider initialMetrics={initialWindowMetrics}>` (removes an empty commit,
    react-native-safe-area-context 5.6.2).
  - `<KeyboardProvider statusBarTranslucent navigationBarTranslucent>` wraps the
    SafeAreaProvider (7.1).
  - Delete the render-path `console.log` calls (`App.tsx:51, 61, 89, 117, 124`).
- `src/navigation/RootNavigator.tsx`:
  - `const route = getBootStore().route` (observer); return `null` while it is null
    (the native splash is still up).
  - `<NavigationContainer initialState={{ index: 0, routes: [bootRouteToState(route)] }} onReady={...}>`
    (params included; no `initialRouteName`, no `Splash` route).
  - `onReady`: `flushPendingNotificationOpen()`, the splash release (1.6).
  - Session end effect (`:225-243`): reset to `[{ name: 'Login' }]`, not Splash
    (`hasSeenOnboarding` is never cleared, so Splash always chose Login there anyway).
  - Subscription effect (`:214-223`): seed the tier on `backendUser?.subscriptionTier`
    changes and call `refresh()` only when `backendUser?.id` changes (the cached user and
    the fresh user are two objects for the same id; today that would refresh twice).
  - Route params type: `Login: { firstRun?: boolean } | undefined`,
    `NoInternet: { reason: 'offline' | 'server' | 'maintenance' } | undefined`,
    remove `Splash`.
- `src/navigation/pushRouting.ts`: comments only ("Splash" becomes "the boot route");
  `isAppShellReady` already keys on `Main` and works with Main as the initial route.

### 2.5 Force update in the background

- `src/services/AppConfigService.ts`: `refreshAppConfig(timeoutMs = 10000)` fetches
  `/app/config`, writes the raw JSON to `@sesly/appConfig` on success, and returns
  `evaluateForceUpdate(...)`. Keep `checkForceUpdate` as a thin wrapper for tests or
  delete it with its callers. Rename `APP_CONFIG_TIMEOUT_MS` to
  `APP_CONFIG_REFRESH_TIMEOUT_MS = 10000` (nothing waits on it any more).
- BootStore runs it after the route is set, and again on `AppState` `active` when the
  last successful fetch is older than 6 h.
- Result handling (in BootStore, through `navigationRef`):
  - update required and the focused root route is not `ForceUpdate`:
    `navigationRef.reset({ index: 0, routes: [{ name: 'ForceUpdate', params: info }] })`.
  - not required but the app sits on `ForceUpdate` (stale cache): reset to the route
    `decideBootRoute` gives with `forceUpdate: null` and the current auth state.
- `src/models/AppConfig.ts`: `ForceUpdateInfo.storeUrl` stays nullable; on iOS the
  backend value is the fix (owner item, 12.4). ForceUpdateScreen is unchanged.

### 2.6 Tests

- `src/boot/decideBootRoute.test.ts`: every rule in 2.3, including `'wait'` while
  pending, each restore outcome, cached force update winning over everything.
- `src/boot/BootStore.test.ts` (fake timers, mocked AsyncStorage, EncryptedStorage,
  AuthStore):
  - tokens + cached user, `/users/me` and `/app/config` never resolving: `route` is
    `Main` after the storage promises resolve, with no timer advanced;
  - no tokens, onboarding seen: `Login`; not seen: `Onboarding`;
  - tokens, no cache, restore rejects with `ApiError` status 0: `NoInternet` /
    `offline`; status 503: `maintenance`; 500: `server`; 401: `Login`;
  - tokens, no cache, restore never settles: `NoInternet` after 10 000 ms;
  - `readBootSnapshot` calls `AsyncStorage.multiGet` exactly once;
  - background config refresh resolving to an update resets to ForceUpdate; a stale
    cached update followed by "not required" resets to Main.
- New `App.test.tsx` (mock RootNavigator, BootStore, expo-font): renders null until
  `uiReady` and fonts; renders after 3000 ms when fonts never load; never calls
  `WebSocketService.connect` or awaits `AuthService.initialize`; calls `start()` once.
- `RootNavigator.test.tsx`: update the cases at `:144-146` (starts on Splash) to "starts
  on the boot route", `:179-195` (reset to Splash) to reset to `Login`; add: no `Splash`
  route is registered; `onReady` releases the splash.
- Delete `src/screens/splash/ForceUpdate.test.tsx`'s Splash part; keep
  `ForceUpdateScreen` tests; move the force-update gate assertions to BootStore tests.
- `jest.config.js` `collectCoverageFrom`: add `App.tsx`, `src/boot/**`,
  `modules/*/index.ts`; replace `'!src/**/index.ts'` with explicit barrel excludes so
  `src/i18n/index.ts` is measured (coverage test-8).

---

## 3. Session lifecycle

### 3.1 Cached user

- `src/session/userCache.ts`: `readCachedUser(raw: string | null): User | null`
  (`JSON.parse` then `parseUserFromJSON`; any failure returns null and deletes the key),
  `writeCachedUser(user)` (`JSON.stringify({ v: 1, user: userToJSON(user) })`, both exist
  in `src/models/User.ts:90, 151`), `clearCachedUser()`. Key `@sesly/me`. Delete the unused
  `STORAGE_KEYS.USER_DATA` (`constants.ts:41`).
- Written after every successful `/users/me`, sign-in, registration and profile update.
- Removed in `signOut`, `handleSessionExpired`, account deletion and whenever the restore
  is `rejected`.
- AsyncStorage is app-private; the cache holds what `/users/me` returns (id, email,
  names, avatar URL, tier). No tokens.

### 3.2 AuthStore (`src/hooks/useAuth.ts`)

- Export `getAuthStore()` (the singleton `useAuth()` returns). `useAuth()` no longer
  calls `initialize()`; BootStore does.
- New observables: `restoreOutcome: 'pending' | RestoreOutcome`,
  `sessionStale: boolean` (cached user shown, live check not done yet).
  `RestoreOutcome = 'restored' | 'none' | 'rejected' | 'offline' | 'server' | 'maintenance'`.
- `isLoading` is removed. No screen may show busy because of the launch restore. Auth
  screens use their own pending state (7.5).
- `initialize(snap)` never throws and always ends with `isInitialized = true` in
  `finally`:
  1. If `snap.hasTokens && cachedUser`: `applySession(cachedUser, 'cache')` first,
     synchronously, so the first Main render already has the user (greeting, tier).
     `sessionStale = true`.
  2. `await AuthService.initialize()` inside its own try/catch (Firebase config; a failure
     is logged once, no toast: the user can still use the cached session or sign in).
  3. Subscribe `onAuthStateChanged` as today (it fills `user`, the Firebase user, for the
     cached path too).
  4. Cached path: `void this.revalidate()`. Tokens without a cache:
     `await this.revalidate()`. No tokens: `restoreOutcome = 'none'`.
- `revalidate()`: `const result = await AuthService.restoreSession()`:
  - `restored`: `applySession(result.user, 'live')`, `sessionStale = false`.
  - `rejected`: `clearCachedUser()`; if `isAuthenticated` call
    `handleSessionExpired()` (it routes to Login with the existing "Oturum sona erdi"
    toast); `restoreOutcome = 'rejected'`.
  - `offline` / `server` / `maintenance`: keep the cached user if any, keep the tokens,
    keep `sessionStale = true`. Retry automatically when `ConnectivityStore` reports the
    internet back (4.2) and on `AppState` `active`, at most once per 30 s.
- `applySession(user, source)`: set `backendUser`; for `source === 'live'` also
  `user = AuthService.getCurrentFirebaseUser()` (the cached path must not touch Firebase
  before `AuthService.initialize()`); write the cache when `source === 'live'`; once per user id per app run: `connectWebSocketIfPossible()` (not
  awaited), `prefetchUserPreferences()`, `prefetchPlaylists()`, and the cache-owner check
  (3.4).
- `retryRestore()` (used by NoInternet): `await this.revalidate()` and return the outcome.
- `handleSessionExpired()` (`:113-145`): also `clearCachedUser()`.
- `signOut()` (`:449-509`), reordered so the user is not kept waiting on cleanup or the
  network (LA-4): read the access and refresh tokens first, then only local work (the
  Firebase sign-out, awaited but capped at `FIREBASE_SIGN_OUT_TIMEOUT_MS` 1.5 s so a
  silent refresh cannot mint tokens for the old account; socket disconnect; session end
  handlers; `ApiClient.clearTokens()`, `clearCachedUser()`, `user = null`,
  `backendUser = null`: the navigator resets to Login now), then fire-and-forget the
  cache, preference and playlist clears. The push unregister
  (`PushNotificationService.unregisterDevice(accessToken)`), the Google sign-out and
  the backend revoke (`AuthService.finishSignOut`, after the unregister) run in the
  background with the captured credentials through `ApiClient.postDetached` (no stored
  token, no refresh and no session-expired flow on a 401), so they never touch a session
  started meanwhile; a new sign-in waits for a pending revoke before its token exchange,
  and a new push registration waits for the old unregister. Concurrent calls share one
  run; Profile shows "Çıkış yapılıyor..." while `isSigningOut`.

### 3.3 AuthService.restoreSession (`src/services/AuthService.ts:473-517`)

Returns `{ status: 'restored'; user: User } | { status: RestoreOutcome excluding 'restored' }`:

- no tokens: `none`;
- `UserService.getCurrentUser({ timeout: 8000 })` succeeds: `restored`
  (`UserService.getCurrentUser` gains an optional `AxiosRequestConfig` passed to
  `ApiClient.get`);
- `ApiError` with code `SESSION_EXPIRED` or status 401, 403 or 404: `rejected`, tokens
  cleared (404 means the user row is gone);
- `ApiError` status 0 with code `NETWORK_ERROR` (includes the 8 s timeout): `offline`;
- status 503: `maintenance`; any other status >= 500 or 429: `server`;
- a non-`ApiError` (parser bug) or status 0 with code `UNKNOWN_ERROR`: `server`. The
  tokens are kept: the app must never sign a user out because of its own parse error
  (today `AuthService.ts:510-511` clears them).

Also `await ensureFirebaseInitialized()` at `AuthService.ts:101-102` (it is async and not
awaited today, coverage test-28) and delete the leftover comment at `:99-100`. Make
`AuthService.initialize()` single-flight (keep the in-flight promise; BootStore and
AuthStore both call it, and the `initialized` flag is only set at the end, so two
concurrent calls would both configure Firebase and Google Sign-In today).

### 3.4 Cache wipe on sign-in

`clearCacheOnLogin` (`useAuth.ts:240-247`) is awaited on every sign-in path before the
screen can move on. Replace it: AsyncStorage `@sesly/lastUserId`; in `applySession`, when
the stored id differs from `user.id`, run `void CacheService.clearAudioCache()` (not
awaited, errors swallowed) and store the new id. Do not clear the image cache (covers are
public). `handleSessionExpired` keeps not clearing caches; the next different user triggers
the wipe.

### 3.5 Token cache (`src/services/ApiClient.ts`)

Every request reads the access token from EncryptedStorage (`:104-121`, `:369-385`) and
`hasValidTokens` reads both (`:547-551`). Add
`private tokens: { access: string | null; refresh: string | null } | null = null` and a
single-flight `loadTokens()` (both keys in one pass). `getAccessToken` / `getRefreshToken` /
`hasValidTokens` read memory after the first load; `storeTokens` sets memory after the
writes; `clearTokens` sets `{ access: null, refresh: null }` before the removes. Nothing
else writes EncryptedStorage (verified).

### 3.6 Duplicate launch requests

- `useSubscription.ts:309-316`: delete `subscriptionStoreInstance.initialize()` in the
  factory (RootNavigator's effect loads for a signed-in user; with a token this was 4
  requests instead of 2). Delete `initialize()` and `isInitialized` if nothing else reads
  them (verified: nothing outside the store).
- `useAuth.ts`: socket connect happens once per session (3.2), not in App.tsx as well.

### 3.7 Account deletion (`src/screens/settings/DataDeletionScreen.tsx:72-101`)

Today the `finally` signs out even when `UserService.deleteAccount()` failed. New flow:
success: `showToast.success(t('deletion.done'))`, then sign out; failure with 401 or 404
(already deleted): sign out; any other failure: keep the user signed in, re-enable the
button, show a dialog `deletion.failedTitle` / `deletion.failed` with `common:retry`
(runs the delete again) and `common:cancel`. New keys: `profile:deletion.done`
("Hesabın silindi" / "Your account was deleted"), `profile:deletion.failedTitle`
("Hesap silinemedi" / "Account not deleted"). Rewrite `DataDeletionScreen.test.tsx:141`
(it pins the bug).

### 3.8 Tests

- `useAuth.test.ts`:
  - cached user + tokens: `backendUser` is set before `getCurrentUser` resolves and
    `isInitialized` is true without awaiting the network;
  - background restore `rejected` (401): `handleSessionExpired` runs once, `@sesly/me`
    removed, tokens cleared;
  - background restore `offline`: cached user kept, `sessionStale` true; a simulated
    connectivity return re-runs the restore once;
  - `AuthService.initialize` throws: `isInitialized` true, `restoreOutcome` set, no toast;
  - `signOut`: `backendUser` is null before the cache clears resolve;
  - sign-in for the same user id does not call `clearAudioCache`; a different id calls it
    and sign-in resolves before it settles.
- `AuthService.test.ts`: each classification in 3.3, tokens kept for 0 / 5xx / parse
  error, cleared for 401 / 403 / 404; `initialize` rejects when Firebase init rejects.
- `ApiClient.test.ts`: three requests make one `EncryptedStorage.getItem` per key;
  `clearTokens` then `getAccessToken` resolves null without a read; `storeTokens` then a
  request uses the new token without a read.
- `userCache.test.ts`: round trip; malformed JSON returns null and removes the key.
- `useSubscription.test.ts`: at launch with a token, `/subscriptions/current` and
  `/usage` are each requested once.
- `DataDeletionScreen.test.tsx`: as in 3.7.

---

## 4. Offline, server down, signed out

### 4.1 Classification (one helper)

`src/services/ApiError.ts`:
```ts
export type FailureKind = 'offline' | 'maintenance' | 'server' | 'session' | 'client';
export function classifyFailure(error: unknown, connectivity?: { offline: boolean }): FailureKind
```
`connectivity.offline` true -> `offline`; `ApiError` status 0 with code `NETWORK_ERROR`
-> `offline`; 503 -> `maintenance`; 401 or `SESSION_EXPIRED` -> `session`; >= 500, 429,
status 0 `UNKNOWN_ERROR`, non-ApiError -> `server`; other 4xx -> `client`.

Signed out is never inferred from a failure: it is only `restoreOutcome` `none` /
`rejected` or a `session` failure that went through `handleSessionExpired`.

### 4.2 Connectivity store

New `src/stores/ConnectivityStore.ts` (MobX singleton, started by BootStore): subscribes
`NetInfo.addEventListener`; `offline = state.isConnected === false || state.isInternetReachable === false`
(null counts as online). Exposes `offline` and `onReconnect(cb)` (fires on an
offline-to-online edge). Add the NetInfo jest mock
(`@react-native-community/netinfo/jest/netinfo-mock.js`) to
`src/test-utils/mocks/native-modules.ts` and drop the per-file mocks.

### 4.3 Where each state is shown

| Situation | What the user sees |
|---|---|
| Launch, tokens, no cached user, restore offline / 5xx / 503 | `NoInternet` route with `reason` (only place this route is used) |
| Launch, tokens, cached user, restore offline / 5xx | Main as usual; screens show their own states; offline banner if NetInfo says offline |
| Using the app and the connection drops | Offline banner above the bottom chrome; lists keep their rows; failed loads show the offline state |
| A load fails with `server` | The screen's own error state ("Sorun bizde. Biraz sonra tekrar dene.") |
| `maintenance` | The screen's error state with the backend's maintenance sentence (Turkish UI) or `api.maintenance` |
| Session rejected | Reset to Login, "Oturum sona erdi" toast (unchanged) |

- `src/screens/common/NoInternetScreen.tsx`: read `route.params.reason` (default
  `offline`). Copy: offline uses the existing `states:offline.*`; server uses new
  `states:server.title` ("Sesly'ye şu an ulaşılamıyor" / "Sesly cannot be reached right
  now") and `states:server.message` ("Sorun bizde. Biraz sonra tekrar dene." / "The
  problem is on our side. Try again in a little while."); maintenance uses new
  `states:maintenance.title` ("Sesly bakımda" / "Sesly is under maintenance") and
  `api.maintenance`. Retry: `await authStore.retryRestore()`; `restored` ->
  `nav.reset` to Main; `rejected` / `none` -> reset to Login; otherwise stay and replace
  the message with `states:offline.stillOfflineMessage` (no dialog). It also retries by
  itself once on `ConnectivityStore.onReconnect`, and resets to Main when
  `authStore.backendUser` becomes non-null while it is focused. `OfflineState` gets
  `title` / `message` / `icon` props so it can show the three variants.
- Offline banner: new `src/components/common/OfflineBanner.tsx`, an observer of
  `ConnectivityStore.offline`, mounted as the first child of `main-bottom-chrome` in
  `MainScaffold.tsx` (`MainBottomBar`). It renders nothing when online (no reserved
  space), otherwise one 28dp row: `wifiOff` icon 16 and `states:banner.offline`
  ("Çevrimdışısın" / "You are offline") in `text.meta`, `T.text2` on `T.surface2`.
  testID `offline-banner`. No motion. The snackbar inset already follows the measured
  chrome height.
- Screen error states: Home, Keşfet, AllStories, Library (both segments), Notifications,
  Collections, CollectionDetail, StoryDetail and AudioGeneration render
  `states:offline.*` with icon `wifiOff` when `classifyFailure(err, connectivity)` is
  `offline`, and their existing copy otherwise. Each store or screen keeps the kind next
  to its error (for example `StoryStore.listErrorKind`, `MyLibraryScreen`
  `errorKind` instead of `hadError`). The owners of those screens (discover, library,
  player specs) wire it; this spec owns the helper and the copy.
- Delete `src/components/common/ConnectivityWrapper.tsx` and its test (imported by its
  own test only, verified).

### 4.4 English UI and backend sentences

The backend's 4xx messages are literal Turkish (`HttpExceptionFilter` only translates
key-shaped messages; none exist). In `apiErrorFromResponse` (`ApiError.ts:114-156`): when
`i18n.language !== 'tr'`, use `fallbackMessageForStatus(status)` for 4xx instead of the
backend sentence (503 keeps `api.maintenance` in English). Callers that map known codes
(quota 6.5, clone codes, NARRATION_EXISTS, EMAIL_IN_USE) build their own copy from the
code and data. Add `config.headers['Accept-Language'] = i18n.language` in the request
interceptor (`ApiClient.ts:107-116`) for when the backend localises.

### 4.5 Tests

- `ApiError.test.ts`: every `classifyFailure` branch; with `i18n` in English a 403 with
  a Turkish backend message yields the English forbidden fallback; in Turkish the backend
  message is kept.
- `ApiClient.test.ts`: `Accept-Language` follows `setUiLanguage`.
- `ConnectivityStore.test.ts`: NetInfo offline / online / null transitions; `onReconnect`
  fires once per offline-to-online edge.
- `NoInternetScreen.test.tsx`: replace the "goes back / resets to Main" cases: retry
  calls `retryRestore`; `restored` resets to Main, `rejected` to Login, `offline` stays
  and shows the still-offline message; `reason: 'server'` shows the server title; a
  reconnect event retries without a tap.
- `MainScaffold.test.tsx`: `offline-banner` absent online, present offline, absent again
  after reconnect.
- One screen test per error-state owner (Home as the reference): an `ApiError` status 0
  shows the offline title, a 500 shows the existing copy.

---

## 5. Navigation speed and correctness

### 5.1 Transitions

In native-stack 7.14 on Android: `slide_from_right` and `slide_from_bottom` take
`config_mediumAnimTime` (400 ms) and move both screens; `ios_from_right` takes
`config_shortAnimTime` (200 ms, accelerate-decelerate, the screen below moves 30 percent);
`fade` is 150 ms; `fade_from_bottom` is a 210 ms fade with a 350 ms 8 percent rise
(react-native-screens `rns_*.xml`, verified). `animationDuration` only works on iOS (for
fade, fade_from_bottom, slide_from_bottom, simple_push).

| Route | animation | notes |
|---|---|---|
| default (`screenOptions`) | `ios_from_right` | `animationDuration: 250` (iOS fades only) |
| Onboarding, Login, Main, ForceUpdate, NoInternet | `fade` | Main, ForceUpdate, NoInternet: `gestureEnabled: false` |
| Registration, AllStories, Collections, VoiceProfiles, NarratorCatalogue, Profile, DataDeletion, Notifications, CreateVoiceProfile, VoiceConsent, VoiceRecording | default | delete the explicit `slide_from_right` at `RootNavigator.tsx:282, 355, 360, 365` |
| StoryDetail, CollectionDetail | `fade_from_bottom` | unchanged |
| AudioPlayer | `fade_from_bottom` | `freezeOnBlur: false` (5.2) |
| Subscription | `fade_from_bottom` | was `slide_from_bottom` (400 ms) |
| VoiceSuccess, Processing, AudioGeneration | `fade` | unchanged, `gestureEnabled: false` |
| Bottom tabs | `animation: 'none'` | instant switch, `lazy: true` kept |

The boot route is the initial state and does not animate. Memoise both `screenOptions`
objects (`RootNavigator.tsx:256-260`, `MainScaffold.tsx:82-86`) with `useMemo(..., [T])`.

### 5.2 Freeze

`index.ts`: `import { enableFreeze } from 'react-native-screens'; enableFreeze(true);`
before `registerRootComponent`. Inactive tabs and stack screens two or more levels down
stop re-rendering on store changes and palette taps. The AudioPlayer route sets
`freezeOnBlur: false`, because its auto-advance and story-count timer are a render-driven
effect on `didJustFinish` (`AudioPlayerScreen.tsx:531-573`); the player spec may move that
into a store reaction and then drop the exception.

### 5.3 Lazy routes

Only the launch path loads eagerly: `Onboarding`, `Login`, `Main` with the Home tab,
`ForceUpdate`, `NoInternet`. Every other root route uses `getComponent`:
```ts
const lazyThemed = (load: () => React.ComponentType<any>) => {
  let C: React.ComponentType<any> | undefined;
  return () => (C ??= withThemedChrome(load()));
};
<Stack.Screen name="StoryDetail" getComponent={lazyThemed(() => require('../screens/story/StoryDetailScreen').default)} />
```
AudioPlayer uses the same helper without `withThemedChrome` (it sets its own chrome).
In `MainScaffold.tsx`, Discover, Library and Voices tabs use `getComponent` the same way
(their `'bar'` chrome variant kept). Remove the eager imports. Every target file has a
default export (verify each while converting).

`LegalMarkdown.tsx:270` builds `MarkdownIt` at module scope: make it lazy
(`getLegalParser()`), and update `LegalMarkdown.test.tsx:13, 32`.

### 5.4 Idle preload

1500 ms after the boot route is shown (and only when it is `Main`), require the modules
of StoryDetail, AudioPlayer and Profile in a `setTimeout` (the `lazyThemed` getters are
called and cached), so the first tap on a cover, the mini player or the avatar does not pay
the module load.

### 5.5 Inline requires: not in this release

Not enabled. With 5.3 the screens are already lazy; the remaining gain is small and Expo
ships it off deliberately. Revisit with SDK 58.

### 5.6 Duplicate screens under React Navigation 7

| Call site | Change |
|---|---|
| `NotificationsScreen.tsx:291` `navigate('Profile')` | `navigate('Profile', undefined, { pop: true })` |
| `ProfileScreen.tsx:444`, `TopBarAccount.tsx:77` `navigate('Notifications')` | `{ pop: true }` |
| `TopBarAccount.tsx:91` `navigate('Profile')` | `{ pop: true }` |
| every `navigate('Subscription')` (8 sites) and `navigate('DataDeletion')` | `{ pop: true }` |
| `CollectionDetailScreen.tsx:157`, `AllStoriesScreen.tsx:65` `navigate('Main', { screen: 'Library' })` | `nav.popTo('Main', { screen: 'Library' })` |
| `RegistrationScreen.tsx:311` `replace('Login')` | `navigation.popTo('Login')` (pops to the Login below, or replaces when Registration is the root) |
| `LoginScreen.tsx:92, 103`, `RegistrationScreen.tsx:140, 150` `replace('Main')` | `navigation.reset({ index: 0, routes: [{ name: 'Main', params }] })` (7.10 sets `params` from the onboarding intent) |
| `AudioPlayerScreen.tsx:676` and `pushRouting.ts:157` `navigate('StoryDetail', { storyId })` | new helper `openStoryDetail(nav, storyId)` in `src/navigation/openStory.ts`: if the route directly below is StoryDetail with the same `storyId`, `goBack()`, else `navigate` |

Add `navigateSingleton(nav, name, params)` in `src/navigation/` as the one way to open
Profile, Notifications, Subscription and DataDeletion, so new call sites cannot forget
`pop`.

### 5.7 Tests

- `RootNavigator.test.tsx` (mocked Stack collecting options): `screenOptions.animation`
  is `ios_from_right`; no screen uses `slide_from_right` or `slide_from_bottom`; Main and
  Login use `fade`; Subscription `fade_from_bottom`; AudioPlayer has `freezeOnBlur:
  false`; lazy routes use `getComponent` and return the same component on two calls.
- `index` setup test: `freezeEnabled()` is true after importing the entry setup module
  (move the side effects into `src/setup/entry.ts`, imported by `index.ts`, so the test
  does not register the root component).
- Stack test with a real `NavigationContainer` and native stack: Main, Profile,
  Notifications, then "Bildirim tercihleri" ends at `[Main, Profile]`; Login, Registration,
  "Giriş yap" ends at `[Login]`; sign-up success ends at `[Main]`; CollectionDetail
  "Göster" ends at `[Main]` with the Library tab focused.
- `openStory.test.ts`: same story below goes back; different story pushes.
- `LegalMarkdown.test.tsx`: importing the module creates no parser; the first render
  creates one.

---

## 6. Quota and plans

### 6.1 Live contract (verified in `../sesly-backend`)

`plans.constants.ts:50-88` (`PLAN_LIMITS`), PRO is sold as "Premium", CREATOR is an admin
grant with at least Premium's limits:

| Plan | Ready-made narrations | Own-voice narrations | Own-voice creations | Clone slots | Narrator slots | Background, premium stories |
|---|---|---|---|---|---|---|
| FREE | 20 a month | 1 lifetime | 1 lifetime | 1 | 3 | no |
| MINI | unlimited | 5 a month | 2 a month | 1 | 10 | yes |
| PRO (Premium) | unlimited | 20 a month | 5 a month | 3 | 10 | yes |
| CREATOR | unlimited | 20 a month | 10 a month | 5 | 20 | yes |

- `GET /usage` (`usage.service.ts:265-304`):
  `{ plan, planName, renewsAt, buckets: { presetNarrations, cloneNarrations, cloneCreations }, voiceSlots: { preset: { used, limit }, clone: { used, limit } }, features: { backgroundPlayback, premiumStories } }`,
  each bucket `{ limit: number | null (null = unlimited), used, remaining: number | null, period: 'month' | 'lifetime', renewsAt: ISO string | null }`.
  Responses are not wrapped (the app already reads `/subscriptions/current` at top level).
- Narration 403 (`usage.service.ts:208-233`), from `POST /narrations` (pre-check,
  `narrations.service.ts:215`) and from `POST /narrations/:id/generate` (atomic consume,
  `:418`): body `{ code: 'QUOTA_PRESET_MONTHLY' | 'QUOTA_CLONE_LIFETIME' | 'QUOTA_CLONE_MONTHLY', bucket, tier, plan, limit, used, period, renewsAt, message }`.
  Units are never refunded except when generation could not start.
- `403 { code: 'PREMIUM_STORY' }` for FREE only (`narrations.service.ts:124-131`; MINI
  passes).
- `403 { code: 'CLONE_CREATION_LIMIT', plan, limit, used, period, renewsAt, message }`
  at clone create and at upload (`voice-profiles.service.ts:222-252, 339, 398, 461`).
  `CLONE_MONTHLY_LIMIT` is never thrown (only stale Swagger text).
- `GET /voice-profiles/slots` `clone.creations = { used, limit (-1 = unlimited), period, renewsAt, canCreate }`
  (`clone-quota.ts:150-230`); the legacy `monthlyCreated` / `monthlyLimit` carry lifetime
  numbers on FREE.
- The `message` fields are Turkish only; the app never shows them for these codes.

### 6.2 Plan identity (MINI)

Today `SubscriptionTier` has no MINI (`src/types/enums.ts:11-15`), so a Mini subscriber is
parsed as FREE (`:25-35`) and loses background playback, lock-screen controls and premium
stories, and `planIdForTier` (`Plans.ts:85-87`) shows Free.

- `enums.ts`: add `MINI = 'MINI'` and its `parseSubscriptionTier` case; add
  `isPaidTier(tier)` (anything but FREE). Delete `SubscriptionTierLabels` and
  `getSubscriptionTierLabel` and `SubscriptionStore.tierLabel` (no screen reads them,
  coverage test-23); plan names come from `PLANS[planId].brandName` and `plans:free`.
- `Plans.ts`: `planIdForTier`: FREE -> `free`, MINI -> `mini`, PRO and CREATOR ->
  `premium`. Delete the stale "backend has no Mini tier" and "BACKEND PLACEHOLDER (usage)"
  comments. Add `cloneCreations: PlanLimit` to each `PLANS` entry (free 1 lifetime, mini
  2 a month, premium 5 a month) so offline copy has numbers.
- `parseCurrentSubscriptionResponse` (`src/models/Subscription.ts:376-407`): apply the
  expiry downgrade with `isPaidTier`, not `isProTier`.

### 6.3 SubscriptionStore (`src/hooks/useSubscription.ts`)

- Remove `storiesUsedThisMonth`, `storiesLimit`, `voiceProfilesUsed`,
  `voiceProfilesLimit`, `applyTierLimits`, `hasReachedStoryLimit`,
  `hasReachedVoiceProfileLimit`, `storiesRemaining`, `voiceProfilesRemaining` and
  `TIER_LIMITS` (`constants.ts:113-130`, nothing else uses it; it contradicts the plans).
- Add `usage: UsageSummary | null`, `usageLoadedAt: number | null`,
  `usageError: boolean`.
- `loadUsage()` calls `GET /usage` and parses with `parseUsageSummary` (6.4). On 401 it
  stays silent, on other errors it keeps the previous value and sets `usageError`.
  Single-flight like 3.5.
- Getters:
  - `planId` = `usage?.planId ?? planIdForTier(currentTier)`;
  - `isPaid` = `planId !== 'free'`;
  - `canPlayInBackground` = `usage?.features.backgroundPlayback ?? isPaid`;
  - `hasPremiumStories` = `usage?.features.premiumStories ?? isPaid`;
  - `isPremiumPlan` = `planId === 'premium'` (used to decide whether a plans offer makes
    sense).
- Delete `isPro` / `isFree` after migrating every use (6.7), so `isPro` cannot be misread
  again.
- `refresh()` = `loadCurrentSubscription()` + `loadUsage()`. Also call `loadUsage()` after
  a narration starts (debounced 2 s), after any quota 403, after a voice creation, and on
  Profile focus when `usageLoadedAt` is older than 60 s. Two hard-coded Turkish toasts at
  `:268` and `:286` move to `msg()` keys (`subscription.cancelFailed`,
  `subscription.reactivateFailed`).

### 6.4 Quota model (new `src/models/Quota.ts`)

```ts
export type AllowancePeriod = 'month' | 'lifetime';
export interface UsageBucket { limit: number | null; used: number; remaining: number | null; period: AllowancePeriod; renewsAt: Date | null }
export interface UsageSummary {
  planId: PlanId;
  buckets: { presetNarrations: UsageBucket; cloneNarrations: UsageBucket; cloneCreations: UsageBucket };
  voiceSlots: { preset: { used: number; limit: number }; clone: { used: number; limit: number } };
  features: { backgroundPlayback: boolean; premiumStories: boolean };
}
export function parseUsageSummary(json: unknown): UsageSummary | null; // defensive; -1 or null limit = unlimited

export const QUOTA_CODES = {
  PRESET_MONTHLY: 'QUOTA_PRESET_MONTHLY',
  CLONE_LIFETIME: 'QUOTA_CLONE_LIFETIME',
  CLONE_MONTHLY: 'QUOTA_CLONE_MONTHLY',
  CLONE_CREATION: 'CLONE_CREATION_LIMIT',
  PREMIUM_STORY: 'PREMIUM_STORY',
} as const;
export interface QuotaBlock { code: QuotaCode; planId: PlanId; limit: number | null; period: AllowancePeriod | null; renewsAt: Date | null }
export function parseQuotaBlock(error: unknown, fallbackPlan: PlanId): QuotaBlock | null; // 403 + known code; plan from error.data.plan
export interface QuotaCopy { title: string; message: string; offerPlans: boolean; offerReadyMade: boolean }
export function describeQuotaBlock(block: QuotaBlock): QuotaCopy;
export function renewalLine(date: Date): string; // moved from PlanUsageCard
```

Rules in `describeQuotaBlock`:
- `message` = base sentence + (period `month` and `renewsAt`: `renewalLine`) + (when
  `offerPlans`: the upsell sentence), joined with a space.
- `offerPlans` = `planId !== 'premium'` for every code (FREE and MINI can upgrade;
  Premium and Creator cannot).
- `offerReadyMade` = true for `QUOTA_CLONE_LIFETIME` and `QUOTA_CLONE_MONTHLY`.
- `renewalLine(date)` = `i18n.t('profile:usage.renewsOn.' + date.getMonth(), { day: date.getDate() })`
  (the keys exist: "1 Kasım'da yenilenir." / "Renews on 1 November."). `PlanUsageCard`
  imports it from here.
- A number of 1 uses the `One` variant of the key (no i18next plural suffixes; Hermes has
  no `Intl.PluralRules`). No interpolation variable is named `count`.

### 6.5 Copy (new keys in `src/i18n/{tr,en}/messages.json`, namespace `messages`, read with `msg()`)

| Key | Turkish | English |
|---|---|---|
| `quota.presetMonthly.title` | Bu ayki masal hakkın doldu | You have used this month's stories |
| `quota.presetMonthly.message` | Ücretsiz planda hazır anlatıcılarla ayda {{limit}} masal dinleyebilirsin. | The free plan includes {{limit}} stories a month with ready-made narrators. |
| `quota.presetMonthly.upsell` | Mini ve Premium planlarda sınırsız. | Unlimited on Mini and Premium. |
| `quota.cloneLifetime.title` | Kendi sesinle masal hakkın doldu | You have used your own-voice story |
| `quota.cloneLifetime.messageOne` | Ücretsiz planda kendi sesinle 1 masal dinleyebilirsin. Bu hak yenilenmez. | The free plan includes 1 story in your own voice. It does not renew. |
| `quota.cloneLifetime.message` | Ücretsiz planda kendi sesinle {{limit}} masal dinleyebilirsin. Bu hak yenilenmez. | The free plan includes {{limit}} stories in your own voice. They do not renew. |
| `quota.cloneLifetime.upsell` | Kendi sesinle daha fazla masal için Mini ya da Premium plana geçebilirsin. | Switch to Mini or Premium for more stories in your own voice. |
| `quota.cloneMonthly.title` | Bu ay kendi sesinle masal hakkın doldu | You have used this month's own-voice stories |
| `quota.cloneMonthly.message` | Planında kendi sesinle ayda {{limit}} masal var. | Your plan includes {{limit}} stories a month in your own voice. |
| `quota.cloneMonthly.upsell` | Premium planda daha fazlası var. | Premium includes more. |
| `quota.creationLifetime.title` | Kendi ses hakkını kullandın | You have used your own voice |
| `quota.creationLifetime.message` | Ücretsiz planda kendi sesini bir kez kaydedebilirsin. Bu hak yenilenmez, sesi silmek de yeni hak vermez. | On the free plan you can record your own voice once. It does not renew, and deleting the voice does not give it back. |
| `quota.creationLifetime.upsell` | Yeni bir ses için Mini ya da Premium plana geçebilirsin. | Switch to Mini or Premium to record a new voice. |
| `quota.creationMonthly.title` | Bu ayki yeni ses hakkın doldu | You have used this month's new voices |
| `quota.creationMonthly.messageOne` | Planında ayda 1 yeni ses kaydı var. | Your plan includes 1 new voice a month. |
| `quota.creationMonthly.message` | Planında ayda {{limit}} yeni ses kaydı var. | Your plan includes {{limit}} new voices a month. |
| `quota.creationMonthly.upsell` | Premium planda daha fazlası var. | Premium includes more. |
| `quota.premiumStory.title` | Bu masal ücretli planlarda | This story is in the paid plans |
| `quota.premiumStory.message` | Mini ya da Premium planla dinleyebilirsin. | Listen to it with Mini or Premium. |
| `quota.seePlans` | Planları gör | See plans |
| `quota.readyMade` | Hazır anlatıcıyla dinle | Listen with a ready-made narrator |

`cloneMonthly.upsell` and `creationMonthly.upsell` are only reachable for MINI (Premium has
no offer). Plan-name cleanup in the same files (verified current text): `subscription.soonMessage`
"Pro abonelik yakında kullanıma sunulacak." -> "Abonelikler yakında açılıyor." / "Paid
plans are coming soon."; `player.backgroundPaidTitle` "Premium Özellik" -> "Ücretli plan
özelliği" / "Paid plan feature" (Mini has it too); `player.backgroundPaid` -> "Ekran
kapalıyken dinlemek Mini ve Premium planlarda var." / "Listening with the screen off is
part of Mini and Premium."; the four "Sesly Pro ile daha fazla ses ekleyebilirsin"
sentences (`voice.cloneLimitMessageFree`, `voice.presetLimitMessageFree`,
`clone.slotLimitFree`, `clone.presetLimitFree`): own-voice ones end "... ya da Premium
planla daha fazla kendi ses ekleyebilirsin." (Mini has the same single clone slot),
narrator ones end "... ya da Mini veya Premium planla daha fazla anlatıcı
ekleyebilirsin."; the own-voice FREE ones also drop "Mevcut sesini silebilir" (a delete
never returns a FREE creation). `voiceFlow.plansAction` "Sesly Pro'yu incele" -> "Planları
gör" / "See plans". The voice spec owns the dialogs that show these strings.

### 6.6 Where a quota block is shown

- **AudioGeneration** (`src/hooks/useAudioPlayer.ts:615-621`, `AudioGenerationScreen.tsx:291-310`):
  in `generateAudio`'s catch, `parseQuotaBlock(error, subscriptionStore.planId)`; when it
  is non-null set an observable `quotaBlock`, `isGenerating = false`, and do NOT call
  `setError` (which toasts). Clear `quotaBlock` in `clearError` and when a new generation
  starts. Then `void subscriptionStore.loadUsage()`. The screen renders, before the error
  branch, a `StateView` testID `generation-limit` with icon `lock`, the title and message
  from `describeQuotaBlock`, and a dock with: `quota.seePlans` (primary, md block,
  `navigateSingleton(nav, 'Subscription')`) when `offerPlans`; `quota.readyMade` (secondary
  when plans are offered, otherwise primary) leaving back to StoryDetail when
  `offerReadyMade`; otherwise `common:ok` leaving back. Never "Tekrar dene". If the player
  spec moves generation into its own fields, `quotaBlock` moves with them.
- **StoryDetail pre-check** (`StoryDetailScreen.tsx:429` `handleStartNarration`): when
  `subscriptionStore.usage` is loaded and the bucket for the selected voice
  (`cloneNarrations` for an own voice, `presetNarrations` otherwise) has
  `remaining === 0`, show the same copy in a `useDialog` dialog (buttons in the order
  [`common:cancel`, `quota.seePlans`] when `offerPlans`, else `common:ok`) and do not
  navigate. When usage is unknown, go on; the backend still decides. The "Baştan hazırla"
  confirmation (detail spec, ux-8) also names the remaining count from the same bucket.
- **StoryDetail remaining line**: under the dock CTA, one `text.meta` line (testID
  `story-quota-left`, `T.text2`, no reserved space when hidden) when the bucket for the
  selected voice has `limit !== null` and `remaining <= 3`:
  `detail:quota.presetLeft` "Bu ay {{left}} masal hakkın kaldı" / "{{left}} stories left
  this month" (`presetLeftOne` "Bu ay 1 masal hakkın kaldı" / "1 story left this month");
  `detail:quota.cloneLeftMonth` "Bu ay kendi sesinle {{left}} masal hakkın kaldı" /
  "{{left}} own-voice stories left this month" (`cloneLeftMonthOne` "Bu ay kendi sesinle 1
  masal hakkın kaldı" / "1 own-voice story left this month");
  `detail:quota.cloneLeftLifetimeOne` "Kendi sesinle 1 masal hakkın var, yenilenmez." /
  "You have 1 story in your own voice. It does not renew." (and `cloneLeftLifetime` with
  `{{left}}`). At 0 the CTA keeps its label and the pre-check dialog explains.
- **Premium stories**: `CollectionDetailScreen.tsx:64, 124, 195, 201` lock on
  `!subscriptionStore.hasPremiumStories` (was `!isPro`); its dialog uses
  `quota.premiumStory.*`. StoryDetail's 403 state (`:331-342`) uses the same copy and
  `navigateSingleton`.
- **Voice flow** (`src/models/VoiceClone.ts:388-489`): replace `CLONE_MONTHLY_LIMIT` with
  `CLONE_CREATION_LIMIT`; that case builds title and message from
  `describeQuotaBlock(parseQuotaBlock(error, plan))` and returns action `paywall` when
  `offerPlans`, else `none`, never `retry`. Known codes never use the server sentence
  (`backendMessage` only for the default branch, and only when the UI language is
  Turkish). `describeCloneError(error, isPro)` becomes `describeCloneError(error, planId)`.
  `parseCloneSlot` (`src/models/VoiceProfile.ts:297-307`) reads `creations` into
  `CloneSlotInfo.creations: { used, limit (null for -1), period, renewsAt, canCreate }`;
  `isCloneMonthlyLimitReached` becomes `isCloneCreationLimitReached` on that field.
  `describeSlotBlock` (`useVoiceProfile.ts:62-110`) uses the `quota.creation*` copy for a
  used-up creation allowance. The voice spec owns the Sesim and recording UI that shows
  these; this spec owns the mapping and the copy.
- **Background playback**: `useAudioPlayer.ts:263, 331, 1218-1246, 1264` gate on
  `canPlayInBackground` (was `isPro`). The lock-note UI for free users is the player
  spec's (ux-2).

### 6.7 `isPro` migration (every non-test use, verified)

| File:line | New check |
|---|---|
| `useAudioPlayer.ts:263, 331, 1218, 1232, 1264` | `canPlayInBackground` |
| `CollectionDetailScreen.tsx:64, 124, 195, 201` | `hasPremiumStories` |
| `SubscriptionScreen.tsx:86-114, 254-267` | current plan from `planId` (6.8) |
| `VoiceProfilesScreen.tsx:136, 223, 448-449` | plans offer when `!isPremiumPlan`; free-plan line when `planId === 'free'` |
| `useAddNarrator.ts:53-108`, `StoryDetailScreen.tsx:514`, `CreateVoiceProfileScreen.tsx:133`, `VoiceRecordingScreen.tsx:391`, `useVoiceRecording.ts:530-594` | pass `planId`; offer plans when `planId !== 'premium'` |
| `useVoiceProfile.ts:62-110, 201` (`describeSlotBlock`, `slotBlock`) | take `planId`; FREE copy when `planId === 'free'`, plans offer when not premium |
| `models/User.ts:71-73` `isUserPro` | delete if unused, else `isPaidTier` |
| `models/Subscription.ts:398` | `isPaidTier` |

### 6.8 Plan usage card and plans screen logic

- `ProfileScreen.tsx:114-118`: `usage = subscriptionStore.usage`, `planId =
  subscriptionStore.planId`. Delete `mapPlanUsage`, `BackendUsageSnapshot`
  (`Plans.ts:136-162`) and `planLimits.ts` (`FREE_PLAN_OWN_VOICE_STORIES_TOTAL` becomes
  `PLANS.free.clonedNarrations.amount` at its single call site, or the live bucket limit).
- `PlanUsageCard` (`src/components/profile/PlanUsageCard.tsx`) keeps its look and its
  `usage.*` keys (they already handle unlimited, lifetime and the renewal date). New
  inputs: `meters: { preset: UsageBucket; cloned: UsageBucket } | null` and `loading`.
  - meters known: the two rows it already draws (`usage-preset`, `usage-cloned`);
  - loading and nothing cached: two skeleton rows of the same height (no jump when the
    data lands);
  - failed with nothing cached: the plan's limit lines as plain text (Nunito 700,
    13.5/19, `T.text2`), from `planLimitLines` moved out of `SubscriptionScreen.tsx:57-67`
    into `models/Plans.ts` (takes a `t` for the `plans` namespace).
  - The card does not show voice creations (Sesim shows those).
- Plans screen logic (`SubscriptionScreen.tsx`): the current plan is `planId`; the CTA is
  hidden for the current plan and for lower plans; until in-app purchase ships the CTA is
  disabled with the label `plans:soon.note` and opens no dialog (the "Abonelikler
  yakında" dialog at `:97-104` and the separate "soon" tag at `:253-262` go; one message,
  in the button); `plans-restore` is hidden while there is nothing to restore. Add to
  `planLimitLines` for mini and premium: "Ekran kapalıyken dinleme" / "Listening with the
  screen off" and "Premium masallar" / "Premium stories"; for free "Ekran kapanınca masal
  durur" / "The story stops when the screen turns off". Layout and accessibility of this
  screen (sub-1, sub-2) are the account UI spec's.

### 6.9 Tests

- `src/test-utils/contract-fixtures.ts`:
  - add `backendUsageFree`, `backendUsageMini` (copied from `getUsageSummary` output:
    ISO `renewsAt`, `limit: null` for unlimited);
  - add `backendQuotaPresetMonthlyError`, `backendQuotaCloneLifetimeError`
    (`renewsAt: null`), `backendQuotaCloneMonthlyError` (plan MINI),
    `backendCloneCreationLimitError` (lifetime and monthly variants), each with
    `statusCode`, `code`, `plan`, `limit`, `used`, `period`, `renewsAt`, `message`;
  - fix `backendVoiceSlots` to the exact FREE `buildVoiceSlotInfo` output (with
    `creations`, `monthlyLimit: 1`);
  - `backendEnums.SubscriptionPlan` gets `MINI`; refresh `backendPlans` from
    `PLAN_LIMITS` / `PLAN_PRICES` (MINI 49.99, PRO 199.99 and 1499.99 yearly).
- `contract.test.ts`: a 403 QUOTA_* `ApiError` keeps `code`, `limit`, `period`,
  `renewsAt`, `plan` in `data`; a user with `subscriptionTier: 'MINI'` parses to MINI;
  `PLANS` numbers equal the fixture plan limits (catches drift).
- `Quota.test.ts`: `parseUsageSummary` (null limit, -1 limit, bad shapes return null);
  `describeQuotaBlock` for each code and plan: FREE preset has the renewal date and the
  upsell; FREE clone lifetime says it does not renew and offers ready-made; MINI clone
  monthly offers plans and Premium upsell; PRO clone monthly offers no plans; English copy
  has no Turkish text; the `One` variants are used at 1.
- `enums.test.ts` / `Plans.test.ts`: `parseSubscriptionTier('MINI') === MINI`;
  `isPaidTier(MINI)` true; `planIdForTier('MINI') === 'mini'` (replaces
  `Plans.test.ts:62`, which pins `'free'`).
- `useSubscription.test.ts`: `loadUsage` parses `/usage`; MINI gives `isPaid` and
  `canPlayInBackground` true; delete the `TIER_LIMITS` getter tests (`:105-147`).
- `useAudioPlayer.test.ts`: a quota 403 from create or from generate sets `quotaBlock`,
  does not call `showToast`, sets `isGenerating` false and triggers `loadUsage`; a MINI
  user is not paused on `AppState` background.
- `AudioGenerationScreen.test.tsx`: `generation-limit` visible, no "Tekrar dene",
  "Planları gör" navigates to Subscription (FREE), PRO clone monthly shows only "Hazır
  anlatıcıyla dinle"; an English-UI variant asserts English copy.
- `StoryDetailScreen.test.tsx`: `remaining 0` opens the dialog and does not navigate;
  `story-quota-left` shows at 2 left and is hidden for unlimited.
- `VoiceClone.test.ts`: `CLONE_CREATION_LIMIT` returns `paywall` for free and mini,
  `none` for premium, never `retry` (replaces the `CLONE_MONTHLY_LIMIT` case at
  `:344-359`); lifetime copy never mentions a month.
- `ProfileScreen.test.tsx` / `profile.test.tsx`: the card shows the two bars from
  `backendUsageFree` ("0 / 20 masal", "Ücretsiz planda toplam 1 masal. Yenilenmez.");
  loading shows skeleton rows of the meter height; failure shows the limit lines.
- `i18n.test.ts`: no tr or en value matches `/Sesly Pro|\bPro abonelik/`.

---

## 7. Auth forms and onboarding

### 7.1 Keyboard: one mechanism, react-native-keyboard-controller

Verified cause class: `LoginScreen.tsx:111` and `RegistrationScreen.tsx:159` wrap the
scroll view in RN `KeyboardAvoidingView behavior="padding"`; under edge-to-edge
(`gradle.properties edgeToEdgeEnabled=true`) RN derives the keyboard frame from
`getWindowVisibleDisplayFrame` (`ReactRootView.java:908-950`), and the emulator shows
about 76dp of padding left after the keyboard closes (status bar plus 3-button bar), and a
focused last field partly under the keyboard.

Decision: add `react-native-keyboard-controller` (`npx expo install`, SDK-matched; it
autolinks, needs `react-native-reanimated`, which is installed, and goes into the same
native rebuild as 1.3). It tracks the IME with window insets animations on every API
level, edge-to-edge included, and frame by frame.

- `App.tsx` AppShell: `<KeyboardProvider statusBarTranslucent navigationBarTranslucent>`
  around the SafeAreaProvider. Keep `android:windowSoftInputMode="adjustResize"`.
- Login and Registration: replace `KeyboardAvoidingView` + `ScrollView` with
  `KeyboardAwareScrollView` from the library: `bottomOffset={T.space.lg}`,
  `keyboardShouldPersistTaps="handled"`, `keyboardDismissMode="on-drag"`, the same
  `contentContainerStyle`. It pads only while the keyboard is up and scrolls the focused
  field into view.
- `BottomSheet` keyboard handling (PasswordResetSheet) belongs to the sheets spec; the
  requirement from this spec: the reset field and its button sit above the keyboard while
  it is up and the sheet returns to its natural height when it closes. Use the same
  library (`KeyboardAvoidingView` from react-native-keyboard-controller, or its sticky
  view if sheets become an in-window host).
- Jest: `jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'))`
  in `src/test-utils/mocks/native-modules.ts`; add the package to
  `transformIgnorePatterns`.
- Reanimated stays installed (keyboard-controller needs it); perf-21's removal is
  dropped.

### 7.2 Return-key chain

- `TextFieldProps` (`src/components/design/rows.tsx:414-422`) gets
  `ref?: React.Ref<TextInput>`, destructured and passed to the inner `TextInput`
  (React 19 ref-as-prop; the other call sites are unaffected).
- Login: email `returnKeyType="next"`, `submitBehavior="submit"`,
  `onSubmitEditing={() => passwordRef.current?.focus()}`; password `returnKeyType="go"`,
  `onSubmitEditing={handleLogin}`.
- Registration (fields after 7.6: name, email, password): `next` / `next` / `go`, the
  last one calls `handleRegister`.
- Reset sheet: `returnKeyType="send"`, `onSubmitEditing={handleSubmit}`.

### 7.3 Consent and legal links

- Registration (`RegistrationScreen.tsx:232-250`): remove `onPress` from the outer
  consent `Text` (`:240`); only the Checkbox toggles. The two nested link `Text`s get
  `accessibilityRole="link"`. The Checkbox `accessibilityLabel` becomes the new
  `auth:register.consentShort` ("Şartları kabul ediyorum" / "I accept the terms"), so the
  sentence is not read twice; delete `register.consentLabel`.
- Login legal line (`LoginScreen.tsx:201-210`): `accessibilityRole="link"` on both links.
- Social sign-up consent: Registration gets the same `auth:login.legal` line ("Devam
  ederek Kullanım Şartları'nı ve Gizlilik Politikası'nı kabul etmiş olursun.") directly
  under the social buttons, marginTop `T.space.md`, same styles as Login.
- Remove `SocialConsentSheet` (`src/components/auth/SocialConsentSheet.tsx`, its tests in
  `AuthSheets.test.tsx`, the `auth:social.*` keys): Google's and Apple's own system sheets
  already tell the user what is shared, the legal line covers the terms, and the extra
  sheet cost a tap on every sign-in. Google and Apple buttons call
  `handleSocialContinue(kind)` directly. (This also removes r8a-12, the Apple text flip.)
- Email registration keeps the checkbox (owner question 12.1, default keep).

### 7.4 Errors shown once, under the right field

- `useAuth.ts:357, 405, 435`: remove `showToast.error` from `signInWithEmail`,
  `registerWithEmail` and `resetPassword` (their only callers are the auth screens and
  the reset sheet, verified). Keep the toasts of `signInWithGoogle` / `signInWithApple`
  (no field to attach to); they use `msg()` copy, never `error.message` from the server
  in English UI (4.4).
- `AuthService.handleAuthError` (`AuthService.ts:543-596`) returns
  `AuthFieldError extends Error { field: 'email' | 'password' | null }`:
  `auth/invalid-email`, `auth/user-not-found`, `auth/email-already-in-use` -> `email`;
  `auth/wrong-password`, `auth/weak-password`, `auth/invalid-credential` in
  `Email login` -> `password`; everything else (network, too many requests, ApiError)
  -> `null`. The store keeps `errorField` next to `errorMessage`.
- Screens and the reset sheet: a field error goes under that field; a `null` field goes
  into one form-level line directly above the submit button (`text.bodySmall`,
  `T.error`, `accessibilityLiveRegion="polite"`, testID `login-form-error` /
  `register-form-error` / `reset-form-error`). No snackbar for these flows.
- Delete the now unused `auth.signInFailedTitle` ("Giriş Başarısız", title case).

### 7.5 Busy state on the right button

`authStore.isLoading` disappears (3.2). Login and Registration keep
`const [pending, setPending] = useState<'email' | 'google' | 'apple' | null>(null)`, set
before the await and cleared in `finally`:
- the pressed button: `loading={pending === kind}`, full colour, `busy` in its
  accessibility state, label unchanged (`login.submit`, `register.submit`);
- the other auth buttons: `disabled={pending !== null}`;
- fields: `editable={pending === null}`;
- `RegistrationScreen.tsx:121` guard becomes `if (pending) return`;
- PasswordResetSheet: `loading={submitting}` only, label unchanged; drop
  `disabled={authStore.isLoading}` (`:98`).
- Delete `login.submitting`, `register.submitting`, `reset.submitting` (tr and en).
The loading spinner's layout inside Button (label width kept, spinner centred) is the
design-system spec's (r10-16); this spec only requires `loading` on the pressed button.

### 7.6 Registration form

- One name field: `auth:register.name` "Adın" / "Your name" (placeholder none); remove
  last name and "Şifre (tekrar)" (`RegistrationScreen.tsx:182-192, 219-230`). The backend
  DTO has both names optional (`../sesly-backend` `firebase-token.dto.ts:13-30`); the
  password field already has show/hide. `authValidation.ts:50-91`: drop `lastName` and
  `passwordConfirm` from the form, validation and `canSubmitRegistration`. Delete keys
  `register.firstName`, `register.lastName*`, `register.passwordConfirm*`,
  `errors.lastNameRequired`, `errors.passwordConfirmRequired`,
  `errors.passwordMismatch`. `AuthService.registerWithEmail` sends `lastName` only when
  given.
- The submit button stays enabled (no greyed-out button without a reason). On press,
  `handleRegister` validates and shows field errors plus, without consent, the new
  `auth:register.consentRequired` "Devam etmek için şartları kabul et." / "Accept the
  terms to continue." under the checkbox.
- Sign-in and sign-up success reset the stack (5.6).

### 7.7 First-run title, alternate row, spacing

- Login with `route.params?.firstRun` shows `auth:login.titleFirstRun` "Hoş geldin" /
  "Welcome"; otherwise "Tekrar hoş geldin".
- `login.forgot` English "Forgot password?" (Turkish unchanged).
- Alternate rows ("Hesabın yok mu? Kayıt ol", "Zaten hesabın var mı? Giriş yap"): the
  text button gets `style={{ marginLeft: -8 }}` so the visible gap is about 4dp while its
  48dp touch target stays (the same pattern as `login-forgot`'s `marginRight: -12`).
- Spacing on the T.space scale (4/8/12/16/20/28/40), both screens: title marginTop
  `md`; first field `xl`; between fields `lg`; consent row marginTop `xs`; submit
  marginTop `sm`; forgot button no vertical margin; "ya da" row minHeight `T.touch` with
  marginTop `xs`; spacer minHeight `lg`.

### 7.8 Auth buttons

Primary submit buttons on Login, Registration and the reset sheet use `size="md"` with
`block` (only lg stretches by itself, `Button.tsx:112`), per the R4 decision that lg is
for the onboarding footer and docks only. Google / Apple stay `secondary` md block.

### 7.9 What the auth screens need from the design-system spec

TextField with a visible resting border and a strong focus ring on `bg` and inside
sheets (r8a-3, visual-auth 4 and 18); secondary buttons that stand out on `bg` (r5-1);
the checkbox boundary at 3:1. Auth screens add no local colour overrides.

### 7.10 Onboarding (`src/screens/onboarding/OnboardingScreen.tsx`)

- Top row: `styles.top.minHeight` = `T.touch` (48); on the last page render an empty
  `View` of the Skip button's size instead of `null` (`:162-173`), so nothing moves 12dp.
- Footer: only the primary button. Remove the reserved second slot (`secondSlot`, 62dp)
  and "Hazır anlatıcıyla başla" (it did the same as "Atla"); this removes the empty band
  on pages 1 and 3 and most of the voice-page overflow at 360x760 with 3-button
  navigation.
- Primary: page 1 "Devam"; voice page "Sesimi kaydet" with the mic icon; last page
  "Başla". "Sesimi kaydet" now stores AsyncStorage `@sesly/onboardingIntent` = `record`
  and finishes onboarding (no detour to page 3). "Atla" finishes without intent.
- `finish()` replaces with `Login` and `{ firstRun: true }`. After the first successful
  sign-in or sign-up, the screen reads and removes the intent and resets to
  `[{ name: 'Main', params: intent === 'record' ? { screen: 'Voices' } : undefined }]`
  (Sesim, where the own-voice card applies the plan and slot rules).
- Pictures: `expo-image` `Image` with `contentFit="cover"` and `transition={0}` (decodes
  to view size; the files are 1080x1440). The first picture's `onLoad` resolves the splash
  release (1.6). Optionally re-export the three WebPs at 720x960.
- Copy: `pages.voice.title` gets a final period in tr ("Masalları senin sesinle
  anlatalım.") and en ("Let us tell the stories in your voice."); `pages.sleep.body` tr
  "Sevdiğin masalları sakla. Uyku zamanlayıcısını kur, masal bitince kendiliğinden
  dursun." / en "Keep the stories you love. Set the sleep timer and playback stops by
  itself when the story ends."; `pageOf` tr "Sayfa {{current}}, toplam {{total}}".
  Delete `readyNarrator`.

### 7.11 Tests

- `AuthScreens.test.tsx`:
  - `submitEditing` on `login-email` focuses the password input; on `login-password`
    calls `signInWithEmail`; the Registration chain likewise ends in `registerWithEmail`;
  - pressing the "Kullanım Şartları" link opens the legal sheet with `tos` and does not
    toggle consent; the "Gizlilik Politikası" link opens `privacy`; the checkbox toggles;
    `getAllByRole('link')` has 2 on Login and 4 on Registration;
  - a failed email sign-in with `auth/wrong-password` shows the message once, under the
    password field, and `showToast.error` is not called; a network failure shows
    `login-form-error`;
  - with `signInWithGoogle` pending: `login-google` has `busy: true`, `login-submit`
    still reads "Giriş yap" and is disabled; nothing is busy during the launch restore;
  - Google and Apple call the store directly (no consent sheet);
  - Registration without consent shows `consentRequired` and does not call the store;
    there is no last-name or repeat field;
  - "Giriş yap" on Registration calls `popTo('Login')` (replaces the `:415-421` case);
  - success resets to Main; with intent `record` the reset targets `Voices` and removes
    the key; `firstRun` shows "Hoş geldin".
- `AuthSheets.test.tsx`: `submitEditing` on `reset-email` calls `resetPassword`; a failed
  reset shows `reset-form-error` (network) or the field error and no snackbar; remove the
  SocialConsentSheet cases.
- `authValidation.test.ts`: valid without last name and repeat.
- `rows` test: TextField forwards its ref (`ref.current.focus` is a function).
- `OnboardingScreen.test.tsx`: top row minHeight 48 on every page; no `onboarding-ready`;
  "Sesimi kaydet" stores the intent and replaces with `('Login', { firstRun: true })`;
  "Atla" stores nothing (replaces `:90-98`); pictures render expo-image with
  `contentFit="cover"`; `pageOf` label "Sayfa 1, toplam 3".

---

## 8. Build and packaging

### 8.1 Fonts

The Oct 16 release APK holds 91 TTF files (33 MB of 62 MB): stale generated
`res/raw` from older bundles (icon sets, Noto, Fredoka) plus all 16 Nunito and 5 Baloo 2
weights pulled in by the package-root imports at `App.tsx:12-13`.

- `App.tsx`: subpath imports
  `import { Baloo2_600SemiBold } from '@expo-google-fonts/baloo-2/600SemiBold';`
  `import { Nunito_700Bold } from '@expo-google-fonts/nunito/700Bold';`
  `import { Nunito_800ExtraBold } from '@expo-google-fonts/nunito/800ExtraBold';`
  (verified: these folders exist with `index.js` and `index.d.ts`, no `exports` map
  blocks them). Keep `...Ionicons.font` (only the Ionicons TTF; `Icon.tsx` imports
  `@expo/vector-icons/Ionicons`).
- Fonts stay loaded through `useFonts` (cross-platform, no Xcode project surgery). Native
  embedding is not done in this release: with the native splash holding until the first
  screen, the remaining cost is a few to about 15 ms per launch.
- Delete the unused `assets/fonts/NotoSerif-*.ttf` (4.3 MB in the repo, referenced
  nowhere).
- Release checklist: `cd android && ./gradlew clean` before every release build (the
  stale `generated/res/react/release/raw` files are what put 18 icon fonts, Noto and
  Fredoka in the APK).
- `src/theme/fonts.test.ts:88-90`: expect the subpath imports, assert no file in `src`
  or `App.tsx` imports the bare `@expo-google-fonts/baloo-2` or `/nunito` roots, and
  assert each registered file's PostScript name (name table ID 6) equals its `FONTS`
  value (verified today: `Baloo2-SemiBold`, `Nunito-Bold`, `Nunito-ExtraBold`).

### 8.2 R8 and resource shrinking

`android/gradle.properties`: `android.enableMinifyInReleaseBuilds=true` and
`android.enableShrinkResourcesInReleaseBuilds=true` (read at `app/build.gradle:69, 124-126`).
Shrinking also drops stale raw fonts (the generated `raw/keep.xml` lists only the current
bundle's assets). Keep the generated `mapping.txt` with each release and upload it to Play
Console. Release smoke on the minified build (8.6); add `-keep` rules to
`app/proguard-rules.pro` only for classes that actually break. Remove the reanimated keep
comment only if reanimated is ever removed (it stays, 7.1).

### 8.3 Console stripping (no new package)

Add `babel.config.js`:
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: { production: { plugins: ['./babel/strip-console.js'] } },
  };
};
```
and `babel/strip-console.js`, a local Babel plugin that removes `console.log`,
`console.info`, `console.debug` and `console.trace` calls (an expression statement is
removed, any other position becomes `undefined`) and keeps `warn` and `error`. Expo's
transformer sets `BABEL_ENV=production` for non-dev bundles
(`@expo/metro-config/build/babel-transformer.js:102`, verified), so only release bundles
change; jest runs with `NODE_ENV=test`. Also delete the four DEBUG dumps in
`src/models/Story.ts:336-360`. Clear the Metro cache after adding the file.

### 8.4 expo-asset duplicate

Two copies are installed (root 55.0.15 via expo-audio's `"*"`, `expo/node_modules`
55.0.16). Run `npx expo install expo-asset` (adds `~55.0.16` as a direct dependency) then
`npm dedupe`; `npm ls expo-asset` must show one version. This changes a native module
version, so it rides the same rebuild.

### 8.5 APK size note

The `apk-release` EAS profile builds a universal APK for four ABIs
(`reactNativeArchitectures` includes x86 and x86_64). Store releases go as an AAB (Play
splits per ABI and density). For sideloaded test APKs, build with
`-PreactNativeArchitectures=arm64-v8a,armeabi-v7a`. Target after 8.1 and 8.2: universal
APK under 30 MB.

### 8.6 Release smoke (minified build, Maestro plus manual)

Cold start dark, signed in and signed out; Google sign-in; email sign-in and sign-up;
FCM foreground toast and a tap from a killed app; playback, lock screen and the Media3
notification (`modules/sesly-media`); voice recording and upload; encrypted storage
across restarts; offline start with and without a cached user; force update via a raised
backend minimum on a test build.

---

## 9. Consolidated test plan

Unit and component (jest): 1.7, 2.6, 3.8, 4.5, 5.7, 6.9, 7.11, 8.1 and 8.3:
- `babel/strip-console.test.js`: transforming `console.log(x); console.warn(y); const z = console.info(1);`
  leaves `console.warn(y)` and `const z = undefined`.
- `babel.config.js` test: `env.production.plugins` contains the local plugin.

Shared test infrastructure (do once; also used by other specs):
- `src/test-utils/mocks/navigation.ts`: `setMockFocused(boolean)` instead of the
  constant `useIsFocused: () => true` (coverage test-10), reset in `afterEach`.
- `src/test-utils/setup.ts`: stop hiding act() and missing-key warnings and make only
  those two fail (coverage test-9); switch languages in tests inside `act`.
- Mocks: `expo-splash-screen` (`preventAutoHideAsync`, `hideAsync`, `setOptions` as jest
  fns), react-native-keyboard-controller, NetInfo (4.2).
- After every spec of this pass lands, raise `coverageThreshold` to one point below the
  measured numbers.

E2E (Maestro, `e2e/maestro`, selectors by testID with `id:`; the current steps use copy
that no longer exists, coverage test-19):
- `steps/launch.yaml`: wait for `onboarding` or `login-screen` testIDs, no Splash text.
- `steps/register.yaml`: name, email, password, consent checkbox `register-consent`,
  `register-submit`.
- `steps/logout_login.yaml`, `steps/sign_out.yaml`: after sign-out the Login screen is
  visible within 2 s, no splash.
- `steps/delete_account.yaml`: success toast, then Login.
- New `offline_start.yaml`: signed in, `setAirplaneMode: enabled`, `stopApp`,
  `launchApp`, assert the Home tab (`tab-Stories`) and `offline-banner` within 3 s;
  `setAirplaneMode: disabled`, assert the banner disappears.
- New `cold_start.yaml`: `launchApp`, `takeScreenshot` at once and after 300 ms; a
  pngjs script (`e2e/scripts/check-launch-colours.js`) fails when the centre-top pixel is
  lighter than L* 30 (catches any cream frame).
- New `quota_free.yaml` (local stack, a FREE test user whose preset bucket is used up via
  the backend e2e helper): StoryDetail shows `story-quota-left` or the quota dialog, and
  AudioGeneration never shows "Tekrar dene".

---

## 10. Native rebuild, backend, owner-visible

Native changes (one rebuild covers all): expo-splash-screen (new module, MainActivity,
styles); react-native-keyboard-controller (new module); `MainApplication.kt` night mode;
AppTheme parent; colours; `values-night` and the layer-list deleted; splash PNGs and the
inset drawable; `gradle.properties` R8 and shrinking; expo-asset version change; iOS
Info.plist, colorset, storyboard, splash images and `pod install`.

Backend: nothing required. The contract used here is deployed. Optional, docs only:
`voice-profiles.controller.ts:121, 133, 158` Swagger text still names
`CLONE_MONTHLY_LIMIT`; `PREMIUM_STORY_REQUIRED_MESSAGE` says "Pro" (the app no longer
shows it).

What the owner will notice:
- Cold start is dark from the first frame: the bird mark on `#121A29`, no cream flash,
  no second animated "sesly" splash, no slide; a returning user lands on Masallar even
  offline.
- A signed-in user with no saved session data who starts offline or while the server is
  down sees "İnternete bağlı değilsin" (or the server / maintenance variant) with
  automatic retry, never Login. While using the app offline, "Çevrimdışısın" shows above
  the tab bar.
- Sign-out goes straight to Login. A failed account deletion no longer signs out.
- Screen changes are faster (200 ms slide, 150 ms fade; tabs switch instantly).
- Registration asks for name, e-mail and password only; Google and Apple sign in without
  the extra info sheet; the terms line sits under the social buttons; "Hesap oluştur" is
  always tappable and explains what is missing; Enter moves to the next field and submits
  on the last one; errors appear once, under the right field; only the tapped button
  shows a spinner.
- Onboarding: no reserved empty space under the main button; "Sesimi kaydet" leads to
  Sesim after sign-in; first-run Login says "Hoş geldin".
- Limits are visible: Profile shows the usage bars; running out shows a specific message
  with "Planları gör" instead of "Masal hazırlanamadı" and a retry that fails again;
  StoryDetail warns when 3 or fewer stories are left. Mini subscribers get background
  playback, the lock screen and premium stories.
- Release builds are minified and shrunk (APK much smaller) and carry no `console.log`.

---

## 11. Implementation order

1. **Package installs need their own node_modules.** `node_modules` in this worktree is a
   junction to the main checkout, which a running Metro and emulator audit is using. Do
   not run `npm install` / `npx expo install` through the junction. When the visual audit
   is done (or now, if it must not wait): `cmd /c rmdir node_modules` (removes only the
   link; never `Remove-Item -Recurse` on a junction), then `npm ci` in the worktree, then
   the installs: `npx expo install expo-splash-screen react-native-keyboard-controller expo-asset`,
   `npm dedupe`, `npx expo install --fix`.
2. Session core: token cache (3.5), userCache (3.1), restoreSession classification
   (3.3), AuthStore (3.2), tests.
3. Boot: `src/boot/*`, App.tsx, RootNavigator initial state, removal of the Splash route,
   force update in the background (2.x), tests.
4. Native launch (1.x), splash release, native config test; rebuild; check on the AVD
   and an Android 10 target.
5. Offline (4.x).
6. Navigation (5.x).
7. Quota and plans (6.x).
8. Auth and onboarding (7.x) after the keyboard library is in.
9. Build (8.x), release build, smoke (8.6), Maestro (9).

Every step ends with `npx tsc --noEmit` clean and `npm test` green.

---

## 12. Owner questions (each with the default to build)

1. Email sign-up consent checkbox: keep it (default) or replace it with the same "Devam
   ederek ... kabul etmiş olursun." line the social buttons use. Default: keep.
2. The Google / Apple info sheet is removed (7.3). Default: removed; say if the KVKK
   review wants it back.
3. "Hazır anlatıcıyla başla" on onboarding page 2 is removed in favour of "Atla" (7.10),
   a small deviation from design frame f. Default: removed.
4. iOS force update without a store link: set `storeUrl.ios` in the backend app config
   once the App Store listing exists. Default: nothing in the app.
5. Security, not a behaviour: `android/gradle.properties` is tracked in git with the
   upload keystore passwords. Move `MYAPP_UPLOAD_*` to `%USERPROFILE%\.gradle\gradle.properties`
   and remove them from the repo history if it was ever shared; with Play App Signing the
   upload key can be reset in Play Console. Default: owner does this before the store
   upload; this spec changes nothing there.
