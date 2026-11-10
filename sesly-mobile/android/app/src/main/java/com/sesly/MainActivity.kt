package com.sesly

import android.graphics.Color
import android.os.Build
import android.os.Bundle

import androidx.core.content.ContextCompat
import androidx.core.view.WindowInsetsControllerCompat

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper
import expo.modules.splashscreen.SplashScreenManager

class MainActivity : ReactActivity() {
  // Window.navigationBarColor is deprecated (ignored from Android 15 at targetSdk 35+) but
  // still paints the bar on older releases, so it is set below on purpose.
  @Suppress("DEPRECATION")
  override fun onCreate(savedInstanceState: Bundle?) {
    // expo-splash-screen: installs the androidx splash (the system splash on Android 12+,
    // the compat one on Android 11 and older) from Theme.App.SplashScreen, switches the
    // activity to its postSplashScreenTheme (AppTheme) and holds the splash until JS calls
    // hideAsync.
    SplashScreenManager.registerOnActivity(this)
    super.onCreate(null)
    // React Native's activity enableEdgeToEdge ran inside super (once, never again for this
    // window) and forced the navigation bar contrast scrim, which is a light band in
    // 3-button navigation. The bar is transparent with no scrim instead: what shows through
    // is what the app draws under the inset. Android 9 and older cannot draw a transparent
    // bar, so it gets the window colour. Hand-written native code: `expo prebuild --clean`
    // drops it.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      window.isNavigationBarContrastEnforced = false
      window.navigationBarColor = Color.TRANSPARENT
    } else {
      window.navigationBarColor = ContextCompat.getColor(this, R.color.window_background)
    }
    WindowInsetsControllerCompat(window, window.decorView).isAppearanceLightNavigationBars = false
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
