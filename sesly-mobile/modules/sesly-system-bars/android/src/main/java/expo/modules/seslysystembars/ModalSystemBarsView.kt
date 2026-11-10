package expo.modules.seslysystembars

import android.content.Context
import android.graphics.Color
import android.os.Build
import android.view.ViewTreeObserver
import android.view.Window
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.bridge.ReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.views.modal.ReactModalHostView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Keeps the navigation bar of the Modal window it sits in transparent, with
 * no contrast scrim and light buttons.
 *
 * Every React Native Modal is its own Android window. With edge-to-edge on,
 * `ReactModalHostView.updateProperties` runs `Window.enableEdgeToEdge()` on
 * it, which forces `isNavigationBarContrastEnforced = true` and picks the
 * button colour from the configuration's night flag; no JS prop turns that
 * off, and it runs again on resume and on every Modal prop update. So this
 * view finds the Modal's dialog window once it is attached and re-asserts
 * the three values before every frame, writing only when one was changed.
 */
class ModalSystemBarsView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private var window: Window? = null
  private var controller: WindowInsetsControllerCompat? = null
  private var observer: ViewTreeObserver? = null

  private val preDrawListener = ViewTreeObserver.OnPreDrawListener {
    apply()
    true
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    // This runs in the dialog window's first traversal, before its first
    // draw, so attaching now means no frame shows the contrast scrim. A host
    // that cannot be resolved yet gets two more tries on the next loops.
    if (!attach()) post { if (!attach()) post { attach() } }
  }

  override fun onDetachedFromWindow() {
    detach()
    super.onDetachedFromWindow()
  }

  /** Resolves the Modal's window and starts watching it. False when it cannot be found yet. */
  private fun attach(): Boolean {
    if (!isAttachedToWindow) return true
    if (window != null) return true
    val dialogWindow = findModalWindow() ?: return false
    window = dialogWindow
    controller = WindowInsetsControllerCompat(dialogWindow, dialogWindow.decorView)
    apply()
    observer = dialogWindow.decorView.viewTreeObserver.also {
      it.addOnPreDrawListener(preDrawListener)
    }
    return true
  }

  private fun detach() {
    val watched = observer
    if (watched != null && watched.isAlive) {
      watched.removeOnPreDrawListener(preDrawListener)
    } else {
      window?.decorView?.viewTreeObserver?.removeOnPreDrawListener(preDrawListener)
    }
    observer = null
    controller = null
    window = null
  }

  /**
   * The first `DialogRootViewGroup` up the parent chain carries the Modal's
   * react tag (ReactModalHostView forwards its id), which resolves the host
   * view and so its public `dialog`.
   */
  private fun findModalWindow(): Window? {
    var node = parent
    while (node != null && node !is ReactModalHostView.DialogRootViewGroup) {
      node = node.parent
    }
    val root = node as? ReactModalHostView.DialogRootViewGroup ?: return null
    if (root.id == NO_ID) return null
    val reactContext = (context as? ReactContext) ?: (appContext.reactContext as? ReactContext) ?: return null
    // Only the bar colour depends on this view: a lookup that fails (a
    // surface being torn down) leaves the bar as React Native set it.
    val host = runCatching {
      UIManagerHelper.getUIManagerForReactTag(reactContext, root.id)?.resolveView(root.id)
    }.getOrNull() as? ReactModalHostView
    return host?.dialog?.window
  }

  // navigationBarColor is deprecated on API 35, where the bar is always
  // transparent; older versions still read it.
  @Suppress("DEPRECATION")
  private fun apply() {
    val w = window ?: return
    val ctrl = controller ?: return
    if (w.navigationBarColor != Color.TRANSPARENT) {
      w.navigationBarColor = Color.TRANSPARENT
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && w.isNavigationBarContrastEnforced) {
      w.isNavigationBarContrastEnforced = false
    }
    if (ctrl.isAppearanceLightNavigationBars) {
      ctrl.isAppearanceLightNavigationBars = false
    }
  }
}
