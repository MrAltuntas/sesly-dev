/**
 * Sesly design components (design/v4/playful).
 *
 *   Tactile (the lip and the press sink every tappable surface uses),
 *   Button, IconButton, Chip, Tag, SegmentedControl, Switch, SwitchRow,
 *   Checkbox, Card, CategoryTile, CategoryDot, ListRow, TopAppBar, Avatar,
 *   TextField, SearchField, StateView, StateIcon, BottomSheet, Dialog, SnackbarHost +
 *   snackbar, PictureCover, CoverCard, CoverMeta, useCoverSpread,
 *   LanguageCodes, TranslationBadge, MiniPlayerBar, Waveform, ProgressBar,
 *   Spinner, CircleButton, SectionLabel, SectionHeader, Icon, SeslyMark,
 *   SkeletonPulse, FadeIn, Bone, RowSkeleton, ShelfSkeleton, LoadingLine.
 *
 * Every component reads its colours through `useT()`, so a palette switch
 * recolours it.
 */

export { Icon, GoogleMark, AppleMark, ICON_NAMES, ICON_SIZE, ICON_SIZE_INLINE, iconGlyph } from './Icon';
export type { IconName } from './Icon';
export { Tactile, usePressSink, usePressTint } from './Tactile';
export type { TactileProps, PressTint } from './Tactile';
export { Button, buttonColors, BUTTON_METRICS, buttonHitSlop } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize, ButtonTone, ButtonColors, ButtonMetrics } from './Button';
export { SurfaceLevelProvider, useSurfaceLevel } from './SurfaceLevel';
export type { SurfaceLevel, SurfaceLevelProviderProps } from './SurfaceLevel';
export { Chip, Tag, tagColors, SegmentedControl, Switch, SwitchRow, Checkbox } from './controls';
export type {
  Segment,
  TagTone,
  ChipProps,
  TagProps,
  SegmentedControlProps,
  SwitchProps,
  SwitchRowProps,
  CheckboxProps,
} from './controls';
export { Card, CategoryTile, CategoryDot, categoryIcon } from './cards';
export type { CardProps, CategoryTileProps } from './cards';
export {
  Avatar,
  IconButton,
  TopAppBar,
  ListRow,
  FieldFrame,
  fieldRingColor,
  TextField,
  StateView,
  StateIcon,
  ICON_BADGE_SIZE,
  useScrollEdge,
  avatarLip,
  avatarRadius,
} from './rows';
export type {
  IconButtonProps,
  IconButtonVariant,
  FieldFrameProps,
  ListRowProps,
  ScrollEdge,
  TextFieldProps,
} from './rows';
export { SearchField } from './SearchField';
export type { SearchFieldProps } from './SearchField';
export { BottomSheet, shouldDismissSheet } from './BottomSheet';
export type { BottomSheetProps } from './BottomSheet';
export { ModalWindow } from './ModalWindow';
export { DialogOutlet, withDialogOutlet } from './DialogOutlet';
export {
  Waveform,
  waveformBars,
  ProgressBar,
  AnimatedFill,
  Spinner,
  CircleButton,
  SectionLabel,
  SectionHeader,
} from './feedback';
export type { CircleButtonProps, ProgressBarProps, WaveformProps, SectionHeaderProps } from './feedback';
export { SnackbarHost, snackbar } from './Snackbar';
export type { SnackbarOptions, SnackbarTone } from './Snackbar';
export {
  SkeletonPulse,
  FadeIn,
  Bone,
  boneColor,
  TextBones,
  RowSkeleton,
  ShelfSkeleton,
  LoadingLine,
  SKELETON_PULSE_FLOOR,
} from './Skeleton';
export type { BoneTone, FadeInProps, LoadingLineProps } from './Skeleton';
export { PictureCover, CoverCard, CoverMeta, useCoverSpread, coverRadius, coverLip } from './PictureCover';
export type { CoverCardProps, PictureCoverProps } from './PictureCover';
export {
  resolveCover,
  pickPlaceholderIndex,
  coverSeedKey,
  stableHash,
  assignSpread,
  resetCoverAssignments,
  COVER_PLACEHOLDERS,
} from './covers';
export type { CoverSubject } from './covers';
export { LanguageCodes, TranslationBadge, orderLanguageCodes, MarkLabelProvider, useMarkLabels } from './storyMarks';
export type { MarkLabelSink } from './storyMarks';
export { MiniPlayerBar, MINI_PLAYER_HEIGHT, remainingMinutes, playedFraction } from './MiniPlayerBar';
export { Dialog, OptionsDialog, orderDialogButtons } from './Dialog';
export type { DialogOptions, DialogButton, DialogAction, DialogProps } from './Dialog';
export { SeslyMark } from './SeslyMark';
export { useT } from '../../theme/theme';
