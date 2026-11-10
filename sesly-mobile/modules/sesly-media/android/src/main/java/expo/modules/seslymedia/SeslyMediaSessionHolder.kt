package expo.modules.seslymedia

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import androidx.annotation.OptIn
import androidx.core.content.IntentCompat
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/** What the lock screen shows for the loaded story. */
internal data class NowPlaying(
  val title: String,
  val artist: String?,
  val albumTitle: String?,
  val artworkUrl: String?,
  val fallbackArtworkUri: String?
)

/**
 * Owns the one media session of the app (process wide, main thread only).
 *
 * The session lives from `activate` (a Pro user starts a story) to
 * `deactivate` (stop, a preview, a downgrade) and is shown by
 * [SeslyMediaService]. Commands from the notification, the lock screen,
 * headsets and Bluetooth reach JavaScript through [eventSink]; JS drives
 * expo-audio and the session follows the ExoPlayer.
 */
@OptIn(UnstableApi::class)
internal object SeslyMediaSessionHolder {
  private const val TAG = "SeslyMedia"
  const val SESSION_ID = "sesly-now-playing"
  const val COMMAND_SKIP_BACK = "expo.modules.seslymedia.SKIP_BACK"
  const val COMMAND_SKIP_FORWARD = "expo.modules.seslymedia.SKIP_FORWARD"

  const val EVENT_COMMAND = "onCommand"
  const val EVENT_BECOMING_NOISY = "onBecomingNoisy"
  const val EVENT_SESSION_ENDED = "onSessionEnded"

  /** Set by the module: delivers an event to JavaScript. */
  var eventSink: ((name: String, body: Map<String, Any?>) -> Unit)? = null

  var session: MediaSession? = null
    private set
  private var player: SeslyMediaPlayer? = null
  private var target: Player? = null
  private var service: SeslyMediaService? = null
  private var artwork: ArtworkLoader? = null

  private var nowPlaying: NowPlaying? = null
  private var artworkKey: String? = null
  private var artworkBytes: ByteArray? = null
  private var skipBackMs = SeslyMediaPlayer.DEFAULT_SKIP_MS
  private var skipForwardMs = SeslyMediaPlayer.DEFAULT_SKIP_MS
  private var context: Context? = null

  val isActive: Boolean
    get() = session != null

  // ---------------------------------------------------------------------------
  // Called by the module (JS)
  // ---------------------------------------------------------------------------

  fun activate(context: Context, exoPlayer: Player, metadata: NowPlaying, backMs: Long, forwardMs: Long) {
    if (target != null && target !== exoPlayer) {
      // expo-audio created a new player (a dev reload): start over on it.
      deactivate()
    }
    val appContext = context.applicationContext
    this.context = appContext
    skipBackMs = backMs.coerceAtLeast(1)
    skipForwardMs = forwardMs.coerceAtLeast(1)

    var current = session
    if (current == null) {
      val sessionPlayer = SeslyMediaPlayer(DetachablePlayer(exoPlayer), ::dispatchCommand)
      val builder = MediaSession.Builder(appContext, sessionPlayer)
        .setId(SESSION_ID)
        .setCallback(SessionCallback)
      launchAppIntent(appContext)?.let { builder.setSessionActivity(it) }
      current = builder.build()
      session = current
      player = sessionPlayer
      target = exoPlayer
    }
    player?.setSkipIntervals(skipBackMs, skipForwardMs)
    current.setMediaButtonPreferences(skipButtons(appContext))
    update(metadata)
    attachToService(appContext)
  }

  fun update(metadata: NowPlaying) {
    if (session == null) return
    nowPlaying = metadata
    val key = "${metadata.artworkUrl.orEmpty()}\n${metadata.fallbackArtworkUri.orEmpty()}"
    if (key != artworkKey) {
      artworkKey = key
      artworkBytes = null
      val ctx = context
      if (ctx != null && (metadata.artworkUrl != null || metadata.fallbackArtworkUri != null)) {
        val loader = artwork ?: ArtworkLoader(ctx).also { artwork = it }
        loader.load(metadata.artworkUrl, metadata.fallbackArtworkUri) { bytes ->
          if (artworkKey == key && session != null) {
            artworkBytes = bytes
            applyMetadata()
          }
        }
      } else {
        artwork?.cancel()
      }
    }
    applyMetadata()
    // A service that could not start before (the app was in the background)
    // gets another chance with every update.
    context?.let { if (service == null) attachToService(it) }
  }

  fun deactivate() {
    val current = session ?: return
    artwork?.cancel()
    val runningService = service
    service = null
    runningService?.removeSession(current)
    releaseSession()
    runningService?.stopSelf()
  }

  /** Headphones were unplugged or Bluetooth audio dropped: silence at once. */
  fun onBecomingNoisy() {
    target?.let { if (it.playWhenReady) it.pause() }
    emit(EVENT_BECOMING_NOISY, emptyMap())
  }

  // ---------------------------------------------------------------------------
  // Called by the service
  // ---------------------------------------------------------------------------

  fun onServiceCreated(created: SeslyMediaService) {
    service = created
    session?.let { created.addSession(it) }
  }

