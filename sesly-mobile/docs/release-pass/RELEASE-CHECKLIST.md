# Sesly mobile: release checklist

Written at the end of the 2026-10 release-readiness pass (R1 to R14 in `REVAMP.md`).
Work through it top to bottom for every store or test release. Items marked
**owner** need a person with the accounts, the keystore or a Mac; nothing in the
app does them.

## 1. Before the build

- [ ] `npx tsc --noEmit` is clean and `npm test` is green (the i18n parity and glyph
      tests cover the copy, `src/navigation/deprecations.test.ts` the removed shims).
- [ ] `npm ls expo-asset` shows one version (it is a direct dependency now; run
      `npm dedupe` if a second copy appears after an install).
- [ ] After any change to `babel.config.js` or `babel/strip-console.js`, clear the Metro
      cache once (`npm start -- --clear`). Release bundles drop `console.log`, `info`,
      `debug` and `trace` (keyed on the Babel caller's `isDev === false`); `warn` and
      `error` stay.
- [ ] Glyph sweep of the UI copy (workspace rule): no emoji, no em-dash, no unicode
      ellipsis, no arrows or bullet glyphs in `src/i18n/tr`, `src/i18n/en` or any
      `.tsx` text. The i18n test enforces it for the JSON; grep the rest.

## 2. Native rebuild (this pass changed native code)

One rebuild covers all of it. A JS-only reload (Metro, OTA) is not enough.

- [ ] **Android**: rebuild for both local module changes:
      `modules/sesly-media` (the sleep timer deadline, `SeslySleepTimer.kt`, next to
      the Media3 session) and the new `modules/sesly-system-bars` (transparent
      navigation bar in every `Modal` window). Also new or changed native packages:
      `expo-splash-screen`, `react-native-keyboard-controller`, `expo-keep-awake`,
      `expo-asset` 55.0.x, the night-mode pin in `MainApplication.kt`, the splash
      styles and drawables (since LA-1: `windowSplashScreenAnimatedIcon` names the padded
      `splashscreen_logo` bitmaps, `drawable/splashscreen_icon.xml` is gone).
- [ ] **Android, 2026-10-22**: two new native packages, `expo-iap` 6.1.1 (Google Play
      Billing 9 through openiap-google; `android/gradle.properties` pins
      `openiapStore=play` so Gradle never probes devices with adb) and
      `@react-native-firebase/crashlytics` 21.14.0 (classpath
      `com.google.firebase:firebase-crashlytics-gradle:3.0.3` in `android/build.gradle`,
      `apply plugin: "com.google.firebase.crashlytics"` and the per build type
      `firebaseCrashlytics { mappingFileUploadEnabled }` in `android/app/build.gradle`,
      `firebase.json` at the project root). The BILLING permission comes from the
      Billing library through the manifest merger; no manifest edit.
- [x] **iOS native project (2026-11-04)**: Firebase (`GoogleService-Info.plist`,
      `FirebaseApp.configure` in AppDelegate, `$RNFirebaseAsStaticFramework`), the Google
      Sign-In URL scheme, the app privacy manifest, the RNFB Core and Crashlytics build
      phases (the Crashlytics phase uploads the dSYM), Sign in with Apple in both
      entitlements, version 1.2.1 (8), `ITSAppUsesNonExemptEncryption` false, portrait
      only, RGB app icons (App Store refuses an icon with an alpha channel), the Flutter
      leftovers removed.
- [ ] **iOS (owner, on a Mac)**: `cd ios && pod install` after every native dependency
      change, open `Sesly.xcworkspace`, set the team under Signing & Capabilities and add
      the **In-App Purchase** capability there (Sign in with Apple and Push come from the
      entitlements). Release: Debug Information Format "DWARF with dSYM File".
- [ ] **Sign in with Apple token revocation**: Firebase console > Authentication >
      Sign-in method > Apple: fill the OAuth code flow configuration (Apple team id, key
      id, the Sign in with Apple private key). Without it `revokeToken` fails when an Apple
      account is deleted (the app reports it to Crashlytics and deletes the account anyway).
- [ ] Never run `expo prebuild --clean`: `android/` and `ios/` are hand-edited
      (`MainApplication.kt` channel and night mode, `MainActivity.kt`, styles,
      Info.plist, the splash storyboard).

## 3. Android release build

- [ ] `cd android && ./gradlew clean` before **every** release build. Stale
      `generated/res/react/release/raw` files from older bundles are what put 18 icon
      fonts, Noto and Fredoka into the October 16 APK.
- [ ] R8 and resource shrinking are on (`android.enableMinifyInReleaseBuilds=true`,
      `android.enableShrinkResourcesInReleaseBuilds=true` in `android/gradle.properties`).
      Add `-keep` rules to `app/proguard-rules.pro` only for classes that actually
      break in the release smoke (section 4).
- [ ] Keep `android/app/build/outputs/mapping/release/mapping.txt` of every release
      and upload it to Play Console with that version (crash stacks are unreadable
      without it). The Crashlytics plugin uploads the same file to Firebase by itself
      after every minified release build (task `uploadCrashlyticsMappingFileRelease`;
      it needs the network and Crashlytics enabled in the console, section 5).
- [ ] Store releases go as an **AAB** (`./gradlew bundleRelease`); Play splits it per
      ABI and density.
- [ ] Sideloaded test APKs: build arm only,
      `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a`
      (`gradle.properties` lists x86 and x86_64 too, for the emulator). The `apk-release`
      EAS profile builds the universal APK. Target: under 30 MB.

## 4. Release smoke (minified build, Maestro plus by hand)

The Maestro flows live in `e2e/maestro`; run them against the release build, then check
by hand what they cannot see.

- [ ] Cold start is dark from the first frame (the mark on the launch colour, no cream
      flash, no second splash), signed in and signed out; a returning user lands on
      Masallar, also offline.
- [ ] **Native splash mark (LA-1)**, on the release build, on an API 33 to 35 device and
      on API 37 (and once on Android 10 for the androidx compat splash): force-stop the
      app, then cold start it from the launcher icon and again with
      `adb shell am start -n com.sesly/.MainActivity` (also with
      `--splashscreen-show-icon` on API 33 and up). Every start shows the bird mark at
      120dp in the middle of `#121A29` until the first screen; a plain navy window
      without the mark is a failure. Record with `adb shell screenrecord` and step the
      first frames. The mark is the padded `drawable-<d>/splashscreen_logo.png` named
      directly by `windowSplashScreenAnimatedIcon` (SPEC-startup 1.2); if it is still
      missing, compare with another app's splash icon on the same device before changing
      the drawable again.

### 4.1 Recheck on a release build (findings seen on the debug build only)

These were reported from the debug build (Metro, no minify, dev checks on), where JS
runs much slower. Recheck each on the release build before it counts as a bug; if it
still shows, reopen it with a screen recording.

- [ ] **LA-5** Onboarding picture: the first onboarding illustration is there when the
      splash hides, no late pop-in.
- [ ] **LA-6** Legal sheet open: the legal sheet (terms, privacy) opens without a
      noticeable wait after the tap.
- [ ] **LA-7** Login brand mark: the brand mark on Login is drawn with the rest of the
      screen, not after it.
- [ ] **V3-01** Sheet open size: a sheet opens at its final height and does not change
      size while it is open.
- [ ] **V3-02** Narrator sheet open time: the narrator sheet opens without a noticeable
      wait after the tap.
- [ ] **V3-03** Story detail push: opening a story pushes the detail screen without a
      stall before the animation.
- [ ] **NL-07** Queue sheet close: the queue sheet closes at once, with no stall before
      or during the close animation.
- [ ] **V5-04** Add-narrator latency: adding a ready-made narrator answers the tap
      without a noticeable wait.
- [ ] **LR-3** Timer mode switch: in the Zamanlayıcı sheet, "Süre dolunca" shows the
      wheel at once (no stories body under the pill), also while a story plays and on
      the first switch after the sheet opened; "Masal bitince" switches back as quickly.
- [ ] **LR-4** Mini player to player, timer tile to sheet: the mini player card and the
      player's Zamanlayıcı and Hız tiles show their pressed state at the touch, and the
      player or the sheet opens without a noticeable wait.
- [ ] **NEW-1 / LR-2** Sheet close on Android: no full-bright frame between the scrim and
      the canvas. Record a burst of a scrim-tap close and of a back-key close and step
      it: no frame is brighter than the one after it.
- [ ] **NL-08 / V3-07** Options sheet to dialog: "Sil" in Kütüphane and "Baştan hazırla"
      on the story page leave no bright gap between the sheet and the dialog, and the
      dialog follows quickly.
- [ ] **NL-03** Generation dock label: the dock button reads "Arka planda devam et" in
      full, on one line.
- [ ] **V5R-01** First tab switch after a cold launch: the first switch to a tab not
      visited yet shows that tab selected, not dimmed.
- [ ] **HOME-SHIFT** Home first load: nothing below the first shelf moves when the
      content arrives.
- [ ] **NEW-2** Narrator sheet: the first open on a story page comes up at its final
      height (no row added or removed under the finger), and an added narrator's
      subtitle does not change while the sheet is open.
- [ ] **LR-1** Long listening: with a story loaded for more than 50 minutes, a 15 s
      rewind, a tap on the bar, the lock-screen skip back and "Baştan dinle" keep
      playing, with no error line.
- [ ] Google sign-in; email sign-in and sign-up; sign-out goes straight to Login.
- [ ] FCM: a foreground message shows the snackbar; a tap from a killed app opens the
      right screen.
- [ ] Playback: the mini player only while a story plays; the queue plays on with the
      screen off; the sleep timer stops on time with the screen off; the lock screen and
      the Media3 notification (paid plan, Mini included) and the pause in the background
      on the free plan.
- [ ] Voice recording and upload; a dialog from the voice flow (it renders in the
      screen's own outlet) and an unrelated dialog afterwards (sign out). On an iPhone
      check the slot-limit dialog from the narrator sheet as well.
- [ ] Encrypted storage survives a restart; offline start with and without a cached user.
- [ ] Force update with a raised backend minimum on a test build.
- [ ] **In-app purchases (Android, on a build from the internal testing track, with a
      license tester account; needs section 5 "Play Console" first)**. A sideloaded APK
      or an emulator without Play shows "Satın alma şu an kullanılamıyor", and a Play
      install before the products exist shows "Planlar şu an yüklenemedi": both are the
      expected inline states, never a crash.
  - [ ] The plans screen shows the Play prices (not the reference prices) for Mini,
        Premium monthly and Premium yearly.
  - [ ] Buy Mini with a test card that approves: success state "Mini planın açıldı",
        Profile shows Mini, the backend row is GOOGLE / ACTIVE and Play Console shows the
        order acknowledged.
  - [ ] Cancel in the Play sheet: back to the plans, no message.
  - [ ] "Slow test card, approves after a few minutes": the notice "Ödemen onay
        bekliyor"; after approval the plan opens by itself (foreground the app).
  - [ ] Backend down or `GOOGLE_PLAY_SERVICE_ACCOUNT_PATH` unset (503): the notice
        "Satın alımın alındı", the purchase stays unacknowledged; with the backend back,
        a return to the foreground (or the next start) completes it with "Satın alımın
        doğrulandı, planın açıldı."
  - [ ] Upgrade Mini to Premium yearly (charged now, prorated) and downgrade Premium to
        Mini (the notice "Yeni planın, şu anki dönemin bitince başlar", the success state
        "Plan değişikliğin kaydedildi"); Play shows one subscription, not two.
  - [ ] "Satın alımları geri yükle" on a second phone with the same Google account and
        the same Sesly account restores; with another Sesly account it says the
        subscription belongs to another account (RECEIPT_IN_USE).
  - [ ] "Aboneliği yönet" opens the Play subscription page of the product.
- [ ] **Crashlytics** (release build only; debug builds never send): seven quick taps on
      the version line of the profile screen of a **debug** build crash it on purpose
      and the next start of that debug build sends this one report; in the console
      the user id is the Sesly user id, never an email. On a release build, a failed
      narration start shows up as a non-fatal `narration_error` and a rejected purchase
      as `purchase_error`.

## 5. Owner items (outside the app code)

- [ ] **Firebase Crashlytics**: Firebase console > the Sesly project > Release & Monitor >
      Crashlytics > "Enable Crashlytics" for the Android app `com.sesly` (and the iOS app
      once it exists). Until then reports and the mapping upload of a release build are
      refused (the build itself still passes). Then install a release build, crash it
      or wait for a non-fatal, start it again and check that the first report arrives
      (it can take a few minutes). Optionally set up an alert (Crashlytics > Alerts) for
      new fatal issues and for the crash-free rate.
- [ ] **Play Console** (everything in `sesly-backend/CLAUDE.md`, "Owner checklist: store
      setup", Google Play part): the three subscriptions `mini_monthly`, `pro_monthly`,
      `pro_yearly` with active base plans (the app buys the base plan offer: the offer
      with a single pricing phase, so a free trial offer can be added later without an
      app change), license testers, a build on the internal testing track (purchases
      only work in an app installed from Play with the same package and signing key),
      the service account and Real-time developer notifications for the backend.
- [ ] **App Store Connect** (same backend checklist, Apple part): the subscription group
      with `io.sesly.mini_monthly`, `io.sesly.pro_monthly`, `io.sesly.pro_yearly`, Premium
      ranked above Mini, sandbox testers; the In-App Purchase capability in Xcode
      (section 2).

- [ ] **Upload keystore passwords**: the `MYAPP_UPLOAD_*` values moved to
      `%USERPROFILE%\.gradle\gradle.properties` (commit 5d7894d); the tracked
      `android/gradle.properties` only names the keys. Older commits still hold the
      passwords: remove them from the repository history if it was ever shared, and with
      Play App Signing reset the upload key in Play Console if in doubt.
- [ ] **iOS force update link**: set `storeUrl.ios` in the backend `/app/config` once the
      App Store listing exists (until then iOS force update has no store link).
- [ ] **Emulator**: delete the `SeslyTest` AVD used for the visual audit once nobody needs
      it.
- [ ] **Workspace `CLAUDE.md`** (`E:\Coding\sesly-base\CLAUDE.md`, outside the mobile
      repo): the sentence "multi-track queueing lives in `PlaylistStore` and the UI
      advances via navigation on the `audioPlayer.didJustFinish` signal" becomes "the
      queue lives in `QueueStore` (device-local, per account) and the audio store
      advances it at the end of a story".
- [ ] `eas.json` `submit.production-tf` still holds the `REPLACE_WITH_*` App Store
      Connect ids.

## 6. Backend items seen during the pass (not in the app)

- Legal documents per UI language: the backend serves `GET /legal/:slug?language=tr|en` and the
  app asks for the UI language (`LegalService`, `LegalSheet`). The English texts are seeded as
  drafts and still need publishing in the admin panel; until then the English UI shows the
  Turkish text with the line "This document is currently available in Turkish only."
- Some legal documents repeat their dates inside the text.
- Contact address mismatch: `destek@sesly.app` in some copy, `info@sesly.io` in other.
- **V5-01** Library search must fold Turkish letters and case on the backend: "yildiz",
  "YILDIZ" and "kucuk" must all find "Küçük Yıldız". `narrations.service` uses Prisma
  `contains` with `mode: 'insensitive'`, which is ILIKE under `en_US.utf8`: it neither
  maps ı and İ to i nor drops the marks of ç, ğ, ö, ş and ü. Fold both sides the same
  way (a normalized search column, or `unaccent` with the ı and İ mapping).
- Optional docs only: `voice-profiles.controller.ts` Swagger text still names
  `CLONE_MONTHLY_LIMIT`; `PREMIUM_STORY_REQUIRED_MESSAGE` says "Pro" (the app no longer
  shows it).
