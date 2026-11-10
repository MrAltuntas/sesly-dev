# Local end-to-end test stack

Runs the real app on an Android emulator against a fully local backend, without
touching production Firebase Auth or the production database.

| Piece | Where | Notes |
|---|---|---|
| Postgres + Redis | `sesly-backend/docker-compose.yml` | `docker compose up -d` (Postgres :5439, Redis :6379) |
| Firebase Auth | local emulator, this folder | test accounts only live in the emulator |
| Backend | `node dist/main` with overrides below | GCS, Google TTS, Cartesia and FCM are REAL services |
| App | debug or release build on the `SeslyTest` AVD | Metro with the env below for a debug build |

## 0. Which emulator

Maestro drives whatever device it finds first, so always name the device.

- **`SeslyTest`** (Pixel 7 profile, 1080 x 2400, Android 17 / API 37, Play Store
  image): the e2e emulator. Start it on its own port so its id is fixed:
  `& "$env:ANDROID_HOME\emulator\emulator.exe" -avd SeslyTest -port 5556`, then
  every Maestro run takes `--device emulator-5556`.
- **`Pixel_10`** (`emulator-5554`): the visual audit and manual checks. Never
  point Maestro at it while an audit runs (a flow clears state, signs out and
  deletes accounts).

Set the emulator's language to Türkçe (Settings, System, Languages): selectors
are testIDs wherever the UI has one, the few texts (dialog buttons, toasts,
the play / pause label) are written in Turkish or English, but the app's
first language is what the flows were walked in.

## 1. Backend (from `sesly-backend/`)

The local `.env` must point `DATABASE_URL` at `localhost:5439` (check before
running any prisma command: prisma reads `.env`).

```powershell
docker compose up -d
npx prisma migrate deploy
npm run prisma:seed
npm run prisma:seed:stories
npm run build
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'   # firebase-admin accepts emulator tokens
$env:RESEND_API_KEY=''                                # never email fake test addresses
$env:API_URL='http://localhost:3000'
node dist/main
```

## 2. Firebase Auth emulator (from `sesly-mobile/e2e/`)

```powershell
npx firebase-tools@latest emulators:start --only auth --project sesly-9f033
```

The project id must match `android/app/google-services.json` so emulator ID
tokens carry the audience the backend expects.

## 3. App (from `sesly-mobile/`)

```powershell
& "$env:ANDROID_HOME\emulator\emulator.exe" -avd SeslyTest -port 5556
$env:BASE_URL='http://10.0.2.2:3000'
$env:WEBSOCKET_URL='ws://10.0.2.2:3000'
$env:FIREBASE_AUTH_EMULATOR_HOST='10.0.2.2:9099'     # dev-only hook: src/config/firebaseEmulator.ts
$env:ANDROID_SERIAL='emulator-5556'                   # adb commands go to the e2e emulator
npx expo run:android --no-bundler --device SeslyTest  # build + install once
$env:E2E='1'; npx expo start --dev-client --clear      # Metro with the env above
```

`10.0.2.2` is the host machine as seen from the Android emulator. Env vars set
in the shell win over `sesly-mobile/.env` (which points at production).

Release-only flows (`cold_start.yaml`, and the 3 s budget of
`offline_start.yaml`) need a release or preview build on the emulator
(`npx expo run:android --variant release --device SeslyTest` with the env above).

## 4. Maestro flows (`e2e/maestro/`)

Install once: Maestro CLI 2.x (`~/.maestro/maestro/bin/maestro`, needs Java 17+).
Run from `sesly-mobile/` (screenshots land in `e2e/artifacts/`, which git
ignores). On Windows set `$env:JAVA_TOOL_OPTIONS = '-Dfile.encoding=UTF-8'`
first, or Turkish texts will not match.

Debug build: add to every command below
`-e DEV_CLIENT_URL="exp+sesly://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081&disableOnboarding=1"`
and run `adb -s emulator-5556 reverse tcp:8081 tcp:8081` once per emulator
start. Start Metro WITHOUT `CI=1` (CI mode disables file watching) and with
`E2E=1` (hides the LogBox overlay that covers buttons). One time per
emulator: open the dev menu and tap "Tools button" to hide the floating Tools
button over top-right taps. Dev runs skip clearState; release runs use it.

