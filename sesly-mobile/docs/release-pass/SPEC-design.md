# Sesly mobile: design system spec (release pass)

Status: decided, ready to implement. Written 2026-10-19 against branch `release-pass`
(HEAD `d3d4f18`, same commit as `main`). Every path is relative to
`E:\Coding\sesly-base\sesly-mobile-rp`. Line numbers were re-read in this worktree.

Owner items covered: R2 (palette switch), R3 (navigation bar under sheets), R4 (button
sizes, lips), R5 (contrast), R6 (spacing, wasted space, bookmark badge), R13 (labels that
bob), R14 (sheet, dialog and countdown motion), plus the design parts of R7, R10, R11, R12.
Owned by other specs and only referenced here: splash composition and launch path (R1,
R10), mini player visibility and the Library "continue listening" entry (R11), playlist
UX (R12), player data flow and the sleep timer service (R8).

Sources: `code-audit.json` dimensions design-system, contrast, controls-motion,
sheets-navbar, palette-switch and the related ui-* findings; `visual-auth.md`; REVAMP.md
section "2026-10-19 RELEASE-READINESS PASS". Where an auditor and its skeptic disagreed, the
decision below says which one won and why.

How to use this file: section 1 is the token layer (change these first, in
`src/theme`), section 2 the architecture (system bars, sheets, keyboard, palette switch),
section 3 the component-by-component changes, section 4 the call-site size table, section 5
the tests, section 6 the native batch, section 7 the order of work.

---

## 0. Decisions at a glance

1. One spacing scale `2 4 6 8 12 16 20 24 32`; one page gutter of **16dp** (was 20).
2. One radius set `6 12 16 20 24 28 32 pill`.
3. Three lips: **2** (controls up to 48dp tall), **3** (controls 49 to 71dp, every card, row
   and field), **4** (objects 72dp and taller, covers 130dp and wider, dialogs). No 5.
4. Buttons: sm **36** / md **44** / lg **52** on lips 2 / 2 / 3. lg only for the one bottom
   call to action of a screen or form; everything in sheets and dialogs is md.
5. Only a face with a visible lip sinks, and it sinks by exactly its lip. Everything
   without a lip answers a press with an opacity tint. Labels never move inside their face.
6. Neutral ladder `bar < bg < surface < surface2 < line`, each step at least 6 CIELAB L*.
   Final hex values for the six palettes in 1.6. A `SurfaceLevel` context tells every
   neutral control which level it sits on; a raised face is one step up, an inset face one
   step down. Nothing is ever drawn in its container's colour.
7. Contrast contract test `src/theme/contrastRules.test.ts` (full text in 5.1). Today it
   fails 32 of 66 cases; with the final values it passes 66 of 66 (run in a scratch jest).
8. Motion tokens in `src/theme/motion.ts`; no duration or curve literal anywhere else.
9. Android navigation bar: transparent everywhere, contrast scrim off, set natively once per
   window (activity in `MainActivity.kt`, every Modal window by a small native view).
   Night mode pinned natively in `MainApplication.kt`. No per-screen JS navigation-bar calls.
10. Sheets and dialogs: `ModalWindow` (animationType none) plus a Reanimated presence:
    scrim fades, the sheet slides, real exit animation before unmount, drag down on the
    handle and header. Dialogs fade and scale.
11. Keyboard: adopt **react-native-keyboard-controller 1.20.7** (the version Expo SDK 55
    pins). Drop React Native's `KeyboardAvoidingView` everywhere.
12. Segmented control: one sliding action pill on a spring, labels cross-fade, nothing moves
    vertically. Switch knob slides. Steppers and countdowns use tabular digits.
13. Timer sheet body has one fixed height in every mode and state.
14. Palette switch: discrete pick, an optimistic ring in the picker, two contexts, a
    per-screen boundary that catches up 150 ms later in a transition, frozen hidden tabs,
    cached style sheets, zero navigation-bar calls on Android 10 and up.

---

## 1. Tokens

All shared tokens live in `src/theme/theme.ts` (`sharedTokens`, lines 55-110 today) and are
read through `useT()`. Module-scope code that has no `T` imports the constants below.

### 1.1 Spacing

```ts
// src/theme/theme.ts
export const SPACE = { xxs: 2, xs: 4, tight: 6, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const SCREEN_PAD_H = 16;
/** Bottom padding of a dock, a sheet or a form end (the sheet rule, now everywhere). */
export function dockBottom(insetBottom: number): number {
  return Math.max(insetBottom, 12) + 8;
}
// sharedTokens: space: SPACE, screenPadH: SCREEN_PAD_H (was 20), touch: 48,
// tabBarReservedHeight: 24, hairline: 1, ring: 2
```

`xxl` changes 28 to 24 and `xxxl` 40 to 32. Only `SplashScreen.tsx:179,185,196` uses them
(verified); the splash spec owns that screen and takes the new values.

| Token | dp | Use it for |
|---|---|---|
| xxs | 2 | optical nudge: title to subtitle inside a row, label to its count |
| xs | 4 | icon to text inside badges and tags; circle badges on a cover; tight stacks (title to meta under a cover is 2, see 1.5) |
| tight | 6 | gaps inside chips; label to helper under a field; pill badges on a cover |
| sm | 8 | between sibling controls in a row (chips, tags, buttons side by side); dock top padding; label to field |
| md | 12 | row-card padding; a title to its own content (shelf header to covers); list item gap |
| lg | 16 | page gutter; content-card padding; field block to field block; card to card |
| xl | 20 | block to block inside a screen (shelf to shelf, detail sections); dialog padding |
| xxl | 24 | before a new major section; scroll end padding above the bottom inset |
| xxxl | 32 | padding of centred empty, error and loading blocks (line-length, deliberate) |

Rules:
- **Page gutter 16** (`T.screenPadH`, `SCREEN_PAD_H`). Used by every screen, sheet content,
  dialog root, floating chrome (mini player, snackbar). At 360dp the story grid becomes 3
  columns of 101dp (was 98).
- **Bottom of a dock, sheet or form**: `dockBottom(insets.bottom)` (0 inset gives 20, a 24dp
  gesture inset 32, a 48dp 3-button bar 56). Docks get `paddingTop: 8`.
- **Scrolling pages** end at `insets.bottom + 24`.
- **Tab screens** end at `T.tabBarReservedHeight + bottomChromeInset` where
  `useBottomChromeInset()` (new, `src/screens/main/bottomChrome.ts`) returns the dock height
  while the mini player overlays the scene (see 3.20). Drop the `+ 8` at
  `HomeScreen.tsx:375` and `StoryLibraryScreen.tsx:455`.
- A padding that equals a fade height changes with it (`VoiceRecordingScreen.tsx:742/743`
  to 24/24, `VoiceConsentScreen.tsx:226/227` to 32/32).
- Selection rings never change padding: a selectable face always carries its 2dp ring,
  transparent while idle (the `Card` rule at `cards.tsx:70-71`, now everywhere: `SheetRow`,
  `PalettePicker`, `NarratorCards`, `OptionTile`). Delete every "padding minus ring" offset
  (`SheetRow.tsx:151`, `PalettePicker.tsx:108-110`).
- Form rhythm: label to field 8; field to helper 6; field block to next field block 16; last
  field or consent row to the submit 20; stacked buttons 12; the "veya" row `minHeight 40`
  with `marginVertical 4`; form to footer link row 20.

Off-scale mapping (213 of 656 spacing literals are off-scale today; scan in 5.4):

| Today | Becomes | Note |
|---|---|---|
| 1, 1.5, 2.5 | 2, or keep with `// geometry` | hairline offsets only |
| 3, 5 | 4 | |
| 7 | 6 (badge insets, chip gaps) or 8 | |
| 9, 10, 11 | 8 between siblings, 12 for paddings | `10` is the biggest group (73) |
| 13, 14, 15 | 12 inside a component, 16 between blocks or fields | |
| 18 | 16, or 20 between blocks | |
| 22, 26, 28 | 24 (20 for card-to-card) | |
| 36, 40, 48 | 32, or a named constant (`T.touch`, a component height) | |

Inside a component round down; between blocks round to the larger rhythm step. Skeleton
geometry moves with the real component in the same change.

### 1.2 Radius

```ts
export const RADIUS = { xs: 6, sm: 12, md: 16, lg: 20, xl: 24, xxl: 28, sheet: 32, pill: 999 } as const;
// sharedTokens.r = RADIUS (xs was 9; only LegalMarkdown code_inline uses it)
```

| Token | Roles |
|---|---|
| xs 6 | skeleton text bones, inline code, checkbox |
| sm 12 | chips, segment pill, sm button, 36dp clear tile, 40dp icon tiles, translation toggle, palette preview |
| md 16 | md button, 44dp icon buttons, segmented well, 48dp picture tiles, palette swatch, card actions |
| lg 20 | lg button, text and search fields, row cards, mini player card, covers 96 to 129dp, sample button |
| xl 24 | `Card` default, covers 130 to 199dp |
| xxl 28 | dialog card, the wide hero cover, the own-voice hero card |
| sheet 32 | bottom sheet top corners, covers 200dp and wider (player art) |
| pill | circles and pills: write `size / 2` (round buttons, tags, switch track, progress) |

Concentric rule: a face inset by `i` inside a parent of radius `R` uses `max(0, R - i)`,
clamped to half its height. Example: segmented well 16 with 4dp padding gives a 12dp pill.
`coverRadius` (`PictureCover.tsx:37-44`) already returns 20 / 24 / 32 / 28 and stays; the
square branch (`Math.round(width * 0.3)`) is only used by the 44dp mini-player thumb, which
passes `radius={12}`.

### 1.3 Lips and press feedback

```ts
export const LIP = { sm: 2, md: 3, lg: 4 } as const;   // lipSize.xl (5) is deleted
/** Lip of a control by its face height. Cards, rows and fields use LIP.md whatever their height. */
export function lipFor(faceHeight: number): number {
  return faceHeight <= 48 ? LIP.sm : faceHeight < 72 ? LIP.md : LIP.lg;
}
// PictureCover.tsx: coverLip(width) = width >= 130 ? LIP.lg : LIP.md   (was 3 / 4 / 5)
```

Where each lip goes:
- **2**: chips, segment pill, switch track, checked checkbox, sm and md buttons, every 44dp
  icon button (top-bar back, bell, search, player close and more), mini-player toggle, tab
  pill, stepper keys, wheel nudges, `CircleButton` up to 48.
- **3**: lg buttons, text and search fields, cards, row cards, settings groups, category
  tiles, snackbar, mini player card, sample button, hero play (56), player skip buttons
  (56), covers under 130dp, `CircleButton` over 48.
- **4**: player play (80), record button (80), flow avatar (72), `StateIcon` (76), covers
  130dp and wider (hero, player art), the dialog card, the own-voice hero card.

Press rules (owner: no needless motion, labels never bob):
1. A face with a visible lip sinks by **exactly its lip**, label and all (they move as one).
   `usePressSink(lip)` callers pass the same constant they draw the lip with.
2. A press target without a lip (text buttons, plain icon buttons, plain list rows, setting
   rows, switch rows, segments, unfocused tabs, the cover bookmark, checkbox, links) never
   translates. It gets `usePressTint()`: opacity 1 to **0.6** in `DURATION.pressIn`, back in
   `DURATION.pressOut`, native driver. Delete every `translateY: pressed ? n : 0`
   (`rows.tsx:113`, `feedback.tsx:413`, `FilterSheets.tsx:87`, `StoryLibraryScreen.tsx:298,405`)
   and every ad hoc pressed opacity (`PlaylistSheet.tsx:179,242`, `controls.tsx:396`,
   `OnboardingScreen.tsx:169`).
3. Pressables inside scrolling content wait **100 ms** (`PRESS_DELAY_MS`, Android's
   TAP_TIMEOUT) before the sink or tint starts, so a swipe never flickers a card. A tap
   shorter than that still shows the full sink (Pressability holds press-out for 130 ms).
   `Tactile` defaults to it; `pressDelay={0}` for the player transport, wheel nudges (hold to
   repeat), stepper keys, tab items, the mini player and dock CTAs.
4. The sink only runs on an enabled control. A disabled control never sinks or tints.

### 1.4 Control sizes

```ts
// src/components/design/buttonMetrics.ts (pure, re-exported by Button.tsx)
export const BUTTON_METRICS = {
  sm: { height: 36, lip: 2, radius: 12, padH: 12, font: 14, lineHeight: 19, icon: 16, gap: 6 },
  md: { height: 44, lip: 2, radius: 16, padH: 16, font: 15, lineHeight: 21, icon: 20, gap: 8 },
  lg: { height: 52, lip: 3, radius: 20, padH: 20, font: 16, lineHeight: 22, icon: 20, gap: 8 },
} as const;
```