  fun onServiceDestroyed(destroyed: SeslyMediaService) {
    if (service !== destroyed) return
    service = null
    if (session != null) {
      // The system or Media3 ended the service (the app was swiped away
      // while paused): the lock screen no longer shows the story.
      releaseSession()
      emit(EVENT_SESSION_ENDED, mapOf("reason" to "serviceStopped"))
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private fun applyMetadata() {
    val story = nowPlaying ?: return
    val sessionPlayer = player ?: return
    val builder = MediaMetadata.Builder()
      .setTitle(story.title)
      .setDisplayTitle(story.title)
      .setArtist(story.artist)
      .setSubtitle(story.artist)
      .setAlbumTitle(story.albumTitle)
      .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER)
      .setIsBrowsable(false)
      .setIsPlayable(true)
    artworkBytes?.let { builder.setArtworkData(it, MediaMetadata.PICTURE_TYPE_FRONT_COVER) }
    sessionPlayer.setNowPlaying(builder.build())
  }

  private fun attachToService(appContext: Context) {
    val current = session ?: return
    val running = service
    if (running != null) {
      running.addSession(current)
      return
    }
    try {
      appContext.startService(Intent(appContext, SeslyMediaService::class.java))
    } catch (error: Exception) {
      // Android 8+ refuses to start a service while the app is in the
      // background; the next update tries again.
      Log.w(TAG, "Media service start failed: ${error.message}")
    }
  }

  private fun releaseSession() {
    session?.release()
    player?.release()
    session = null
    player = null
    target = null
    nowPlaying = null
    artworkKey = null
    artworkBytes = null
  }

  private fun dispatchCommand(command: String, valueMs: Long?) {
    val body = mutableMapOf<String, Any?>("command" to command)
    if (valueMs != null) {
      if (command == SeslyMediaPlayer.COMMAND_SEEK_TO) {
        body["positionMs"] = valueMs.toDouble()
      } else {
        body["intervalMs"] = valueMs.toDouble()
      }
    }
    emit(EVENT_COMMAND, body)
  }

  private fun emit(name: String, body: Map<String, Any?>) {
    try {
      eventSink?.invoke(name, body)
    } catch (error: Exception) {
      Log.w(TAG, "Event $name not delivered", error)
    }
  }

  private fun skipButtons(context: Context): List<CommandButton> {
    val backSeconds = (skipBackMs / 1000).toInt()
    val forwardSeconds = (skipForwardMs / 1000).toInt()
    return listOf(
      CommandButton.Builder(backIcon(backSeconds))
        .setDisplayName(context.getString(R.string.sesly_media_skip_back, backSeconds))
        .setSessionCommand(SessionCommand(COMMAND_SKIP_BACK, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_BACK)
        .build(),
      CommandButton.Builder(forwardIcon(forwardSeconds))
        .setDisplayName(context.getString(R.string.sesly_media_skip_forward, forwardSeconds))
        .setSessionCommand(SessionCommand(COMMAND_SKIP_FORWARD, Bundle.EMPTY))
        .setSlots(CommandButton.SLOT_FORWARD)
        .build()
    )
  }

  private fun backIcon(seconds: Int): Int = when (seconds) {
    5 -> CommandButton.ICON_SKIP_BACK_5
    10 -> CommandButton.ICON_SKIP_BACK_10
    15 -> CommandButton.ICON_SKIP_BACK_15
    30 -> CommandButton.ICON_SKIP_BACK_30
    else -> CommandButton.ICON_SKIP_BACK
  }

  private fun forwardIcon(seconds: Int): Int = when (seconds) {
    5 -> CommandButton.ICON_SKIP_FORWARD_5
    10 -> CommandButton.ICON_SKIP_FORWARD_10
    15 -> CommandButton.ICON_SKIP_FORWARD_15
    30 -> CommandButton.ICON_SKIP_FORWARD_30
    else -> CommandButton.ICON_SKIP_FORWARD
  }

  /** Tapping the notification or the lock-screen player opens the app. */
  private fun launchAppIntent(context: Context): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  /**
   * Accepts every controller (the notification, the system UI, Bluetooth)
   * with the two skip commands, and turns next / previous keys (headsets
   * and car stereos without seek keys) into skip forward / back.
   */
  private object SessionCallback : MediaSession.Callback {
    override fun onConnect(
      session: MediaSession,
      controller: MediaSession.ControllerInfo
    ): MediaSession.ConnectionResult {
      val sessionCommands = MediaSession.ConnectionResult.DEFAULT_SESSION_COMMANDS.buildUpon()
        .add(SessionCommand(COMMAND_SKIP_BACK, Bundle.EMPTY))
        .add(SessionCommand(COMMAND_SKIP_FORWARD, Bundle.EMPTY))
        .build()
      return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
        .setAvailableSessionCommands(sessionCommands)
        .build()
    }

    override fun onCustomCommand(
      session: MediaSession,
      controller: MediaSession.ControllerInfo,
      customCommand: SessionCommand,
      args: Bundle
    ): ListenableFuture<SessionResult> {
      when (customCommand.customAction) {
        COMMAND_SKIP_BACK -> session.player.seekBack()
        COMMAND_SKIP_FORWARD -> session.player.seekForward()
        else -> return Futures.immediateFuture(SessionResult(SessionError.ERROR_NOT_SUPPORTED))
      }
      return Futures.immediateFuture(SessionResult(SessionResult.RESULT_SUCCESS))
    }

    override fun onMediaButtonEvent(
      session: MediaSession,
      controllerInfo: MediaSession.ControllerInfo,
      intent: Intent
    ): Boolean {
      val event = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_KEY_EVENT, KeyEvent::class.java)
        ?: return false
      val skip = when (event.keyCode) {
        KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD, KeyEvent.KEYCODE_MEDIA_SKIP_FORWARD -> 1
        KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_MEDIA_REWIND, KeyEvent.KEYCODE_MEDIA_SKIP_BACKWARD -> -1
        else -> return false
      }
      if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
        if (skip > 0) session.player.seekForward() else session.player.seekBack()
      }
      return true
    }
  }
}
