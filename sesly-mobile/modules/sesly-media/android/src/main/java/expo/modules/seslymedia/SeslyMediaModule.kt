package expo.modules.seslymedia

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.media3.common.Player
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.sharedobjects.SharedRef

class NowPlayingMetadataRecord : Record {
  @Field
  var title: String? = null

  @Field
  var artist: String? = null

  @Field
  var albumTitle: String? = null

  /** Remote story cover (http or https). */
  @Field
  var artworkUrl: String? = null

  /** The app's placeholder cover, as `Image.resolveAssetSource` gives it. */
  @Field
  var fallbackArtworkUri: String? = null
}

class NowPlayingOptionsRecord : Record {
  @Field
  var skipBackwardMs: Double = SeslyMediaPlayer.DEFAULT_SKIP_MS.toDouble()

  @Field
  var skipForwardMs: Double = SeslyMediaPlayer.DEFAULT_SKIP_MS.toDouble()
}

private class NotAMediaPlayerException :
  CodedException("The player passed to SeslyMedia is not a Media3 player")

/**
 * SeslyMedia: the Android lock-screen and notification player for the one
 * expo-audio player of the app. JS passes that player (`activate`), the
 * story's metadata and the skip intervals; commands come back as
 * `onCommand` events, an unplugged headset as `onBecomingNoisy`, and a
 * session the system ended as `onSessionEnded`.
 *
 * It also holds the duration sleep timer's deadline (`armSleepTimer`,
 * `SeslySleepTimer`), which does not need an active session: it fades and
 * pauses the same player with the screen off and reports `onSleepTimerFired`.
 */
class SeslyMediaModule : Module() {
  private var noisyReceiver: BroadcastReceiver? = null
  private var sink: ((String, Map<String, Any?>) -> Unit)? = null

  override fun definition() = ModuleDefinition {
    Name("SeslyMedia")

    Events(
      SeslyMediaSessionHolder.EVENT_COMMAND,
      SeslyMediaSessionHolder.EVENT_BECOMING_NOISY,
      SeslyMediaSessionHolder.EVENT_SESSION_ENDED,
      SeslySleepTimer.EVENT_FIRED
    )

    OnCreate {
      val events: (String, Map<String, Any?>) -> Unit = { name, body -> sendEvent(name, body) }
      sink = events
      SeslyMediaSessionHolder.eventSink = events
      SeslySleepTimer.eventSink = events
      // A new module is a new JS runtime, which has no sleep timer: a deadline
      // the previous one armed (a reload, whose OnDestroy comes after this and
      // no longer owns the sink) goes now. Its arm calls run on the main queue
      // after this post.
      Handler(Looper.getMainLooper()).post { SeslySleepTimer.disarm(restore = true) }
      registerNoisyReceiver()
    }

    OnDestroy {
      unregisterNoisyReceiver()
      val mine = sink
      sink = null
      Handler(Looper.getMainLooper()).post {
        // A reload creates a new module before the old one is destroyed:
        // only clear what is still ours.
        if (SeslyMediaSessionHolder.eventSink === mine) {
          SeslyMediaSessionHolder.eventSink = null
          SeslyMediaSessionHolder.deactivate()
        }
        // The module goes without a successor: never leave a deadline nobody owns.
        if (SeslySleepTimer.eventSink === mine) {
          SeslySleepTimer.eventSink = null
          SeslySleepTimer.disarm(restore = true)
        }
      }
    }

    AsyncFunction("activate") { player: SharedRef<*>, metadata: NowPlayingMetadataRecord, options: NowPlayingOptionsRecord ->
      val exoPlayer = player.ref as? Player ?: throw NotAMediaPlayerException()
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SeslyMediaSessionHolder.activate(
        context,
        exoPlayer,
        metadata.toNowPlaying(),
        options.skipBackwardMs.toLong(),
        options.skipForwardMs.toLong()
      )
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("updateMetadata") { metadata: NowPlayingMetadataRecord ->
      SeslyMediaSessionHolder.update(metadata.toNowPlaying())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("deactivate") {
      SeslyMediaSessionHolder.deactivate()
    }.runOnQueue(Queues.MAIN)

    Function("isActive") {
      SeslyMediaSessionHolder.isActive
    }

    AsyncFunction("armSleepTimer") { player: SharedRef<*>, endsAtEpochMs: Double, fadeMs: Double ->
      val exoPlayer = player.ref as? Player ?: throw NotAMediaPlayerException()
      SeslySleepTimer.arm(exoPlayer, endsAtEpochMs.toLong(), fadeMs.toLong())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("disarmSleepTimer") { restoreVolume: Boolean ->
      SeslySleepTimer.disarm(restoreVolume)
    }.runOnQueue(Queues.MAIN)

    Function("isSleepTimerArmed") {
      SeslySleepTimer.isArmed
    }
  }

  private fun registerNoisyReceiver() {
    val context = appContext.reactContext?.applicationContext ?: return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
          SeslyMediaSessionHolder.onBecomingNoisy()
        }
      }
    }
    try {
      ContextCompat.registerReceiver(
        context,
        receiver,
        IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
        ContextCompat.RECEIVER_NOT_EXPORTED
      )
      noisyReceiver = receiver
    } catch (error: Exception) {
      Log.w("SeslyMedia", "Noisy receiver not registered", error)
    }
  }

  private fun unregisterNoisyReceiver() {
    val receiver = noisyReceiver ?: return
    noisyReceiver = null
    try {
      appContext.reactContext?.applicationContext?.unregisterReceiver(receiver)
    } catch (error: Exception) {
      Log.w("SeslyMedia", "Noisy receiver not unregistered", error)
    }
  }
}

private fun NowPlayingMetadataRecord.toNowPlaying() = NowPlaying(
  title = title?.trim().orEmpty(),
  artist = artist?.trim()?.takeIf { it.isNotEmpty() },
  albumTitle = albumTitle?.trim()?.takeIf { it.isNotEmpty() },
  artworkUrl = artworkUrl?.trim()?.takeIf { it.isNotEmpty() },
  fallbackArtworkUri = fallbackArtworkUri?.trim()?.takeIf { it.isNotEmpty() }
)