| Control | Face | Lip | Radius | Padding | Text | Icon | Target |
|---|---|---|---|---|---|---|---|
| Button sm | 36 | 2 | 12 | H 12, V 8 | Nunito 800 14/19 | 16 | hitSlop 5 top/bottom |
| Button md | 44 | 2 | 16 | H 16, V 8 | 15/21 | 20 | hitSlop 1 |
| Button lg | 52 | 3 | 20 | H 20, V 8 | 16/22 | 20 | 55 |
| Button text | minHeight 48 | none | none | H 12 | size font | size icon | 48, tint |
| IconButton tactile / glass | 44 square | 2 | 16 | | | 24 (20 inline) | hitSlop 1 vertical, 2 horizontal |
| IconButton plain | glyph in 48 | none | | | | 24 | 48, tint, optional `hitSlop` prop |
| Cover bookmark (`variant="badge"`) | 28 circle | none | 14 | | | 16 | hitSlop 10, tint |
| Chip | minHeight 34 | 2 | 12 | H 12 (square: minWidth 36, H 6), gap 6 | 13/18 | 16 | hitSlop 6 |
| Tag md / sm | minHeight 28 / 24 | none | 14 / 12 | H 12 / 8, gap 4 | 12.5/17, 11.5/16 | 16 / 14 | static |
| Segmented well | 4 + pill 32 + lip 2 + 4 = 42 | pill 2 | well 16, pill 12 | seg H 12 (compact 8), gap 4 | 13/18, max scale 1.3 | | hitSlop 7 |
| Switch | track 52 x 32, thumb 22 at 4 | 2 (track bottom) | 16 / 11 | | | | hitSlop 8 |
| Checkbox | 24 | 2dp border | 6 | | | check 16 | 48 |
| Stepper key | 40 circle | 2 | 20 | value box minWidth 44 | Baloo 2, tabular | 20 | hitSlop 4 |
| TextField, SearchField | minHeight 52 | 3 | 20 | L 16, R 8, gap 8 | Nunito 700 15 | 20 | |
| Plain row (`ListRow`, `SwitchRow`) | minHeight 56 | none | | H 16, V 8, gap 12 | 15/21, sub 12.5/17 | tile 40 | tint |
| Row card (`ListRow card`, `SheetRow`, library and Sesim rows) | minHeight leading + 24 (64 / 72) | 3 | 20 | 12, gap 12 | | tile 40 r12, picture 48 r16 | sink |
| Setting row | minHeight 56 | none | | H 12, gap 12, label min width 72 | 15/21 | tile 40 | tint |

Size rules:
- The label of every Button keeps `numberOfLines={2}` (half-width dialog buttons in English
  need it). `singleLine` (new prop: `numberOfLines 1`, `adjustsFontSizeToFit`,
  `minimumFontScale 0.85`) is used on the story detail dock CTA.
- A `block` button in a row needs `flex: 1` and `alignSelf: 'center'` from the caller
  (`Button.tsx:164` sets `alignSelf: 'stretch'`, which stretches vertically in a row: the
  22dp-lip bug of the story detail dock).
- `loading` keeps the face size: the label stays rendered at opacity 0 (it holds the width
  and stays the accessibility label) and a `Spinner` in the label colour sits absolutely
  centred over it. Icon buttons keep the spinner in the icon slot.

### 1.5 Cards, rows, badges and insets

- Content cards (`Card` default, settings groups, dialogs' inner blocks, credits, filters,
  plan cards): padding **16**. Dialog card: padding **20**.
