package expo.modules.seslymedia

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.util.Log
import androidx.annotation.OptIn
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * Shows [SeslyMediaSessionHolder]'s session as the system media
 * notification and lock-screen player, and keeps the process in the
 * foreground while a story plays.
 *
 * Media3 does the notification work: it posts the media-style notification
 * (artwork, title, narrator, seek bar, back / play-pause / forward), starts
 * and stops the foreground state with playback, keeps the notification for
 * ten minutes after a pause so playback can resume from it, and stops the
 * service when the app is swiped away while nothing plays.
 */
@OptIn(UnstableApi::class)
class SeslyMediaService : MediaSessionService() {

  override fun onCreate() {
    super.onCreate()
    val provider = DefaultMediaNotificationProvider.Builder(this)
      .setChannelId(CHANNEL_ID)
      .setChannelName(R.string.sesly_media_channel_name)
      .setNotificationId(NOTIFICATION_ID)
      .build()
    provider.setSmallIcon(R.drawable.sesly_media_notification_icon)
    setMediaNotificationProvider(provider)
    setListener(object : MediaSessionService.Listener {
      override fun onForegroundServiceStartNotAllowedException() {
        Log.w(TAG, "The system did not allow the playback notification in the foreground")
      }
    })
    SeslyMediaSessionHolder.onServiceCreated(this)
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
    SeslyMediaSessionHolder.session

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (SeslyMediaSessionHolder.session == null) {
      // Started without a story: Android 8 to 11 deliver a media key after
      // the session is gone through a foreground-service intent, which must
      // reach the foreground before the service may stop.
      if (intent?.action == Intent.ACTION_MEDIA_BUTTON) satisfyForegroundStart()
      stopSelf(startId)
      return START_NOT_STICKY
    }
    super.onStartCommand(intent, flags, startId)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    SeslyMediaSessionHolder.onServiceDestroyed(this)
    super.onDestroy()
  }

  private fun satisfyForegroundStart() {
    try {
      val manager = getSystemService(NotificationManager::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager?.getNotificationChannel(CHANNEL_ID) == null) {
        manager?.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, getString(R.string.sesly_media_channel_name), NotificationManager.IMPORTANCE_LOW)
        )
      }
      val notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setSmallIcon(R.drawable.sesly_media_notification_icon)
        .setContentTitle(getString(R.string.sesly_media_channel_name))
        .setSilent(true)
        .build()
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
      } else {
        0
      }
      ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
      ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
    } catch (error: Exception) {
      Log.w(TAG, "Could not satisfy the foreground start", error)
    }
  }

  companion object {
    private const val TAG = "SeslyMedia"
    const val CHANNEL_ID = "sesly_playback"
    const val NOTIFICATION_ID = 7301
  }
}
