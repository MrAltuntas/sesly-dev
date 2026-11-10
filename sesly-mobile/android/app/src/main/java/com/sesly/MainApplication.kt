package com.sesly

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.res.Configuration
import android.os.Build

import androidx.appcompat.app.AppCompatDelegate

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      applicationContext,
      PackageList(this).packages
    )
  }

  override fun onCreate() {
    super.onCreate()
    // Sesly is dark-only. Pinned before React Native loads, night mode is part of the
    // attach-time configuration of the activity and of every Dialog context (each RN
    // Modal is its own window), so React Native's enableEdgeToEdge gives sheets and
    // dialogs light bar icons and a dark scrim from their first frame. uiMode is in the
    // activity's configChanges, so nothing is recreated. Hand-written native code:
    // `expo prebuild --clean` drops it.
    AppCompatDelegate.setDefaultNightMode(AppCompatDelegate.MODE_NIGHT_YES)
    createNotificationChannels()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }

  /**
   * FCM push channel. The backend sends Android notifications with
   * channelId "sesly-default" (also the default channel in AndroidManifest).
   * Without this channel Android 8+ falls back to FCM's "Miscellaneous"
   * channel. Creating an existing channel is a no-op, so this is safe on
   * every start. Hand-written native code: `expo prebuild --clean` drops it.
   */
  private fun createNotificationChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val channel = NotificationChannel(
      DEFAULT_NOTIFICATION_CHANNEL_ID,
      getString(R.string.notification_channel_default_name),
      NotificationManager.IMPORTANCE_HIGH
    ).apply {
      description = getString(R.string.notification_channel_default_description)
    }
    manager.createNotificationChannel(channel)
  }

  companion object {
    const val DEFAULT_NOTIFICATION_CHANNEL_ID = "sesly-default"
  }
}