- Row-like panels and row cards: padding **12**, gap 12.
- Settings group: `marginBottom 16`, `contentStyle { paddingHorizontal: 0, paddingVertical: 4 }`.
- **Cover overlays** keep at least 4dp to the cover edges and at least 3dp along the rounded
  corner:
  - circles (the 28dp bookmark): inset **4** top and right. On the 20dp-radius grid cover the
    circle keeps 3.2dp along the curve; the glyph edge moves from 13 to **10dp** from the
    corner (owner's R6 example).
  - 22dp pills (level, duration): inset **6** (was 7), radius 11, padH 6, `minHeight 22`
    instead of `height` (no clipping at large font), text `maxFontSizeMultiplier 1.3`.
  - the home hero (28dp radius, 320 x 184): overlays at **12** on every side.
  - under a cover: title `marginTop 8` (was 9), meta `marginTop 2` (was 3).
- Badges inside a card face (narrator check, palette check): inset **4**.
- The bookmark and anything else drawn on a cover sink **with** the cover (see 3.12).

### 1.6 Colour: the neutral ladder, SurfaceLevel and the contrast contract

#### 1.6.1 Ladder and levels

```
bar  <  bg  <  surface  <  surface2  <  line        each step >= 6 CIELAB L*
```

Pure helpers in a new `src/theme/surfaces.ts` (no React; components and tests share them):

```ts
export type SurfaceLevel = 'bg' | 'surface' | 'surface2';
const LADDER = ['bg', 'surface', 'surface2', 'line'] as const;
type LadderPalette = Pick<ColorPalette, 'bg' | 'surface' | 'surface2' | 'line'>;

/** Secondary button, tactile icon button, stepper key, row icon tile. */
export function raisedFace(P: LadderPalette, level: SurfaceLevel): string {
  return P[LADDER[LADDER.indexOf(level) + 1]];
}
/** Text field, search field, segmented well. */
export function insetFace(P: LadderPalette, level: SurfaceLevel): string {
  return level === 'bg' ? P.surface : P[LADDER[LADDER.indexOf(level) - 1]];
}
/** Disabled button of any variant: never the action colour, never above surface2. */
export function disabledFace(P: LadderPalette, level: SurfaceLevel): string {
  return level === 'surface2' ? P.surface : raisedFace(P, level);
}
/** 1dp opaque ring of a glass control (cover bookmark, player close and more). */
export function glassRing(P: Pick<ColorPalette, 'text' | 'surface'>): string {
  return mix(P.text, 0.3, P.surface);
}
/** Opaque ghost face (second action on a tinted card): bar at 55 % over that card. */
export function ghostFace(P: Pick<ColorPalette, 'bar'>, cardColor: string): string {
  return mix(P.bar, 0.55, cardColor);
}
/** Unplayed waveform bars (decorative, aria-hidden): 3:1 on surface. */
export const WAVE_IDLE_ALPHA = 0.4;
```

| Container (level) | raised face | inset face | disabled face | idle chip |
|---|---|---|---|---|
| canvas `bg` (screens) | surface | surface | surface | line |
| `surface` (Card, BottomSheet, Dialog, recording panel) | surface2 | bg | surface2 | line |
| `surface2` (SheetRow, raised or selected Card, mini player, Profile permission block) | line | surface | surface | line |

`SurfaceLevel` context (`src/components/design/SurfaceLevel.tsx`): `SurfaceLevelProvider`
and `useSurfaceLevel()` (default `'bg'`). Providers only in containers, never in `Tactile`
(no extra fibers per cover or chip in long lists):
- `'surface'`: BottomSheet sheet view, Dialog card, `Card` (tone surface), the
  VoiceRecording panel view, any hand-made surface panel.
- `'surface2'`: `Card` raised or selected, `SheetRow`, `MiniPlayerBar` face, the Profile
  permission block (`ProfileScreen.tsx` around :448; it is a plain View, so it needs an
  explicit provider).
- `Card` with a custom `color` takes a `surfaceLevel` prop, default `'surface2'` (tinted
  cards are lighter than surface); ghost buttons on it pass the card colour.

Consumers: `Button` (secondary, disabled), `IconButton` tactile, `TextField`,
`SearchField`, `SegmentedControl` well, `Stepper`, `ListRow` icon tile, `CircleButton`
variant surface. `buttonColors(T, variant, tone, level, { disabled, parentColor })` stays a
pure function (move it to `src/components/design/buttonColors.ts`, re-exported from
`Button.tsx`).

Rules for state colours:
- Primary: `action` on `actionLip`, label `onAction`. Danger primary: `error` on
  `mix(error, 0.62, lip)`, label `onAction`.
- Secondary: `raisedFace(level)` on `lip`, label `text` (danger: `error`).
- Ghost: `ghostFace(T, parentColor)` on `lip` (opaque: a translucent face over the lip layer
  read as a dark slab, contrast r5-15).
- Disabled (any variant): `disabledFace(level)` on `lip`, label `text3`, no opacity. Other
  dimmed Tactiles (SheetRow `dimmed`, Card and Chip disabled, CircleButton disabled, the
  timer options while off) keep opacity but set `needsOffscreenAlphaCompositing` on the
  dimmed view, so Android composites the group instead of showing the lip through the face.
- Focused field ring: **`text2`** (2dp). Error ring: `error`. Resting ring: transparent.
- Idle checkbox: 2dp ring in `text3` (at least 4.5:1 on every level), transparent face.
  Checked: `action` face, 2dp ring in `action` with `actionLip` bottom edge.
- Switch: off track `line` with `lineLip` edge and a `text3` thumb; on track `action` with
  `actionLip` and an **`onAction`** thumb (white knob on the action track was 1.44 to 2.57:1).
  `knob` stays for the player seek knob and the speed slider.
- Glass (cover bookmark, player close and more): face `surface`, 1dp ring `glassRing(T)`.
- Translation "requested" toggle: opaque `mix(success, a, surface2)` with `a` = 0.12
  (orijinal 0.18, the alpha of its `chipOkBg`).

#### 1.6.2 The contrast contract (all six palettes)

| Kind | Rule |
|---|---|
| Text | `text`, `text2`, `text3` at least 4.5:1 on `bg`, `bar`, `surface`, `surface2`; `text` and `text2` on `line`; every label on every face a control can take (raised, inset, disabled); placeholders (`text3`) on every inset face |
| Tinted labels | failed tag (`error` on 16 % error over `ownC`), machine badge (`warning` on 14 % over surface), LanguageCodes (`text2` on 8 % text over surface), `chipActFg` over bg, `chipOkFg` over `ownA` and on the requested toggle, `text` on the ghost face, `text` on the duration glass over pure white: all at least 4.5:1 |
| Filled controls | `action` at least 3:1 on `bg`, `bar`, `surface`, `surface2`, `line`; `error` on `surface` and `surface2`; `rec` on `bg`; category tiles on `bg` (not neutral tiles); `onAction` on `action` and on `error` at least 4.5:1 |
| State marks | switch thumbs (`text3` on `line`, `onAction` on `action`), idle checkbox ring (`text3` on every level), focus and error rings (on the field face and on the container) at least 3:1; unplayed waveform at least 3:1 on `surface` |
| Ladder | `bg - bar > 1`, `barLine - bar >= 6`, every neutral step at least 6 L*; raised, inset and disabled faces at least 6 L* from every container level |
| Lips | coloured lips (action, own, the four categories, the chip lip under `line`, the danger lip) at least 15 L* under their face; `surface - lip >= 8`; `bg - lip >= 3.5`; chip lip at least 2 L* under `bg` (test 1.9 for float slack) and at least 6 under `surface` |
| Meaning | OKLab distance x100: `error` to `action` at least 7, `warning` to `action` and to `error` at least 6.5 |
| Glass | `glassRing` opaque and at least 2.5:1 on `bg`; the sheet at least 6 L* above the scrim over bg |

#### 1.6.3 Final palette values

Re-run of the contrast auditor's script (`scratchpad/contrast/contrast.js`, palette copy
verified against this worktree's `palettes.ts`: 220 tokens, 0 mismatches): 94 failing cells
before, 0 after with these values (the script's own error threshold is 8; with the rule
above, 7, kitaplik's unchanged error passes at 7.1). Differences from the auditor's
`palettes-after.js`, decided here:
- kitaplik `error` and orman `error` stay as shipped (the moves were invisible: 1.3 and 1
  OKLab steps; kitaplik's would also drift towards its rose category).
- `lineLip` uses the auditor's sRGB mix (2 L* under `bg`), not the skeptic's hue-kept OKLCH
  shift: the OKLCH lip lands within 1.3 L* of the canvas (orman even 1.2 lighter), so an
  idle chip on the canvas would show no lip and its 2dp sink would read as the chip moving.

Changed tokens are marked with `*`. Hex in `palettes.ts` order (`BasePalette` lines
169-274). `bar`, `lip` and every non-listed token are unchanged.

| Palette | bar | bg | surface | surface2 | line | lineLip | lip | text3 | error | warning |
|---|---|---|---|---|---|---|---|---|---|---|
| kitaplik | #0A1619 | #0E1C20 | #152A2F | #1F383E* | #2A464D | #0B181A* | #050E10 | #8CA39F* | #FF8F8F | #F2B866 |
| orman | #08110B | #0C1710 | #16281C | #1F3626* | #2C4733 | #09110B* | #040A05 | #8FA089 | #F48C80 | #FFA66E* |
| gece-mavisi | #0D1420 | #121A29 | #1D2738* | #283449* | #35425A* | #101522* | #080C16 | #939EB4* | #F58EB5* | #DDBB7E |
| murekkep | #0D0E0F | #121314 | #1F2022* | #2B2D2F* | #393B3E* | #0C0D0E* | #060707 | #959691* | #F2958C | #EBC3A3 |
| erik | #160E1A | #1D1322 | #2B1E31* | #392A41* | #493753* | #180F1C* | #0E0711 | #A9939F | #FF8F8F | #F1C163 |
| orijinal | #100C30 | #15113A | #211B55 | #2D2670 | #3A3386* | #110D31* | #0A0723 | #9D96D6 | #FF8FA3 | #FFBB5D* |

L* of `bar / bg / surface / surface2 / line` after the change: kitaplik 6.4/9.2/15.6/21.8/27.9,
orman 4.3/6.6/14.2/20.3/27.5, gece-mavisi 6.2/9.2/15.5/21.5/27.8, murekkep
3.9/5.8/12.2/18.3/24.8, erik 5.1/7.6/13.6/19.7/26.1, orijinal 5.3/7.8/14.2/20.5/26.7.
The visible lifts are gece-mavisi (the default), murekkep and erik; the rest are one or two
units, only to meet the rule.

Derived (in `derivePalette`, `palettes.ts:302-326`):
- `glass: withAlpha(base.bg, 0.7)` (was 0.62: text on the duration chip over a white cover
  goes from 4.30 to 5.63:1 at worst; React Native has no backdrop blur).
- `ownA/ownB/ownC` re-derive from the new surfaces automatically (for example gece
  `#3D4661 / #323D55 / #242D40`). No other derivation changes.
- No new palette tokens: `glassRing`, `ghostFace` and the requested toggle are functions of
  existing tokens (1.6.1).

Reference values computed with the final palettes (for test literals and reviews):

| Palette | glassRing | ghost on ownB | requested toggle |
|---|---|---|---|
| kitaplik | #566669 | #182B2F | #2C4B4E |
| orman | #576559 | #18261E | #2F4833 |
| gece-mavisi | #5B6371 | #1E2638 | #354554 |
| murekkep | #5E5E5F | #202124 | #3C423E |
| erik | #685C6B | #292032 | #473E4C |
| orijinal | #615C88 | #1C164E | #39487A |

Document the deviation from the approved mockup next to the note at `palettes.ts:258` and
in the mockup README token table (`../design/v4/playful/README.md`): "surfaces lifted to a
6 L* ladder for contrast; chip lips darker than the canvas".

The existing `theme.test.tsx` suite was replayed against these values in a scratch jest
(module-mapped `palettes.ts`): 58 of 59 pass; the one failure is the gece-mavisi literal
test (`theme.test.tsx:36-60`), whose `surface`, `surface2`, `line` and `text3` literals take
the new values and whose name becomes "gece-mavisi tokens (mockup values, ladder lifted)".
Replace the weak `expect(P.error).not.toBe(P.action)` at `theme.test.tsx:189` with the
OKLab rule (it moves to the contract test).

### 1.7 Motion

`src/theme/motion.ts` (new; no library import except RN `Easing` and `AccessibilityInfo`):

```ts
export const DURATION = {
  pressIn: 70,      // sink and tint in
  pressOut: 120,    // rise and tint out
  fast: 120,        // cross-fades (compact segment pill, options dim, seek knob grab, slider drag step)
  base: 200,        // state changes in place (switch knob, slider tap, tab pill, dialog enter)
  enter: 240,       // things that appear (snackbar, dock, first content fade-in)
  exit: 160,        // things that leave (snackbar, dock, dialog)
  sheetEnter: 280,
  sheetExit: 200,
  loop: 1400,       // indeterminate progress bar
  pulse: 1600,      // skeleton pulse (floor opacity 0.7)
} as const;
/** Cubic-bezier control points, for RN Easing.bezier or Reanimated Easing.bezier. */
export const CURVE = {
  standard: [0.2, 0, 0, 1],    // decelerate: enters, state changes, presses
  exit: [0.3, 0, 1, 1],        // accelerate: leaving
  symmetric: [0.4, 0, 0.2, 1], // loops (now-playing bars, progress loop)
} as const;
export const EASE = {
  standard: Easing.bezier(...CURVE.standard),
  exit: Easing.bezier(...CURVE.exit),
  symmetric: Easing.bezier(...CURVE.symmetric),
  linear: Easing.linear,       // playback progress only
};
/** Damping ratio 0.73: about 3 % overshoot, settles in about 300 ms. */
export const SPRING_SNAPPY = { stiffness: 320, damping: 26, mass: 1 } as const;
/** Damping ratio 0.9: no visible overshoot; sheet drag release. */
export const SPRING_SHEET = { stiffness: 420, damping: 37, mass: 1 } as const;
export const PRESS_DELAY_MS = 100;
export const PRESS_TINT = 0.6;
export function useReducedMotion(): boolean;      // moved from Skeleton.tsx:39-55
export function animateTo(value: Animated.Value, toValue: number, kind: keyof typeof DURATION, reduced: boolean): Animated.CompositeAnimation | null;
```

Reduced motion: every translate and scale is applied at once (`setValue`, or duration 0
in Reanimated); opacity cross-fades keep `DURATION.fast`. Reanimated code reads
`useReducedMotion` from Reanimated.

Where each token applies:

| What | Animation | Tokens |
|---|---|---|
| Tactile sink and rise | translateY 0 to lip | pressIn / pressOut, standard |
| Press tint (faceless targets) | opacity 1 to 0.6 | pressIn / pressOut |
| Segmented pill (fill mode) | translateX on one shared pill; label colour cross-fade from the same value | `Animated.spring` SPRING_SNAPPY, native |
| Segmented pill (compact mode) | per-segment pill opacity cross-fade | fast |
| Switch | knob translateX 0 to 22, track and thumb colour layers cross-fade | base, standard |
| Speed slider | knob and fill translateX | tap: base; drag step: fast |
| Seek knob grab | scale 1 to 1.15 | fast |
| Bottom sheet | scrim opacity and sheet translateY | enter: sheetEnter standard; exit: sheetExit exit; drag release: SPRING_SHEET |
| Dialog | scrim opacity; card opacity and scale 0.94 to 1 | enter: base standard; exit: exit |
| Snackbar | translateY 16 to 0 and opacity; leave to 8 | enter / exit |
| Mini player dock | translateY 24 to 0 and opacity (overlay, no layout change) | enter / exit |
| Keşfet filter card (list content) | Reanimated layout animations on the UI thread: the card `FadeInUp` in, `FadeOutUp` out; the blocks under it and every grid row (`itemLayoutAnimation` of `Animated.FlatList`) `LinearTransition`; the picks row fades. No height animated. Reduced motion: none, instant | in: enter standard; out: exit; rows: enter standard |
| Tab pill (newly focused) | opacity 0 to 1 and scale 0.9 to 1 | base, standard |
| First real content after a skeleton | opacity 0 to 1 (`FadeIn`, once) | enter, standard |
| Skeleton pulse | one shared looping value, 1 to 0.7 | pulse, symmetric |
| ProgressBar indeterminate | loop | loop, symmetric |
| Now-playing bars | three native loops, 520 / 640 / 580 ms per bar | symmetric |
| Minute wheel | scale and opacity interpolated from the native scroll value, no timing | none |
| Countdown digits | none: tabular digits change in place, never animated | none |
| Screen push | native-stack `ios_from_right` (200 ms on Android) | `SCREEN_ANIMATION` map |
| Content opens (StoryDetail, CollectionDetail, AudioPlayer, Subscription) | `fade_from_bottom` | map |
| State swaps (Main from Splash, Login, Onboarding, ForceUpdate, Processing, VoiceSuccess, AudioGeneration, NoInternet) | `fade` | map |
| Playback progress | `Animated.timing` in 20 s chunks, linear | linear (owned by the player spec) |

Banned outside `motion.ts`: numeric `duration:` literals, `useNativeDriver: false`,
React Native `LayoutAnimation` (scan test in 5.4; Reanimated layout animations, `entering` / `exiting` / `layout` built from these tokens, run natively and are allowed). `TACTILE_PRESS_MS` (`Tactile.tsx:36`) is replaced by the
tokens. `SHEET_SWAP_MS` (`StoryDetailScreen.tsx:108-110`) is deleted (sequencing goes through
`onClosed`, 2.2).

---

## 2. Architecture

### 2.1 System bars

Verified in `node_modules/react-native` (0.83.6): `edgeToEdgeEnabled=true`
(`android/gradle.properties:47`) makes `ReactModalHostView.statusBarTranslucent` and
`navigationBarTranslucent` return `field || isEdgeToEdgeFeatureFlagOn`
(`ReactModalHostView.kt:83-94`), so every Modal window runs `Window.enableEdgeToEdge()`
(`:390-391`). `WindowUtil.kt` `enableEdgeToEdge()` makes the bar transparent (API 29+),
**forces `isNavigationBarContrastEnforced = true`** and sets
`isAppearanceLightNavigationBars = !UiModeUtils.isDarkMode(context)`, which reads
`configuration.uiMode`, not the theme. The white bar under sheets is the platform's light
contrast scrim on a Modal window whose configuration says "not night". `Modal.js` accepts
`statusBarTranslucent` and `navigationBarTranslucent` (`:167`, `:172`), but on this build both
change nothing (the getters return `field || isEdgeToEdgeFeatureFlagOn`), so `ModalWindow`
passes neither (the release pass dropped them; `ModalWindow.test.tsx` guards
`edgeToEdgeEnabled=true` instead). `targetSdk` is 36 (`gradle.properties:69`), so on Android 15+
`setNavigationBarColor` is ignored: the app must look right with a transparent bar anyway.

Design: **the navigation bar is transparent with no contrast scrim in every window; what
shows through is what the app draws** (the tab bar pads under the inset in `T.bar`,
`MainScaffold.tsx` bar `paddingBottom: insets.bottom`; stack screens draw `T.bg`
through `contentStyle`, `RootNavigator.tsx:259`; a sheet draws `T.surface` under its
`dockBottom` padding; the player its own background).

Native (one rebuild, section 6):
1. `MainApplication.kt` `onCreate`, right after `super.onCreate()`:
   `AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)`. Night mode is
   then part of the attach-time configuration of the activity and of every Dialog context,
   so every Modal gets light icons and a dark scrim even before the step below runs.
2. `MainActivity.kt` after `super.onCreate(null)` (React Native's activity
   `enableEdgeToEdge` runs once inside super):
   ```kotlin
   if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
     window.isNavigationBarContrastEnforced = false
     window.navigationBarColor = Color.TRANSPARENT
   } else {
     window.navigationBarColor = ContextCompat.getColor(this, R.color.window_background)
   }
   WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars = false
   ```
3. New local Expo module `modules/sesly-system-bars` (Android only, same shape as
   `modules/sesly-media`: `expo-module.config.json`
   `{"platforms":["android"],"android":{"modules":["expo.modules.seslysystembars.SeslySystemBarsModule"]}}`,
   `android/build.gradle` like sesly-media without the Media3 lines). Module:
   `Name("SeslySystemBars"); View(ModalSystemBarsView::class) {}`. `ModalSystemBarsView`
   (an `ExpoView`):
   - `onAttachedToWindow`, in `post {}`: walk `parent` up to the first
     `ReactModalHostView.DialogRootViewGroup` (public class), resolve the host with
     `UIManagerHelper.getUIManagerForReactTag(reactContext, root.id)?.resolveView(root.id) as? ReactModalHostView`,
     take `host.dialog?.window` (`dialog` is public, `ReactModalHostView.kt:76`), cache it and
     one `WindowInsetsControllerCompat(window, window.decorView)`, call `apply()`, and add a
     `ViewTreeObserver.OnPreDrawListener` on `window.decorView` that calls `apply()` and
     returns true. The pre-draw re-assert matters: React Native re-runs `updateProperties`
     (and so `enableEdgeToEdge`) on `onHostResume` (`:215-218`) and on Modal prop updates.
   - `apply()` writes only when needed:
     `if (w.navigationBarColor != Color.TRANSPARENT) w.navigationBarColor = Color.TRANSPARENT`,
     `if (SDK_INT >= 29 && w.isNavigationBarContrastEnforced) w.isNavigationBarContrastEnforced = false`,
     `if (ctrl.isAppearanceLightNavigationBars) ctrl.isAppearanceLightNavigationBars = false`.
   - `onDetachedFromWindow`: remove the listener, drop the cached window.
   - JS `modules/sesly-system-bars/index.ts`: `getModalSystemBars()` returns `null` unless
     `Platform.OS === 'android'`, else lazily `requireNativeView('SeslySystemBars')` from
     `expo-modules-core`. Never call `requireNativeView` on iOS.
   Without this module, step 1 alone already removes the white bar; the module removes the
   remaining dark band in 3-button navigation.
4. `android/app/src/main/res/values/styles.xml`: `AppTheme` parent
   `Theme.AppCompat.DayNight.NoActionBar` (dark with step 1; system popups such as the text
   selection toolbar and autofill are then dark too). Add
   `<item name="colorControlNormal">#8C97AD</item>`,
   `<item name="colorControlActivated">#F2917B</item>`, `<item name="colorAccent">#F2917B</item>`
   (default palette text3 and action: only native fallbacks, the app sets per-palette colours
   on its inputs). Every `TextInput` gets `underlineColorAndroid="transparent"` and
   `selectionHandleColor={T.action}` (`rows.tsx:448`, the new `SearchField`), so the dark
   theme never draws an EditText underline.
5. `values/colors.xml` and `values-night/colors.xml`: `window_background` and
   `splashscreen_background` `#121A29` (gece-mavisi `bg`, `palettes.ts:204`); delete the stale
   light-only comment in values-night. `app.config.js:10` `userInterfaceStyle: "dark"` (drop the
   comment), splash and adaptive-icon background `#121A29` (the splash spec owns the
   composition); `ios/Sesly/Info.plist:83-84` `UIUserInterfaceStyle` `Dark`.

JS:
- Delete `syncNativeColorScheme` (`ThemeProvider.tsx:95-101`, the `Appearance.setColorScheme`
  call at :137-141): the native pin and the plist are the single source of truth, guarded by
  a static test (5.6).
- Delete per-screen navigation-bar calls: `ScreenChrome` (`ThemeProvider.tsx:173-182`), the
  provider effect (`:143-145`) and `AudioPlayerScreen.tsx:472-476`. `withThemedChrome` is
  replaced by `withScreenPalette` (2.4). The root `<StatusBar barStyle="light-content"
  translucent backgroundColor="transparent" />` in `App.tsx` AppShell stays the only status
  bar element (every screen is dark).
- Android 7 to 9 (API 24 to 28, transparent bars unsupported there): `ThemeProvider` makes
  **one** `changeNavigationBarColor(palettes[palette].bar, false, false)` call per committed
  palette (mount and switch) when `Platform.Version < 29`, nothing on newer Android. That is
  the only remaining use of `react-native-navigation-bar-color`.

### 2.2 ModalWindow, BottomSheet and Dialog

Inventory (verified by grep): every Modal in `src` is `BottomSheet` (`BottomSheet.tsx:54-60`,
twelve consumer surfaces), `Dialog` (`Dialog.tsx:59-65`, one `OptionsDialog` host behind
`useDialog`) and the hand-made `CreatePlaylistModal` (`PlaylistSheet.tsx:281-287`; it becomes
a `Dialog` with children or disappears with the R12 v1 queue, see the playlist spec).

`src/components/design/ModalWindow.tsx` (new):

```tsx
export const ModalWindow: React.FC<ModalWindowProps> = ({ visible, onRequestClose, onDismiss, children }) => {
  const Bars = getModalSystemBars();
  const appHeight = useSyncExternalStore(subscribeSheetPresence, appWindowHeight);
  const rootStyle =
    Platform.OS === 'android' && appHeight > 0 ? [styles.fill, { minHeight: appHeight }] : styles.fill;
  return (
    <Modal visible={visible} transparent animationType="none"
           onRequestClose={onRequestClose} onDismiss={onDismiss}>
      {Bars ? <Bars testID="modal-system-bars" style={styles.zero} /> : null}
      <GestureHandlerRootView style={rootStyle}>{children}</GestureHandlerRootView>
    </Modal>
  );
};
```

Android content height (V3-07, "cut the wait"): the root veil (Handoff, below) measures the app
window and `sheetPresence.appWindowHeight()` keeps it; a Modal window has the same bounds (edge to
edge, also in split screen), so its content is laid out at least that tall from the first layout.
The window gate below then passes on that first layout instead of waiting for the state update
that brings the real size on the JS thread (which takes hundreds of milliseconds while the JS
thread is busy, the 0.6 s between a sheet and its dialog). `minHeight`, never a fixed height: the
content can still grow to a larger real window, and it is unset (`flex: 1` alone, as on iOS)
until the veil measured once.

No `statusBarTranslucent` / `navigationBarTranslucent`: React Native ignores both on this
edge-to-edge build (2.1). The Metro warning "statusBarTranslucent, navigationBarTranslucent and
preserveEdgeToEdge values are ignored when using react-native-edge-to-edge" comes from the
`KeyboardProvider` props in `App.tsx` (react-native-is-edge-to-edge, `__DEV__` only), not from
the Modal; those three props are no-ops there too.

`onRequestClose` is always a function (Android dispatches it unconditionally).
Gesture handler needs its own root inside a Modal window (`RNGestureHandlerRootView.kt`).

Presence (shared by sheet and dialog), `src/components/design/usePresence.ts`, Reanimated
4.2.1 plus `scheduleOnRN` from react-native-worklets 0.7.4 (`runOnJS` is deprecated in 4.x):
- State: `mounted` (drives Modal `visible`), shared `progress` 0 to 1, `closing` flag.
- `visible` true on a fresh mount: mount, wait for the first `onLayout` (sheet height `h`),
  then `progress = withTiming(1, { duration: DURATION.sheetEnter, easing: standard })`.
- `visible` false: `closing = true`, `withTiming(0, exit)`; the end callback with
  `finished === true` calls `scheduleOnRN(finishClose)`, which unmounts and calls
  `onClosed`. A cancelled exit (`finished === false`) never unmounts.
- `visible` true while closing: cancel and run `withTiming(1)` from the current value;
  `onLayout` does not fire again, so never wait for it in this case.
- While closing: `pointerEvents="none"` on the sheet and scrim, `onRequestClose` ignored.
- Reduced motion: translate and scale applied at once, scrim fades in `DURATION.fast`.
- Props added to both components: `onOpened?()` and `onClosed?()`; the `visible` /
  `onClose` contract is unchanged, so no consumer must change.
- Android window gate (`waitForWindow`, both components; V3-01): Fabric creates a Modal's
  state at the screen size without the vertical insets
  (`ModalHostViewComponentDescriptor::createInitialState`,
  `DisplayMetricsHolder.getEncodedScreenSizeWithoutVerticalInsets`), and the real edge-to-edge
  size arrives only through `DialogRootViewGroup.onSizeChanged` as a state update flushed on the
  JS thread. React Native already makes the dialog window edge to edge before `show()`
  (`updateProperties`), so no native module can fix the first layout. The enter of a fresh
  window therefore waits until the window root's `onLayout` reports the screen height
  (`Dimensions.get('screen').height`, 2dp tolerance), or a second size (a window smaller than
  the screen), or `WINDOW_FALLBACK_MS` (450). Until then the scrim is at 0, the sheet waits a
  full screen below, and the window counts as waiting in `sheetPresence`. iOS never waits.
  With ModalWindow's `minHeight` (above) the first layout already has the screen height on a
  full-screen phone, so the gate passes at once; it stays for a window smaller than the screen
  and for the moment before the veil measured.
- Every enter calls `noteWindowEnter(config)` (its duration and easing) before the window stops
  waiting, so a root veil held for that window fades out on the same timing, in the same call.
- The sheet's translate reads its height from every `onLayout` once the enter started, so a
  resize during the enter never leaves a gap or a snap.
- `onClosed` timing: iOS after the Modal's `onDismiss` (unchanged); Android in the same batch as
  the unmount (no effect in between), so what it opens commits with the window going; `onGone`
  (BottomSheet's geometry reset) and the scrim reset follow the unmount commit, so the leaving
  window never redraws. A window that its own `onClosed` opens again in that batch never
  unmounted and enters at once. On Android the visible effect is a layout effect, so the enter of
  a window that need not wait starts with its first frame.

Handoff (Android, V3-07, NL-08, NEW-1, LR-2): the screen never undims between a sheet and the
dialog or sheet opened from its `onClosed`, and no close shows a frame brighter than the next.
The first version handed the scrim over in one step as the window went: the veil's view was
created in the commit that removed the sheet's window, the window removal reached the screen
first (and the dialog window created in the same mount stalled the app window further), so every
close went dark, bright, dark, then faded. Two windows can never be switched in one frame on
Android, so the hand-off is now gradual and finished before the window goes:
- The root veil (`HandoffVeil`, mounted by `DialogProvider` on Android, always, as its last
  child) is a `T.scrim` view in the app's own window, opacity 0 when idle, no touches. A hand-off
  only animates its opacity; no view is created.
- `BottomSheet` passes `veilHandoff` and `scrimAlpha` (the alpha of `T.scrim`). The exit claims
  the veil (`claimVeil`) and moves its scrim into it on the exit's own timing: the scale falls
  to `VEIL_AT_EXIT_END` (0.4), the share `g` rises 0 to 1, the veil's opacity rises to
  `level x drag x 0.4`. The sheet's own scrim is `S = K (f - V g) / (1 - a K V g)`
  (`scrimBesideVeil`; K = level x drag, f = scale, V = 0.4, a = scrim alpha), so scrim and veil
  dim exactly like one scrim at `K f` in every frame, and at the exit's end the sheet's window
  shows nothing. Its removal changes no pixel, however late the app window draws.
- As the window goes, `releaseVeil` (before `onClosed`) gives the veil back. It decides in a
  layout effect of the commit that `onClosed`'s batch makes, after every window's own: a window
  opened there waits for its real size, so the veil holds (no fixed fade) and fades out on that
  window's enter timing (`noteWindowEnter`) in the call that starts the enter, the new scrim
  rising over it, so the screen only gets darker. With nothing waiting it fades out in
  `DURATION.fast`, linear, at once (a follow-up is only known after `onClosed`, so this short
  fade is all a plain close adds to the old fade to 0). It holds `VEIL_HOLD_MAX_MS` (900) at
  most: every waiting window enters within its own `WINDOW_FALLBACK_MS`.
- Back during its exit, the sheet takes its share back: share and veil go to 0 on the enter's
  timing. Unmounted during its exit, it releases the veil, which fades out.
- A sheet that its parent unmounts in `onClosed` (the card menus) leaves nothing behind: its
  scrim is already in the veil, which lives in the provider.
- Without a root veil (no `DialogProvider`) and on iOS the scrim fades to 0 with the exit.

`BottomSheet` (`src/components/design/BottomSheet.tsx`):
- Tree: `ModalWindow` > `KeyboardAvoidingView` from react-native-keyboard-controller
  (`behavior="padding"`, `style={{ flex: 1, justifyContent: 'flex-end' }}`) > scrim
  `Animated.View` (absolute fill, `T.scrim`, a `Pressable` inside for close) and the sheet
  `Animated.View` > `SurfaceLevelProvider level="surface"`.
- Scrim opacity = `progress * (1 - clamp(dragY / h, 0, 1))`.
  Sheet translateY = `(1 - progress) * h + max(0, dragY)`.
- Drag to dismiss (cheap, adopted): `Gesture.Pan()` on the handle area and the header only
  (never on the content, so lists and the minute wheel scroll freely),
  `activeOffsetY([-6, 6])`; `dragY = max(0, translationY)`; on end
  `shouldDismissSheet(ty, vy, h) = ty > Math.min(140, 0.3 * h) || vy > 1000` closes through
  `onClose`, else `dragY = withSpring(0, SPRING_SHEET)`. Export `shouldDismissSheet` for tests.
  `testID="sheet-drag"` on the detector target.
- Geometry: top radius `T.r.sheet` (32); handle area 24 tall with a 40 x 5 handle in
  `T.line` (pill radius); header `paddingHorizontal 16`, `paddingTop 0`, `paddingBottom 8`,
  gap 12; content `paddingHorizontal 16`, `flexShrink 1`; `maxHeight '88%'`.
- Bottom padding: `P = dockBottom(insets.bottom)` while the keyboard is closed and **12** while
  it is open, interpolated by keyboard-controller's `useReanimatedKeyboardAnimation().progress`
  (`paddingBottom = P - (P - 12) * progress`). The keyboard-controller KAV pads the root by
  the keyboard height measured against the view frame, so the navigation-bar inset is never
  added on top of the keyboard (r8a-15, visual audit 2).
- New props: `scrollable?: boolean` (children inside a `ScrollView` with `flexGrow 0`,
  `bounces false`, `keyboardShouldPersistTaps="handled"`; used by PasswordResetSheet,
  SocialConsentSheet, TimerSheet); `fill?: boolean` (`height: '88%'` from the first frame
  instead of `maxHeight`; LegalSheet); `onOpened`, `onClosed`.
- Freeze `title` and `headerTrailing` while `visible` is false
  (`const frozen = useRef({ title, headerTrailing }); if (visible) frozen.current = { title, headerTrailing }`).
  Do not freeze children: ChoiceSheet and NarratorSheet close in the same tap that selects,
  and the new selection must stay visible while the sheet leaves.
- Keep `SnackbarHost inSheet` outside the translated sheet view, inside the window.
- Mount `<DialogOutlet />` (below) inside the window while `visible`.
- Sheet bodies never change height inside one sheet: a sheet whose body has alternatives
  (modes, tabs, running and idle) gets a fixed body height equal to the tallest alternative;
  a sheet whose content loads opens at its final height (`fill`, or a skeleton of the final
  geometry). Applies to TimerSheet (3.17), LegalSheet (3.16), PlaylistSheet (skeleton rows of
  the real row height).

`Dialog` (`src/components/design/Dialog.tsx`):
- `ModalWindow` > root `View` (`flex 1`, `justifyContent: center`, `paddingHorizontal 16`) >
  scrim (opacity `progress`) and the card (opacity `progress`, scale `0.94 + 0.06 * progress`).
  Enter `withTiming(1, DURATION.base, standard)`, exit `withTiming(0, DURATION.exit, exit)`.
- Card: `maxWidth 420`, radius `T.r.xxl` (28), `backgroundColor T.surface` with a 4dp
  `T.lip` lip, padding 20, title `heading`, message `marginTop 8`, actions `marginTop 20`,
  gap 8; buttons md `block`; `SurfaceLevelProvider level="surface"` (so "Vazgeç" is
  `surface2`, no longer the card colour).
- New: `children` slot after the message (a `TextField`); when children are present the root
  is a keyboard-controller `KeyboardAvoidingView behavior="padding"` (the centred card rises
  by half the keyboard). Per-action `disabled`. Focus an input in `onOpened` through a ref
  (`TextField` gets `ref`), never `autoFocus`.
- `onRequestClose={dismissOnScrim ? onDismiss : noop}`: `cancelable: false` dialogs ignore
  the Android back button too (ProcessingScreen failure, VoiceRecording reconsent and track
  dialogs relied on that). Update the docs at `Dialog.tsx:38` and `:117`.
- `OptionsDialog` calls `onClose()` **before** `button.onPress?.()` (`Dialog.tsx:152-155`), so
  a button that opens a follow-up dialog leaves it visible. A `showDialog` that arrives during
  the exit cancels the exit and animates back to 1 with the new options.

Dialog outlets (iOS presents a Modal from the root view controller, which UIKit refuses
while a sheet or a `presentation: 'modal'` screen is up, and the refused presentation leaves
every later dialog invisible; `RCTModalHostViewComponentView.mm:136-170`, sheets-navbar r14-4):
- `src/components/design/sheetPresence.ts`: a sheet registers on open, is marked closing when
  `visible` turns false and unregisters in `onClosed`. API: `isAnyClosing()`,
  `presentationBlocked()` (`isAnyClosing()` on iOS, always false on Android, whose windows
  stack), `whenAllClosed(cb)` (waits only while `presentationBlocked()`), the waiting windows
  (`markWindowWaiting`, `markWindowEntered`, `isAnyWindowWaiting`), the enters
  (`noteWindowEnter`, `windowEnterCount`, `lastWindowEnter`), the veil host (`setVeilHost`,
  `hasVeilHost`, `claimVeil`, `releaseVeil`) and the app window (`setAppWindowHeight`,
  `appWindowHeight`).
- `DialogProvider` (`src/hooks/useDialog.tsx`) keeps a LIFO stack of outlets in context.
  `<DialogOutlet />` registers on mount. The single OptionsDialog renders in the top outlet,
  or at the root when the stack is empty. On iOS a `showDialog` while a sheet is closing waits
  for `whenAllClosed` and the root dialog stays hidden while `presentationBlocked()`; on Android
  neither adds a tick.
- Outlets live inside every BottomSheet window (while visible) and in the five
  `presentation: 'modal'` screens (`RootNavigator.tsx:309-332`, wrapped by
  `withDialogOutlet`). On Android the dialog window simply stacks above the sheet window, as
  it does today for Profile's nested LegalSheet.
- `StoryDetailScreen.afterOptions`: store the action in a ref, close the sheet, run it from
  `StoryOptionsSheet`'s `onClosed`; delete `SHEET_SWAP_MS` and the swap timer. Remove the
  close-first step in `useAddNarrator` (`beforeDialog`) and `handleCreateVoice`: the dialog
  opens over the narrator sheet in its outlet.

Consumers whose content must survive the exit (r14-3): SocialConsentSheet keeps the last
`kind` in a ref; LegalSheet tags its fetch state with the slug and renders a state whose slug
is not the shown one as loading; PlayerTimerSheet keeps the last `remainingSec` while closed.

### 2.3 Keyboard

Decision: **react-native-keyboard-controller 1.20.7**, installed with
`npx expo install react-native-keyboard-controller`. Evidence:
- Expo SDK 55 pins exactly this version: `node_modules/expo/bundledNativeModules.json:103`
  `"react-native-keyboard-controller": "1.20.7"` (SDK 55 is React Native 0.83). The library's
  compatibility page requires React Native 0.81+ for 1.18+, and supports Fabric.
- It requires react-native-reanimated, which is installed (4.2.1, pinned by Expo).
- It handles Modal windows on Android: its `modal/ModalAttachedWatcher.kt` listens for the
  Modal `topShow` event, resolves the `ReactModalHostView`, attaches its keyboard insets
  callback to the dialog window and sets that window to `SOFT_INPUT_ADJUST_NOTHING`. React
  Native's own keyboard events are not reliable for a Modal's separate window, and RN's
  `KeyboardAvoidingView` leaves about 76dp of padding after the keyboard closes on this
  edge-to-edge build (visual audit 2, Login and Registration).
- Cost: one native dependency, autolinked (no prebuild), Android rebuild and `pod install`;
  batched with the system-bars rebuild (section 6). It also settles perf-21: Reanimated and
  Worklets stay, because sheets and the keyboard now use them.

Setup:
- `App.tsx` AppShell: `<KeyboardProvider statusBarTranslucent navigationBarTranslucent preserveEdgeToEdge>`
  inside `SafeAreaProvider`, around `DialogProvider`. The three props keep the app's own
  edge-to-edge layout (the provider must not add top padding or turn edge-to-edge off).
- Jest: `jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'))`
  in `src/test-utils/setup.ts`.

Use:
- **Auth forms** (`LoginScreen.tsx:111-223`, `RegistrationScreen.tsx:159-317`): replace RN
  `KeyboardAvoidingView` + `ScrollView` with
  `KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.scroll, { paddingBottom: dockBottom(insets.bottom) }]}`.
  The focused field plus 24dp stays above the keyboard; nothing is left behind when it closes.
  Return-key chain: `TextField` forwards `ref`; email `returnKeyType="next"`,
  `submitBehavior="submit"`, `onSubmitEditing` focuses the next field; the last field
  `returnKeyType="go"` submits; the reset sheet field `returnKeyType="send"`.
- **CreateVoiceProfileScreen** (`:153-243`): `KeyboardAwareScrollView` for the content and
  `KeyboardStickyView offset={{ closed: 0, opened: dockBottom(insets.bottom) - 12 }}` around
  `FlowDock`, with `bottomOffset` = dock height + 16. (Verified in the library source:
  `translateY = height + interpolate(progress, [0, 1], [closed, opened])` with a negative
  `height`, so a positive `opened` lowers the dock by the bottom padding it no longer needs.
  If a device reports the keyboard height without the navigation bar, the dock only ends that
  much higher; it is never covered.)
- **Sheets**: in `BottomSheet` as in 2.2. **Dialogs with inputs**: as in 2.2.
- Search fields at the top of Keşfet and Kütüphane need nothing.

### 2.4 Palette switch

Measured cause (palette-switch perf-1, probes re-run by the skeptic): one context for the
whole app (`ThemeProvider.tsx:147-149`, read by `useT` at `theme.ts:136-138`), so one pick
re-renders every `useT` consumer of every mounted screen (120 call sites, nothing frozen)
before Profile repaints; the swatch stays pressed until then.

Architecture:
1. **Two contexts** in `ThemeProvider.tsx`:
   `RootPaletteContext { palette, settled, setPalette }` and `ScreenPaletteContext`
   (`PaletteKey | null`, default null). `const [settled, setSettled] = useState(palette)` and
   ```ts
   useEffect(() => {
     if (settled === palette) return;
     const id = setTimeout(() => startTransition(() => setSettled(palette)), SETTLE_DELAY_MS); // 150
     return () => clearTimeout(id);
   }, [palette, settled]);
   ```
   The pick itself stays a **discrete** update (`setPaletteState` in the press handler). Do
   not wrap it in `startTransition` or `useOptimistic`: React 19 renders pending transition
   lanes together, so a transition pick would wait for the hidden screens' settle.
2. **useT** (`theme.ts:136-138`):
   ```ts
   export function useT(): Theme {
     const screen = useContext(ScreenPaletteContext);
     if (screen !== null) return themes[screen];
     return themes[use(RootPaletteContext).palette]; // outside any boundary: live
   }
   ```
   Consumers inside a boundary never subscribe to the root. Global UI (AppShell, the
   navigator theme, SnackbarHost, the OptionsDialog root host) stays live with no change.
3. **Per-screen boundary**: `ScreenPalette({ children, live })` provides
   `live || focused ? root.palette : root.settled`; `focused` comes from `NavigationContext`
   plus `useSyncExternalStore` on the `focus` / `blur` events (true without a navigation
   context). `withScreenPalette(Component)` replaces `withThemedChrome` for every route in
   `RootNavigator.tsx:147-175` and the four tabs (`MainScaffold.tsx:71-74`);
   `MainScaffold = () => <ScreenPalette><MainShell /></ScreenPalette>` (tab bar and mini player
   follow the shell); wrap `AudioPlayerScreen` too. Never provide `ScreenPaletteContext` at
   the ThemeProvider level.
4. **Freeze hidden screens**: `MAIN_TAB_SCREEN_OPTIONS = { headerShown: false, lazy: true, freezeOnBlur: true }`
   (`MainScaffold.tsx:82-86`) and `ROOT_SCREEN_OPTIONS = { headerShown: false, animation: 'ios_from_right', freezeOnBlur: true }`
   (`RootNavigator.tsx:256-260`). A frozen tab renders its catch-up when shown. Check on a
   device that the library row progress and skeleton loops resume after returning to a tab.
5. **Optimistic picker** (`PalettePicker.tsx:27-45`): the ring moves in its own commit, the
   palette applies one frame later at sync priority:
   ```tsx
   const [shown, setShown] = useState(palette);
   const [seen, setSeen] = useState(palette);
   if (seen !== palette) { setSeen(palette); setShown(palette); }
   const raf = useRef<number | null>(null);
   useEffect(() => () => { if (raf.current != null) cancelAnimationFrame(raf.current); }, []);
   const pick = (key: PaletteKey) => {
     if (key === shown) return;
     setShown(key);
     if (raf.current != null) cancelAnimationFrame(raf.current);
     raf.current = requestAnimationFrame(() => { raf.current = null; void setPalette(key); });
   };
   ```
   The same optimistic pattern is built into `SegmentedControl` (its pill moves at once and
   `onChange` runs in the next frame), which fixes the Profile UI-language row
   (`ProfileScreen.tsx:423`, visual audit 15) without touching i18n.
6. **Cached styles**: `themedStyles(factory)` in `theme.ts`, a `WeakMap<Theme, S>` cache
   (themes are module singletons, so a switch back is a cache hit). `textStylesFor =
   themedStyles(makeTextStyles)`; `useTextStyles()` returns `textStylesFor(useT())`. Replace the
   125 `useMemo(() => make*(T), [T])` sites file by file (`const stylesFor =
   themedStyles(makeStyles)`). Level-dependent colours (SurfaceLevel) are computed per render,
   never cached in a sheet.
7. **One persist, no bar calls**: `AsyncStorage.setItem` after the state update (already
   async, not awaited before render). Navigation bar: none on Android 10+ (2.1); one call per
   committed palette on Android 7 to 9.

Expected behaviour (owner-visible): the picked swatch and Profile recolour in the frame after
the tap; screens below recolour about 150 ms later, unseen. An iOS back swipe started within
150 ms of a pick may show the old colours for a moment.

---

## 3. Component changes

Each item lists file, change, and the existing tests it updates (section 5 has the new ones).

### 3.1 `src/theme/theme.ts`
- `SPACE`, `RADIUS`, `LIP`, `SCREEN_PAD_H`, `dockBottom`, `lipFor`, `themedStyles`,
  `textStylesFor`; `sharedTokens` reads them; delete `lipSize.xl`; `useT` as in 2.4.
- Update the header comment (`:8-23`) to the cached-style pattern.

### 3.2 `src/theme/palettes.ts`, `src/theme/surfaces.ts`, `src/theme/color.ts`
- Values of 1.6.3, `glass` alpha 0.7, the deviation note.
- `surfaces.ts` as in 1.6.1. `color.ts` gains `lightness()` (CIELAB L*) and
  `oklabDistance()` (moved from the scratch test).

### 3.3 `src/theme/motion.ts` (new) and `src/theme/ThemeProvider.tsx`
- Motion as in 1.7; ThemeProvider as in 2.1 and 2.4.

### 3.4 `src/components/design/Tactile.tsx`
- `pressDelay?: number` (default `PRESS_DELAY_MS`) passed as `unstable_pressDelay`.
- Sink uses `DURATION.pressIn / pressOut` and `EASE.standard`; export `usePressTint()`
  next to `usePressSink`.
- Default `lip` becomes `LIP.md` (unchanged value 3), read from the token.
- Disabled and dimmed: `opacity 0.5` only when `dimWhenDisabled`, and then
  `needsOffscreenAlphaCompositing` on the outer view.
- `__DEV__` warning when `color` starts with `rgba(` and `lipColor` is not `transparent`.

### 3.5 `src/components/design/Button.tsx` (+ `buttonMetrics.ts`, `buttonColors.ts`)
- Metrics from `BUTTON_METRICS` (`:66-70` today: 40/48/58, lips 2/3/4, radii 14/16/20,
  fonts 14/15/17); padH and gap from the table (`:169-170`).
- Colours from `buttonColors(T, variant, tone, useSurfaceLevel(), { disabled, parentColor })`
  (1.6.1); `dimWhenDisabled={false}`; new props `singleLine`, `parentColor` (ghost).
- `loading` overlay spinner (1.4).
- `TextButton` (`:183-211`): no sink, `usePressTint`.
- Header comment `:13`: "Sizes: sm 36, md 44, lg 52"; CLAUDE.md "40 / 48 / 58dp" line too.
- Tests to update: `components.test.tsx:168-171` (hitSlop 5 for sm), `:128` stays (bg level
  gives surface), `:131` (ghost now a hex).

### 3.6 `src/components/design/rows.tsx`
- `Avatar` (`:49-121`): with `lipColor`, a Tactile-style split (absolute lip layer, the bubble
  on `usePressSink(LIP.md)`); without, `usePressTint`. Delete `translateY: pressed ? 2 : 0`.
- `IconButton` (`:147-210`): tactile face `raisedFace(T, level)`, lip `LIP.sm`, radius 16,
  hitSlop 1 / 2; glass face `T.surface` + 1dp `glassRing(T)` (forward `borderColor` and
  `borderWidth` to Tactile); new `variant="badge"` (28 circle, `T.surface`, 1dp glassRing,
  glyph 16, no lip, tint, hitSlop 10); plain: tint, new `hitSlop` prop.
- `TopAppBar` (`:237-302`): row `paddingTop 8` stays, gap 12 (was 10); tab title
  `adjustsFontSizeToFit`, `maxFontSizeMultiplier 1.15`, `minimumFontScale 0.8`.
- `ListRow` (`:330-408`): plain rows tint, minHeight 56, gap 12, padH 16; card rows radius 20,
  padding 12, minHeight 64; icon tile 40, radius 12, `raisedFace(level)`.
- `TextField` (`:424-485`): new shared `FieldFrame` (face plus an absolute lip layer, like
  Tactile, no press) so the lip does not taper at the corners; face `insetFace(T, level)`,
  radius 20, minHeight 52, padL 16, padR 8; 2dp ring transparent, `text2` focused, `error`
  on error (`:444-445` today uses `T.line`); `ref` prop; `underlineColorAndroid="transparent"`,
  `selectionHandleColor={T.action}`. Label `marginBottom 8`, helper `marginTop 6`.
- `StateView` (`:501-527`): paddings 32 stay (line length); title `maxWidth 300` like the
  message; action `marginTop 24`, md.
- `StateIcon`: lip `LIP.lg` (76dp, unchanged value 4).

### 3.7 `src/components/design/SearchField.tsx` (new)
- `FieldFrame` on `insetFace`, radius 20, minHeight 52, paddingLeft 16, paddingRight 8,
  gap 8, search icon 20, a 36dp clear tile (radius 12, `raisedFace`, lip 2) only while
  there is text. Replace the two hand-built fields: `StoryLibraryScreen.tsx:269-276,544-570`
  and `MyLibraryScreen.tsx:495-508`, both with `marginTop 12`.
- Tests to update: `MyLibraryScreen.test.tsx:452` (lip and radius), keep
  `StoryLibraryScreen.test.tsx:485-486` passing.

### 3.8 `src/components/design/controls.tsx`
- `Chip` (`:55-103`): padH 12; props `onLongPress`, `trailing`, `role: 'button'` (no
  selection state announced). The timer quick picks become `<Chip role="button">`.
- `Tag` (`:147-178`): padH 12 / 8, gap 4, `maxFontSizeMultiplier` prop default 1.3.
- `SegmentedControl` (`:200-273`):
  - Well: `insetFace(T, level)` (delete the overrides at `TimerSheet.tsx:372`,
    `CreateVoiceProfileScreen.tsx:256`, `ProfileScreen.tsx:607`), radius 16, padding 4 on all
    sides (was `paddingBottom 1`, `:438`), gap 4.
  - Segments are plain `Pressable`s holding only labels: no Tactile, no translateY, tint on
    press, hitSlop 7.
  - Fill mode: measure the well (`onLayout`), `segW = (W - 8 - 4 * (n - 1)) / n`; one absolute
    pill at top 4, left 4, `width segW`, face 32 in `T.action` on a 2dp `T.actionLip` layer,
    radius 12; one `Animated.Value pos` in index units,
    `translateX = pos.interpolate([0, n - 1], [0, (n - 1) * (segW + 4)])`,
    `Animated.spring(pos, { toValue: index, ...SPRING_SNAPPY, useNativeDriver: true })`.
    Before the first layout the pill is drawn inside the selected segment (identical geometry),
    so there is never an empty frame; `setValue` for the first position.
  - Labels: two stacked Texts per segment (`text2` and `onAction`); the `onAction` layer's
    opacity is `pos.interpolate({ inputRange: [i - 1, i, i + 1], outputRange: [0, 1, 0], extrapolate: 'clamp' })`,
    the other its complement. Do not switch label colour at press-in (dark `onAction` ink on
    the dark well would vanish while the pill travels).
  - Compact mode (Profile rows): segment padH 8; per-segment pill opacity cross-fade in
    `DURATION.fast` (unequal widths cannot run width on the native driver).
  - Optimistic value (2.4): local `shown` updated at press, `onChange` in the next frame.
  - Reduced motion: `setValue`.
- `Switch` / `SwitchFace` (`:288-320`): `Animated.Value v`; knob `marginLeft 4` fixed,
  `translateX v * 22`; track as two stacked layers (off `line` on `lineLip`, on `action` on
  `actionLip`, on layer opacity `v`); thumb as two stacked 22dp discs (`text3`, `onAction`,
  the second at opacity `v`); `DURATION.base`, `EASE.standard`; `testID` passes
  `${testID}-thumb`.
- `SwitchRow` (`:334-368`): delete the sink (`:345`, `:358`); tint on the label block; minHeight
  56, gap 12, padH 16.
- `Checkbox` (`:381-403`): 24 box, radius 6, 2dp ring `text3` idle, `action` face and ring
  with `actionLip` bottom edge when checked (same geometry both states); tint.

### 3.9 `src/components/audio/Stepper.tsx`, `SteppedSlider.tsx`, `MinuteWheel.tsx`
- Stepper: keys 40 circles on `raisedFace(level)` (surface2 inside the timer sheet, as
  today), lip `LIP.sm`, `pressDelay={0}`; disabled keys use `disabledFace` with a `text3`
  glyph; the value Text uses Baloo 2 with `fontVariant: ['tabular-nums']` in a fixed
  `minWidth 44` box, so the keys never move when the value goes from 9 to 10.
- SteppedSlider: knob and fill on one `Animated.Value` (translateX, fill drawn like
  `AnimatedFill` with full width and `translateX = x - width`); tap `DURATION.base`, drag
  step `DURATION.fast`; labels `maxFontSizeMultiplier 1.3`; labels block height
  `Math.ceil((18 + 2 + 15) * Math.min(PixelRatio.getFontScale(), 1.3))`.
- MinuteWheel: stable initial `contentOffset` (a ref, never re-sent; `:301` today re-sends it
  on every minute, which makes the list run ahead of the finger); `Animated.ScrollView` with
  a native `onScroll` value; every row draws its number once in Baloo 2 34/46 tabular and
  takes scale `[0.45, 0.6, 1, 0.6, 0.45]` and opacity `[0.35, 0.6, 1, 0.6, 0.35]` from the
  scroll position over 5 rows; the "dk" unit drawn once on the selection band; export
  `WHEEL_HEIGHT`; `React.memo` with a stable `valueText` and `handleWheel`; rows as single
  Texts with one tap target mapped by `locationY`. Nudges keep `pressDelay={0}`.

### 3.10 `src/components/design/cards.tsx`
- `Card`: padding 16, radius `T.r.xl`, lip `LIP.md`, `SurfaceLevelProvider` (1.6.1).
- `CategoryTile`: radius 20 (was 19, `:148`), `minWidth` instead of `width`, label
  `flexShrink 1` (not `flex 1`), `maxFontSizeMultiplier 1.3`, label `maxWidth` 84 x font scale
  (capped at 1.3) so labels wrap at word boundaries.

### 3.11 `src/components/design/PictureCover.tsx`
- `coverLip` as in 1.3; badge geometry as in 1.5 (`:320-352`).
- `CoverCard` gets `overlay?: React.ReactNode`. When set, the Pressable is wrapped in a
  `View { width }` and the overlay is rendered after it, as a sibling (never inside the
  accessible card: PictureCover's root is `accessibilityRole="image"`, CoverCard an accessible
  Pressable, and a button inside either is unreachable for screen readers), in an
  `Animated.View pointerEvents="box-none"` at the cover's box with `transform: [{ translateY }]`
  equal to the cover's sink (`:251`). Same pattern as the home hero (`HomeScreen.tsx:432-445`).

### 3.12 `src/components/story/StoryCard.tsx`
- Bookmark: `IconButton variant="badge"` passed as `overlay`, positioned `top 4, right 4`
  (`:184` today `top 6, right 6`, box 32, glyph 18, lip 3). Saved: `bookmarkOn` in `T.action`.
- Skeleton cover bone radius `coverRadius(cardWidth, 'upright')` (was 18).
- Tests to update: `StoryCard.test.tsx:160` (face is `T.surface`, not
  `mix(T.surface, 0.75, T.bg)`).

### 3.13 `src/components/design/MiniPlayerBar.tsx`
- `LIP = LIP.md`; `usePressSink(LIP)` (`:71` sinks 4 on a 3dp lip); `MINI_PLAYER_HEIGHT =
  60 + LIP` (padding 8, cover 44 radius 12, toggle 44 on lip 2, main gap 12, paddingVertical 8,
  card radius 20); first-frame track width `Math.max(0, windowWidth - 2 * T.screenPadH - 32)`;
  `SurfaceLevelProvider level="surface2"`; testIDs `mini-player-card` and `mini-player-lip`;
  `pressDelay={0}`.

### 3.14 `src/screens/main/MainScaffold.tsx` and the dock
- Tab item paddings 6 / 6, gap 4 (fits the 66dp bar); unfocused tabs tint, the focused pill
  keeps its 2dp sink; a newly focused pill fades and scales in (`DURATION.base`).
- Dock (R11; visibility logic in the player spec): the mini player becomes an absolute
  overlay above the bar (`bottom` = measured bar height), so showing or hiding it never
  resizes the scene; `useBottomChromeInset()` publishes the dock height for list padding and
  the snackbar inset; one visibility decision (a hook used by MainBottomBar) so fade, padding
  and card arrive in one render; dock gap to the bar 4 (`dockOn` `:219` today 2 / 10); fade
  height 24 (`:217`, was 40); show and hide motion from 1.7.

### 3.15 `src/components/design/Skeleton.tsx`, `Snackbar.tsx`, `feedback.tsx`
- Skeleton: one module-level pulse value shared by every `SkeletonPulse` (started on first
  mount, stopped on last unmount), floor 0.7 (was 0.55, `:77`), `renderToHardwareTextureAndroid`
  and `shouldRasterizeIOS` on the pulse view; new bone tone `'text'` (`T.surface2`) for
  lip-less text bones on the canvas; `FadeIn` wrapper (`DURATION.enter`, once, skipped under
  reduced motion) around the first real content of Home, Library, the Keşfet grid, story
  detail and Sesim; skeleton shapes follow the real geometry (shelf header 28 then 12 to the
  covers, playlist bones 34, library count row 40).
- Snackbar: enter and exit motion (1.7), last entry kept for the exit, delete `elevation: 6`
  on the bar (`:159`; the host's `elevation: 12` at `:146` stays), lip 3, radius 16.
- feedback: `CircleButton` lip `size > 48 ? LIP.md : LIP.sm` (`:309` today `size >= 60 ? 4 : 2`);
  `Waveform` idle bars `WAVE_IDLE_ALPHA` (`:95`); `SectionHeader` link tint (`:413`);
  `Spinner` passes a numeric size on Android; `LoadingLine` gets `direction` and replaces the
  four hand-rolled spinner blocks (LegalSheet, VoiceConsent, VoiceRecording, AudioPlayer).

### 3.16 Sheets
- `PasswordResetSheet`: submit md `block`, `returnKeyType="send"`, focus in `onOpened`,
  delete the text "Vazgeç" (`:101-106`), `scrollable`.
- `SocialConsentSheet`: continue md `block`, delete the text cancel (`:51-56`), last `kind`
  ref, `scrollable`.
- `LegalSheet`: `fill`; loading as `SkeletonPulse` with text bones; slug-tagged state; one
  button: "Kapat" secondary md `block` (`:183` lg primary today) and, in the onboarding
  context, "Anladım" primary md block that also ticks consent on Registration; Login and
  Registration pass `context="profile"` unless they tick consent. The document text
  (`LegalMarkdown`) mounts only after the sheet's `onOpened` (LA-6: a long markdown tree mounted
  with the sheet held its first frame 1 to 3 s in debug); until then a ready document also shows
  the bones (its date line is already there), the next fresh open starts with the bones again,
  and "Anladım" accepts only once the text is on screen.
- `TranslationRequestSheet`: toggle minHeight 36, radius 12, lip 2, opaque requested face
  (1.6.1).
- `FilterSheets`: delete the pressed translate (`:87`), tint.
- `ChoiceSheet`, `NarratorSheet`, `StoryOptionsSheet`, `SpeedSheet`: nothing beyond the shared
  container; NarratorSheet keeps its selection live during the exit.

### 3.17 `src/components/audio/TimerSheet.tsx`
- One body height in every state: `TIMER_BODY_HEIGHT = 4 + WHEEL_HEIGHT + 36 + 46 = 266`
  (`<View testID="timer-body" style={{ height: TIMER_BODY_HEIGHT }}>` around `:245-354`). The
  title, the master switch and the segmented control therefore never move (R13: the sheet
  hugs its content from the bottom, and today's bodies are about 100, 266 and 122dp tall).
- Stories mode, top-aligned in the body: stepper row (paddingVertical 12), stop line (paddingTop
  8, paddingBottom 8, `numberOfLines 2`), and when a queue exists a "Sırada" list of at most
  three 20dp lines (`queue.slice(0, storyCount - 1)`).
- Duration mode: the wheel stays mounted, also while the timer runs; the stop line shows the
  deadline; the bottom 46dp row is a horizontal `ScrollView` of `Chip role="button"` quick
  picks while idle and the countdown row while running (Baloo 2 28/38 tabular
  `formatCountdown` + "kaldı" + "+5 dk" sm button). "Süreyi değiştir" and `showWheel` go away.
- Remove `wheelKey`; initialise during render on open (not in an effect after the first
  commit); `Countdown` is its own observer so the sheet does not re-render every second.
- Options while off: an `Animated.View` opacity 1 to 0.38 in `DURATION.fast` with
  `needsOffscreenAlphaCompositing`; tapping a dimmed option turns the timer on (UX, player spec).
- `BottomSheet scrollable` so short screens and font scale 1.3 never clip.

### 3.18 `src/screens/audio/AudioPlayerScreen.tsx`
- Transport: `PLAY_SIZE 80` on `LIP.lg` (was 96 on 5), icon 34, `SKIP_SIZE 56` (RoundButton
  lip `LIP.md` stays), `SIDE_SIZE 40` with `hitSlop { left: 4, right: 4 }`, no-queue gap 24;
  `ROW_WIDTH = SCREEN_W - 2 * SCREEN_PAD_H` (`:103` hard-codes 40); `KNOB_LIP 2`; art lip from
  `coverLip` (4); title `marginTop 16`, options `marginTop 16`. Transport `pressDelay={0}`.
- Option tiles: the 2dp ring always present (`borderColor={tint?.ring ?? 'transparent'}`),
  padH 12, gap 12; value text `fontVariant ['tabular-nums']`, no `adjustsFontSizeToFit`,
  countdown and unit as two Texts (unit only under 100 minutes), shorter tile strings (player
  spec owns the copy).
- Seek knob grab animation (1.7). Delete the `syncNavigationBar` effect (`:472-476`).

### 3.19 `src/screens/home/HomeScreen.tsx`
- Hero: `PLAY_SIZE 56`, lip `LIP.md`, icon 24, bottom gap 8; hero cover lip 4 (from coverLip);
  overlays at 12 on every side (`:607-612`); Tags `maxFontSizeMultiplier 1.3`.
- Shelves: header marginTop 20, header to covers 12; skeleton moves with them.

### 3.20 Voice flow and Sesim
- `src/components/voiceflow/parts.tsx`: `RECORD_SIZE 80`, `RECORD_LIP LIP.lg`, halo padding 6
  with radius `(RECORD_SIZE + 12) / 2`, mic 32, stop 26; `FlowAvatar` default 72, halo 12,
  lip `LIP.lg`; `FlowDock` `paddingTop 8`, `paddingBottom dockBottom(insets.bottom)`.
- `VoiceRecordingScreen.tsx`: panel `SurfaceLevelProvider level="surface"`; script card padding
  16; hint `numberOfLines 2` with a two-line minHeight (no jitter); upload shown as a progress
  bar in a fixed slot (voice spec owns the flow).
- `src/components/voice/VoiceCards.tsx` `CardAction`: metrics from `BUTTON_METRICS.md`
  (44, lip 2, radius 16), padH 8 (deliberate: "Yeni ses kaydet" must fit 360dp), actions gap 8;
  ghost face opaque `ghostFace(T, T.ownB)`; own hero card lip `LIP.lg`; row lip `LIP.md`.

### 3.21 Profile
- `PalettePicker.tsx`: optimistic ring (2.4); swatch radius 16, face padding 8 with an
  always-present 2dp ring (transparent idle), preview 44 tall (radius 12, padding 4), name row
  `marginTop 4`, grid gap 8; selected check as an 18dp `T.action` badge at 4/4 inside the
  preview (not in the name row); name `numberOfLines 1`, `adjustsFontSizeToFit`,
  `minimumFontScale 0.85`, `maxFontSizeMultiplier 1.3`; en `palette.names.gece-mavisi`
  "Night blue"; hint tr "Seçimin bu cihazda saklanır." en "Your choice is kept on this device."
  `ProfileScreen` `paletteBlock` paddingTop 0, paddingBottom 16. Each swatch goes from 100 to
  84dp.
- `SettingRow.tsx`: `ROW_PAD_H 12`, `LABEL_MIN_WIDTH 72`, minHeight 56, tint; the two language
  rows then fit one line at 360dp with the compact segments (padH 8).
- Push-permission block: provider `'surface2'`; its action primary sm.
- Prefs skeleton minHeight equals the real row (56).

### 3.22 Auth, onboarding and docks
- `LoginScreen`, `RegistrationScreen`: keyboard (2.3); submit lg; Google and Apple md block;
  form rhythm (1.1); busy state on the pressed button only (`loading`, full colour), the others
  disabled (splash-loading r10-15); consent row: only the checkbox and its own pressable text
  toggle, links are separate pressables.
- `OnboardingScreen`: top row `minHeight 48`; footer `paddingBottom dockBottom(insets.bottom)`,
  second slot `minHeight 48`, `marginTop 4`; page paddingTop 8; next button lg.
- `StoryDetailScreen` dock: sample face 52 x 52, radius 20, lip `LIP.md`; CTA lg `singleLine`
  with style `{ flex: 1, alignSelf: 'center' }`; dock sized by content: `paddingTop 8`,
  `paddingBottom dockBottom(insets.bottom)` (no fixed `DOCK_HEIGHT 86`); scroll padding
  `63 + dockBottom(insets.bottom) + 24`.
- `AudioGenerationScreen`, `ProcessingScreen`: background and regenerate actions secondary md
  block (`AudioGenerationScreen.tsx:275-283,368-377`, `ProcessingScreen.tsx:204-213,254-262`);
  where a primary exists it is the top button of the same dock; dock paddingTop 8.
- `SubscriptionScreen`: period cards lip 3, radius 20, paddingVertical 6; dock rule.
- `DataDeletionScreen`: confirm lg (danger); scroll end `insets.bottom + 24`.

### 3.23 Navigation
- `RootNavigator.tsx`: export `SCREEN_ANIMATION: Record<keyof RootStackParamList, StackAnimationTypes>`
  (1.7) and read it in each `Stack.Screen`; `ROOT_SCREEN_OPTIONS` (2.4); `withScreenPalette`;
  `withDialogOutlet` on the `presentation: 'modal'` group.

---

## 4. Call-site size table

| Size | Where |
|---|---|
| **lg 52 / lip 3** (one per screen, the bottom CTA or form submit) | `OnboardingScreen.tsx:264`, `LoginScreen.tsx:164`, `RegistrationScreen.tsx:254`, `StoryDetailScreen.tsx:805` (dock CTA), `SubscriptionScreen.tsx:266`, `CreateVoiceProfileScreen.tsx:236`, `VoiceConsentScreen.tsx:206`, `VoiceSuccessScreen.tsx:206`, `DataDeletionScreen.tsx:158` |
| **md 44 / lip 2, block** (sheets, dialogs, secondary dock actions) | `PasswordResetSheet.tsx:95`, `SocialConsentSheet.tsx:44`, `LegalSheet.tsx:174`, `LegalSheet.tsx:183` (secondary), `AudioGenerationScreen.tsx:280`, `AudioGenerationScreen.tsx:373`, `ProcessingScreen.tsx:209`, `ProcessingScreen.tsx:259` (all secondary), every `Dialog` action, Google and Apple sign-in |
| **md 44, content width** | `StateView` actions, Profile sign out, `StoryDetailScreen` no-narrator "Kendi sesini ekle" (primary: it is the card's one action while the dock CTA is disabled) |
| **sm 36 / lip 2** | `LegalSheet.tsx:152` (retry), `TimerSheet.tsx:329` ("+5 dk"), `PlanUsageCard.tsx:99`, `VoiceCards.tsx:241`, `ProfileScreen.tsx:469` (permission, primary), `DataDeletionScreen.tsx:175`, `StoryDetailScreen.tsx:763`, `SubscriptionScreen.tsx:259,274` |
| **text** | quiet alternatives ("Hazır anlatıcıyla başla", "goBack", sheet header actions such as "Düzenle") |
| Card actions (`CardAction`) | md metrics, padH 8 |

`StoryDetailScreen.tsx:676` is a `TranslationBadge size="lg"`, not a Button (unchanged).
After the change no Button uses 58, and the only 52dp buttons are the rows marked lg.

---

## 5. Tests

### 5.1 `src/theme/contrastRules.test.ts` (new, exact text)

Verified in a scratch jest (`scratchpad/dspec/jest.config.js`): **66 of 66 pass** on the
final palettes, **32 of 66 fail** on the shipped ones (ladder in all six, faces in all six,
lips in all six, glass and tinted labels in kitaplik, gece-mavisi and erik, meaning in orman,
gece-mavisi and orijinal).

```ts
/**
 * Contrast contract of the six palettes (docs/release-pass/SPEC-design.md 1.6).
 * theme.test.tsx checks text levels; this file checks what the components draw on top of
 * each other, so no palette can make a button, a field, a lip, a thumb or a badge vanish.
 */
import { CATEGORY_KEYS, PALETTE_KEYS, palettes } from './palettes';
import { contrastRatio, flatten, lightness as L, mix, oklabDistance, withAlpha } from './color';
import {
  SurfaceLevel, WAVE_IDLE_ALPHA, disabledFace, ghostFace, glassRing, insetFace, raisedFace,
} from './surfaces';
import { buttonColors } from '../components/design/buttonColors';
import { themes } from './theme';

const STEP = 6;
const LEVELS: SurfaceLevel[] = ['bg', 'surface', 'surface2'];
const ratio = contrastRatio;

describe.each(PALETTE_KEYS)('contrast contract: %s', key => {
  const P = palettes[key];

  it('the neutral ladder has a visible step between every level', () => {
    expect(L(P.bg) - L(P.bar)).toBeGreaterThan(1);
    expect(L(P.barLine) - L(P.bar)).toBeGreaterThanOrEqual(STEP);
    expect(L(P.surface) - L(P.bg)).toBeGreaterThanOrEqual(STEP);
    expect(L(P.surface2) - L(P.surface)).toBeGreaterThanOrEqual(STEP);
    expect(L(P.line) - L(P.surface2)).toBeGreaterThanOrEqual(STEP);
  });

  it.each(LEVELS)('neutral faces stand off a %s container', level => {
    const parent = P[level];
    expect(Math.abs(L(raisedFace(P, level)) - L(parent))).toBeGreaterThanOrEqual(STEP);
    expect(Math.abs(L(insetFace(P, level)) - L(parent))).toBeGreaterThanOrEqual(STEP);
    expect(Math.abs(L(disabledFace(P, level)) - L(parent))).toBeGreaterThanOrEqual(STEP);
    expect(ratio(P.text, raisedFace(P, level))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text3, disabledFace(P, level))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text2, insetFace(P, level))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text3, insetFace(P, level))).toBeGreaterThanOrEqual(4.5);
    for (const ringColor of [P.text2, P.error]) {
      expect(ratio(ringColor, insetFace(P, level))).toBeGreaterThanOrEqual(3);
      expect(ratio(ringColor, parent)).toBeGreaterThanOrEqual(3);
    }
    // The component mapping really uses the ladder.
    const T = themes[key];
    expect(buttonColors(T, 'secondary', 'default', level).background).toBe(raisedFace(P, level));
    expect(buttonColors(T, 'primary', 'default', level, { disabled: true }).background).toBe(disabledFace(P, level));
  });

  it('every text level reads on every neutral level', () => {
    for (const fg of [P.text, P.text2, P.text3]) {
      for (const bg of [P.bg, P.bar, P.surface, P.surface2]) expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(ratio(P.text, P.line)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text2, P.line)).toBeGreaterThanOrEqual(4.5);
  });

  it('filled controls stand out on every container (WCAG 1.4.11)', () => {
    for (const parent of [P.bg, P.bar, P.surface, P.surface2, P.line]) {
      expect(ratio(P.action, parent)).toBeGreaterThanOrEqual(3);
    }
    expect(ratio(P.error, P.surface)).toBeGreaterThanOrEqual(3);
    expect(ratio(P.error, P.surface2)).toBeGreaterThanOrEqual(3);
    expect(ratio(P.rec, P.bg)).toBeGreaterThanOrEqual(3);
    expect(ratio(P.onAction, P.action)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.onAction, P.error)).toBeGreaterThanOrEqual(4.5);
    for (const slot of CATEGORY_KEYS) {
      const tile = P.cat[slot];
      if (tile.tileBg === P.surface) continue;
      expect(ratio(tile.tileBg, P.bg)).toBeGreaterThanOrEqual(3);
      expect(ratio(tile.tileFg, tile.tileBg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('state marks are visible: switch thumbs, checkbox, waveform', () => {
    expect(ratio(P.text3, P.line)).toBeGreaterThanOrEqual(3);
    expect(ratio(P.onAction, P.action)).toBeGreaterThanOrEqual(3);
    for (const parent of [P.bg, P.surface, P.surface2]) expect(ratio(P.text3, parent)).toBeGreaterThanOrEqual(3);
    const wave = flatten(withAlpha(P.text, WAVE_IDLE_ALPHA), P.surface);
    expect(ratio(wave, P.surface)).toBeGreaterThanOrEqual(3);
  });

  it('glass, ghost and tinted faces are opaque and keep their labels', () => {
    const ring = glassRing(P);
    expect(ring).toMatch(/^#[0-9A-F]{6}$/);
    expect(ratio(ring, P.bg)).toBeGreaterThanOrEqual(2.5);
    const ghost = ghostFace(P, P.ownB);
    expect(ghost).toMatch(/^#[0-9A-F]{6}$/);
    expect(ratio(P.text, ghost)).toBeGreaterThanOrEqual(4.5);
    const requested = mix(P.success, key === 'orijinal' ? 0.18 : 0.12, P.surface2);
    expect(ratio(P.chipOkFg, requested)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.error, flatten(withAlpha(P.error, 0.16), P.ownC))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.warning, flatten(withAlpha(P.warning, 0.14), P.surface))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text2, flatten(withAlpha(P.text, 0.08), P.surface))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.chipActFg, flatten(P.chipActBg, P.bg))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.chipOkFg, flatten(P.chipOkBg, P.ownA))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(P.text, flatten(P.glass, '#FFFFFF'))).toBeGreaterThanOrEqual(4.5);
  });

  it('lips read as shadow and never as a lighter band', () => {
    const coloured: [string, string][] = [
      [P.action, P.actionLip], [P.own, P.ownLip], [P.line, P.lineLip],
      ...CATEGORY_KEYS.map(slot => [P.cat[slot].color, P.cat[slot].lip] as [string, string]),
    ];
    for (const [face, lip] of coloured) expect(L(face) - L(lip)).toBeGreaterThanOrEqual(15);
    expect(L(P.surface) - L(P.lip)).toBeGreaterThanOrEqual(8);
    expect(L(P.bg) - L(P.lip)).toBeGreaterThanOrEqual(3.5);
    expect(L(P.bg) - L(P.lineLip)).toBeGreaterThanOrEqual(1.9);
    expect(L(P.surface) - L(P.lineLip)).toBeGreaterThanOrEqual(6);
    const dangerLip = buttonColors(themes[key], 'primary', 'danger').lip;
    expect(L(P.error) - L(dangerLip)).toBeGreaterThanOrEqual(15);
  });

  it('error and warning never read as the action colour', () => {
    expect(oklabDistance(P.error, P.action)).toBeGreaterThanOrEqual(7);
    expect(oklabDistance(P.warning, P.action)).toBeGreaterThanOrEqual(6.5);
    expect(oklabDistance(P.warning, P.error)).toBeGreaterThanOrEqual(6.5);
  });

  it('a sheet stands off the scrim behind it', () => {
    expect(L(P.surface) - L(flatten(P.scrim, P.bg))).toBeGreaterThanOrEqual(STEP);
  });
});
```

(The scratch run inlined `dangerLip = mix(P.error, 0.62, P.lip)` and skipped the two
`buttonColors` lines, because the scratch had no component tree; in the repo they read the
real mapping.)

### 5.2 Component tests (`src/components/design/components.test.tsx` unless noted)

Timing tests use the `Animated.timing` / `Animated.spring` spy pattern of
`library.test.tsx:405-420`, not fake timers alone. Use `jest.spyOn(safeArea, 'useSafeAreaInsets')`
for insets (setup.ts restores spies).
- Button: `it.each(['sm','md','lg'])` face minHeight 36/44/52, radius 12/16/20, lip top 2/2/3,
  hitSlop 5/1/none; `loading` keeps the face minHeight and the label at opacity 0 under an
  absolute spinner; disabled face `disabledFace(level)`, label `text3`, outer opacity 1,
  `accessibilityState.disabled`; secondary inside `BottomSheet`, `Dialog`, `Card`, `SheetRow`
  equals `raisedFace` of that level and never the container colour, looped over `PALETTE_KEYS`;
  ghost face is a hex; text button: pressIn starts a timing to 0.6 on opacity, no translateY.
- Lip equals sink: Tactile, CoverCard (`coverLip`), MiniPlayerBar (`mini-player-card` transform
  equals `mini-player-lip` top, 3), LibraryRowCard, VoiceCards row.
- Faceless targets never translate: pressIn on SwitchRow, ListRow plain, IconButton plain,
  text Button, SettingRow, an unfocused tab, a segment.
- Tactile: `unstable_pressDelay` 100 by default and 0 with `pressDelay={0}`; a disabled dimmed
  Tactile has `needsOffscreenAlphaCompositing`.
- SegmentedControl: after a layout of width 320, pressing segment 2 starts `Animated.spring`
  with `toValue 1` and `useNativeDriver: true`; each segment has two label layers with
  interpolated opacity; before layout the pill is inside the selected segment; well is
  `T.surface` on bg and `T.bg` in a Card and a BottomSheet; compact face padH 8; reduced motion
  runs no spring; `onChange` fires after `jest.runOnlyPendingTimers()` (rAF), the pill moves
  before.
- Switch: re-render with `value` true runs a timing to 1, duration `DURATION.base`, native;
  thumb on-layer is `T.onAction`; reduced motion resolves `translateX` to 22 with no timing.
- Checkbox: idle 2dp `text3` ring and transparent face; checked `action`; same width and height.
- TextField: ring transparent at rest, `text2` on focus, `error` with an error; face
  `insetFace` (bg inside a BottomSheet); `underlineColorAndroid` transparent; a ref focuses.
- IconButton: tactile face `raisedFace`, lip 2; glass face `T.surface` with 1dp `glassRing`;
  badge 28, radius 14, no `-lip`.
- StoryCard (`StoryCard.test.tsx`): save overlay top 4, right 4, width 28; reachable by role
  and label and not inside the open button; pressIn on the card moves the overlay wrapper by 3.
- PictureCover: level and duration at 6/6, radius 11, `minHeight 22`; `coverLip(98)` 3,
  `coverLip(144)` 4, `coverLip(320)` 4; `coverRadius` unit values.
- BottomSheet: Modal `animationType 'none'`, transparent, statusBarTranslucent; insets 48 / 24 /
  0 give paddingBottom 56 / 32 / 20; `requestClose` and the handle call `onClose`, nothing while
  closing; with `withTiming` held, content stays mounted after `visible` false until the
  callback, then `onClosed` fires once; visible false then true during the held exit keeps it
  mounted and calls `withTiming(1)`; `fireGestureHandler(getByGestureTestId('sheet-drag'))`
  with translationY 200 / velocityY 1200 closes, translationY 40 does not;
  `shouldDismissSheet(139,0,600)` false, `(141,0,600)` true, `(10,1001,600)` true,
  `(91,0,300)` true; frozen title while hidden; system-bars view on Android only; `fill` gives
  `height '88%'` in loading, error and success; `scrollable` wraps children in a ScrollView.
- Dialog (`Dialog.test.tsx`): Modal `animationType 'none'`; held exit keeps the card; a scrim
  press while closing does not call `onDismiss` again; `requestClose` calls `onDismiss` by
  default and not with `dismissOnScrim false`; a button whose `onPress` calls
  `showDialog({ title: 'Ikinci' })` leaves "Ikinci" visible (rename the test at `:116` to
  "closes and runs the button"); disabled action; children slot.
- useDialog: a dialog shown while an outlet is mounted renders inside it; nested outlets pick
  the last; a dialog shown while a sheet is closing renders nothing until its `onClosed`.
- TimerSheet (`TimerSheet.test.tsx`): `timer-body` height equals `TIMER_BODY_HEIGHT` in stories
  mode, idle wheel, running wheel and after a stepper tap with a 60-character title; chips row is
  a horizontal ScrollView of height 46 even when empty; stop line `numberOfLines 2`; 5 s of a
  running timer adds 0 MinuteWheel renders.
- MinuteWheel: `contentOffset` prop is the same object after a scroll that changes the minute;
  one `minute-wheel-unit`; rows carry interpolated scale.
- Stepper: value Text `fontVariant ['tabular-nums']`, box minWidth 44.
- Skeleton: pulse view has `renderToHardwareTextureAndroid`; loop low value 0.7; two pulses
  share one value and one started loop; `FadeIn` runs one timing of `DURATION.enter`.
- Snackbar: bar has no `elevation`; after dismiss it stays 160 ms then unmounts.
- PalettePicker (`profile.test.tsx`): pressing Kitaplık selects it before `setPalette` runs
  (mocked), and three quick presses call `setPalette` once with the last key; check badge
  inside the preview; name props; face padding 8 in both states with a 2dp ring.
- ThemeProvider (`ThemeProvider.test.tsx`): a "switch cost" describe with real navigation: a
  screen below with 50 `useT` probes gets +0 renders at the tap and +50 after
  `SETTLE_DELAY_MS`; three picks in the window settle once; back before the settle shows the
  new palette at once; an inactive visited tab gets +0 at the tap; a probe outside every
  boundary follows a switch live; `:115-124` and `theme.test.tsx:249-260` keep passing; on
  Android 10+ (Platform.Version 31) `changeNavigationBarColor` is never called, on 28 exactly
  once per committed palette.
- MainScaffold / RootNavigator: `MAIN_TAB_SCREEN_OPTIONS.freezeOnBlur` and
  `ROOT_SCREEN_OPTIONS.freezeOnBlur` true; every screen's animation equals
  `SCREEN_ANIMATION[name]`, default `ios_from_right`, Main `fade`; `main-bottom-chrome` in-flow
  height is the same with and without the mini player.
- Auth (`AuthScreens.test.tsx`, `AuthSheets.test.tsx`): `submitEditing` chains and submits;
  login-submit face 52, Google face 44; the reset and social sheets have no "Vazgeç".

### 5.3 Existing assertions to update in the same changes
`theme.test.tsx:36-60` (gece literals), `:189` (error rule), `:223` (`screenPadH` 16);
`components.test.tsx:131` (ghost hex), `:168-171` (hitSlop); `StoryCard.test.tsx:160`;
`AudioPlayerScreen.test.tsx:352` (play lip 4), `:646-651` (skip 56, gap 24, play 80);
`HomeScreen.test.tsx:192-193` (56 / 28, lip 3); `StoryDetailScreen.test.tsx:570-574` (52);
`voiceflow.test.tsx:249-254` (80 / 40, lip 4); `voice.test.tsx:453, 576-577, 587`;
`detail.test.tsx:191-192`; `library.test.tsx:386`; `NotificationsScreen.test.tsx:290, 318-319`;
`MyLibraryScreen.test.tsx:452`; `profile.test.tsx:253-255`; `ThemeProvider.test.tsx:154-165`
(exactly one call, last call `bar`, or none on Android 10+); `AudioPlayerScreen.test.tsx:51-52`
(stale comment).

### 5.4 Source scans (`src/theme/designScan.test.ts`, node fs, like `fonts.test.ts`)
Over every non-test `.tsx` in `src/components`, `src/screens`, `src/navigation`:
- `margin*`, `padding*`, `gap`, `rowGap`, `columnGap`, `top/left/right/bottom` literals (absolute
  value) in `{0, 2, 4, 6, 8, 12, 16, 20, 24, 32}` or on a line marked `// geometry`
  (put it on true geometry: the switch thumb inset, wheel padding, cover math).
- `borderRadius` / `radius` literals in `{0, 6, 12, 16, 20, 24, 28, 32, 999}` or an expression
  (`size / 2`) or `// geometry`.
- no `lip={<digit>` and no `lipSize.xl`.
- no numeric `duration:` outside `src/theme/motion.ts`, no `useNativeDriver: false`, no
  `LayoutAnimation`, no `useMemo(() => make\w*(T)` (cached styles), no `translateY: pressed`.
- no `<Modal` outside `ModalWindow.tsx`, no `KeyboardAvoidingView` import from `react-native`.

### 5.5 `src/theme/motion.test.ts`
`pressIn < pressOut <= fast < base < enter`, `exit < enter`, `sheetExit < sheetEnter`;
`SPRING_SNAPPY` damping ratio between 0.6 and 0.85, `SPRING_SHEET` at least 0.85.

### 5.6 `src/theme/nativeConfig.test.ts` (guards hand-edited native files against a prebuild)
`MainApplication.kt` contains `setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)`;
`MainActivity.kt` contains `isNavigationBarContrastEnforced = false`; both `colors.xml` define
`window_background` and `splashscreen_background` equal to
`palettes[DEFAULT_PALETTE].bg`; `styles.xml` AppTheme parent is
`Theme.AppCompat.DayNight.NoActionBar`; `Info.plist` has `UIUserInterfaceStyle` `Dark`;
`app.config.js` has `userInterfaceStyle: "dark"`; `modules/sesly-system-bars/expo-module.config.json`
lists only android. Plus a ModalWindow test: with `Platform.OS` android the
`modal-system-bars` view renders, on ios it does not (mock the module in
`src/test-utils/mocks/native-modules.ts`).

### 5.7 Jest mocks (`src/test-utils/mocks/native-modules.ts`, `setup.ts`)
`Reanimated.useReducedMotion = () => false`; `jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'))`
(has `scheduleOnRN`); replace the hand-written gesture-handler mock (`:206-216`) with
`require('react-native-gesture-handler/jestSetup')` and run the full suite once;
keyboard-controller mock (2.3); sesly-system-bars mock returning `View`.

---

## 6. Native and dependency changes (one rebuild)

| Change | Files | Rebuild |
|---|---|---|
| Add react-native-keyboard-controller 1.20.7 (`npx expo install react-native-keyboard-controller`) | package.json, lockfile, iOS Podfile.lock | Android + iOS (`pod install`) |
| New local module `modules/sesly-system-bars` (Kotlin view) | `modules/sesly-system-bars/**` | Android |
| Night mode pin | `android/app/src/main/java/com/sesly/MainApplication.kt` | Android |
| Activity bars (transparent, contrast off, dark icons) | `android/app/src/main/java/com/sesly/MainActivity.kt` | Android |
| AppTheme DayNight parent, control colours | `android/app/src/main/res/values/styles.xml` | Android |
| `window_background`, `splashscreen_background` #121A29 | `res/values/colors.xml`, `res/values-night/colors.xml` | Android |
| `UIUserInterfaceStyle` Dark | `ios/Sesly/Info.plist` | iOS |
| `userInterfaceStyle` dark, splash and adaptive icon background | `app.config.js` | config only (keeps it in sync; no prebuild) |

Never run `expo prebuild`. Reanimated 4.2.1 and Worklets 0.7.4 stay (now used).
`react-native-navigation-bar-color` stays for Android 7 to 9 only. The main checkout
(`E:\Coding\sesly-base\sesly-mobile`) runs Metro for the visual audit: native changes reach
it only after this branch is merged and the dev client is rebuilt there.

Backend: nothing in this spec needs the backend.

---

## 7. Order of work

1. Tokens and scans: `theme.ts` (scale, radius, lips, gutter 16, `dockBottom`, `lipFor`),
   `motion.ts`, `designScan.test.ts` and `motion.test.ts` (scan initially as a report, made
   strict at the end of step 7).
2. Colour: `palettes.ts` values, `surfaces.ts`, `color.ts` helpers, `SurfaceLevel`,
   `buttonColors`, contrast contract; Button, IconButton, TextField, Segmented well, Checkbox,
   Switch thumb, glass, ghost, requested toggle.
3. Controls and press rules: Tactile (`pressDelay`, tint, dimming), Button metrics and loading,
   faceless sinks removed, SegmentedControl, Switch, Checkbox, Stepper, SteppedSlider,
   MinuteWheel, Chip, Tag, SearchField.
4. Sheets and dialogs: ModalWindow, presence, BottomSheet, Dialog, outlets, consumer fixes,
   TimerSheet body, LegalSheet `fill`.
5. Native batch (section 6) and keyboard-controller adoption (auth, CreateVoiceProfile,
   sheets, dialogs). One Android rebuild, one `pod install`.
6. Palette switch: two contexts, boundary, freeze, optimistic picker, cached styles, bar calls.
7. Spacing and size sweep per file (call-site table, insets, docks, covers, player, hero,
   voice flow, profile, auth, onboarding); scan made strict.
8. Motion polish: snackbar, dock, skeleton, FadeIn, tab pill, transitions map, seek knob,
   now-playing bars.

Each step ends with `npx tsc --noEmit` and `npm test` green.

---

## 8. Owner-visible changes, device checks, open items

Owner-visible:
- Cards, fields and buttons stand out more in gece-mavisi (the default), mürekkep and erik;
  idle chips sit on a darker lip; gece-mavisi's error colour is pinker; orman and orijinal
  warnings turn orange.
- Buttons are smaller: bottom CTAs 52dp (were 58), normal 44 (48), small 36 (40); lips 2 to 4,
  never 5; player play 80 (96), record 80 (88).
- Side margins 16dp (20); story grid cards a little larger.
- The bookmark is a 28dp disc in the cover corner and sinks with the card.
- Sheets: the dim fades while the sheet slides; drag down on the handle to close. Dialogs fade
  and grow slightly.
- Nothing bobs: segment labels and switch rows stay still; the segment pill slides; switches
  slide; the sleep-timer sheet never changes height; "Süreyi değiştir" is gone (the wheel
  stays with the countdown under it).
- Disabled buttons look grey, not faded salmon. Focused fields get a light grey ring.
- Android back no longer closes dialogs that must be answered.
- The navigation bar stays dark and seamless everywhere, also under sheets and in 3-button
  mode; system popups (text selection, autofill) are dark.
- Keyboard: the focused field stays above the keyboard; no gap remains after it closes.
- Palette pick is instant; screens behind catch up a moment later. English name "Night blue".
- Screen pushes take 200 ms; state changes (after splash, login, onboarding) fade.
- Legal sheet opens at full height with one close button.

Device checks (cannot be done in jest): Redmi 8 (Android 10, MIUI) and an Android 15 phone in
3-button and gesture navigation: cold start, a sheet, the nested LegalSheet in Profile, a
dialog over a sheet, background then resume with a sheet open (no one-frame flash), the reset
sheet with the keyboard open at font scale 1.3; iPhone: the slot-limit dialog from the narrator
sheet, a recording error dialog, then sign out (a later dialog still shows); palette switch on
a release build (ring within one frame, nothing stutters).

Open items (defaults decided, owner may override):
- The ladder lift departs slightly from the approved mockup colours. Default: ship it (it is
  what makes R5 pass). 
- keyboard-controller is a new native dependency. Default: adopt (Expo-pinned version,
  removes a class of edge-to-edge keyboard bugs, rebuild is needed anyway for R3).
- Timer sheet in stories mode with nothing queued shows unused space under the stop line
  (the price of a fixed header). Default: accept.