| Flow | What it checks | Account |
|---|---|---|
| `smoke.yaml` | Login and Registration, Profile, a ready-made narration (real TTS) that plays, the sleep timer, the mini player, the queue from the Library, all six palettes, Library search, the clone flow up to the rejected silent take, sign out and in, account deletion | registers its own and deletes it |
| `offline_start.yaml` | airplane mode, cold start: the Stories tab and `offline-banner` within 3 s, never Login; the banner goes when the network is back | `EMAIL` / `PASSWORD` |
| `cold_start.yaml` | screenshots at once, after 300 ms and on the first screen; then `check-launch-colours.js` | signed in, or `-e SIGNED_OUT=true` |
| `quota_free.yaml` | a FREE user with the ready-made allowance used up: "Bu ay 0 masal hakkın kaldı" under the button when the usage is known, the quota dialog with "Planları gör" (or the generation screen's limit state), never "Tekrar dene" | prepared, see below |
| `sleep_timer.yaml` | a one-minute duration: the countdown runs, the story stops on time, the switch is off again | `EMAIL` / `PASSWORD`, one ready narration |
| `mini_player.yaml` | the mini player shows while a story plays and is gone 5 s after a pause; "Kaldığın yerden devam et" resumes | same |
| `queue_library.yaml` | hold a Library row, "Sıraya ekle", "Sırayı aç" on the snackbar, "Sırayı çal" opens the player playing | same |
| `palette_switch.yaml` | every palette, a screenshot each (`palette_*.png`) | `EMAIL` / `PASSWORD` |
| `sheets_system_bars.yaml` | the speed, timer and narrator sheets (the last one again after a trip to the background) and the nested legal sheet in Profile, photographed (`sheet_*.png`); then `check-sheet-bars.js` | same, default palette |

```powershell
maestro --device emulator-5556 test e2e/maestro/smoke.yaml
maestro --device emulator-5556 test e2e/maestro/sleep_timer.yaml -e EMAIL=you@test.local -e PASSWORD=Test-123456
maestro --device emulator-5556 test e2e/maestro/cold_start.yaml; node e2e/scripts/check-launch-colours.js e2e/artifacts
maestro --device emulator-5556 test e2e/maestro/sheets_system_bars.yaml -e EMAIL=... -e PASSWORD=...; node e2e/scripts/check-sheet-bars.js e2e/artifacts --palette gece-mavisi
```

`steps/` holds the shared parts (launch, sign in, open the player, and the
owner-area steps the top-level flows run); a step is never run on its own.

### Navigation modes

Run `sheets_system_bars.yaml` in gesture navigation and again in 3-button
navigation (`adb -s emulator-5556 shell cmd overlay enable com.android.internal.systemui.navbar.threebutton`;
back with `...navbar.gestural`). The bottom rows must show the sheet's
surface in both.

### Preparing the `quota_free` account

1. Register an e-mail account in the app (FREE plan) and prepare one story
   that is NOT the Masallar featured story with a ready-made narrator, so the
   month's usage row exists.
2. Raise its preset counter past the allowance in the local database:

```powershell
docker exec -it sesly-postgres psql -U postgres_sesly -d sesly -c "UPDATE usage_limits SET \"storiesGenerated\" = \"premiumStoriesGenerated\" + 1000 WHERE \"userId\" = (SELECT id FROM users WHERE email = 'quota@test.local');"
```

3. `maestro --device emulator-5556 test e2e/maestro/quota_free.yaml -e EMAIL=quota@test.local -e PASSWORD=...`

### Checking the flows without a device

`node e2e/scripts/check-flows.js` parses every flow and fails on an unknown
command or selector key, a missing step file, a step no flow uses, an `id:`
that no testID in `src` produces, or a `text:` that no tr or en string in
`src/i18n` matches. Absence checks (`assertNotVisible`, `notVisible`) follow
the same rule, since a stale one would pass forever; a selector for what is
gone on purpose goes into `GONE` in the script, with the reason. It runs in
`npm test` (`e2e/scripts/scripts.test.js`), so a renamed testID or a changed
label breaks the unit tests, not the next device run. Add `--maestro` to also run `maestro check-syntax` on every flow (needs
Maestro installed; it does not touch a device).

## Limits

- Google Sign-In cannot use the Auth emulator; use email + password accounts.
- The emulator microphone records host audio or silence, so a real voice take
  has to be recorded on a phone. The clone pipeline itself can be exercised by
  uploading a WAV to `POST /voice-profiles/:id/upload-samples` with the test
  user's token.
- Uploaded test files go to the configured GCS bucket; clean them from the
  admin panel Storage page (orphans) when done.
- Lock screen, the Media3 notification, background playback and FCM taps
  from a killed app stay manual checks (SPEC-startup 8.6), as do the device
  checks of SPEC-design 8 that Maestro cannot set up: the Redmi 8 (MIUI), the
  password reset sheet with the keyboard open at font scale 1.3, a dialog over
  a sheet on Android (the slot-limit dialog from the narrator sheet needs an
  account whose voice places are full), on an iPhone the same slot-limit
  dialog, a recording error dialog and then a sign-out (a later dialog still
  shows), and the palette switch on a release build (the ring within one
  frame).
