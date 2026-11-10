package expo.modules.seslysystembars

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * SeslySystemBars: one zero-size view (`ModalSystemBarsView`) that a Modal
 * mounts as its first child. It keeps the navigation bar of that Modal's own
 * window transparent, without the contrast scrim and with light buttons, the
 * way the activity window already is (MainActivity). Android only; the JS side
 * (`modules/sesly-system-bars/index.ts`) never asks for it on iOS.
 */
class SeslySystemBarsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SeslySystemBars")

    View(ModalSystemBarsView::class) {}
  }
}
