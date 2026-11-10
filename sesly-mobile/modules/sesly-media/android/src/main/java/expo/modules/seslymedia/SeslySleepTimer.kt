package expo.modules.seslymedia

import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.media3.common.Player
import java.lang.ref.WeakReference

/**
 * The duration sleep timer, on the main looper next to expo-audio's ExoPlayer.
 * JS timers stop while the activity is paused (screen off), so the deadline
 * and the fade-out live here. Each tick compares the wall clock with the
 * deadline, so time spent in deep sleep (nothing plays then) is caught up on
 * the next wake. At the deadline the player is paused and JS is told.
 */
internal object SeslySleepTimer {
  const val EVENT_FIRED = "onSleepTimerFired"
  private const val TICK_MS = 1_000L
  private const val FADE_TICK_MS = 200L

  private val handler = Handler(Looper.getMainLooper())
  private var target: WeakReference<Player>? = null
  private var endsAtEpochMs = 0L
  private var fadeMs = 0L
  private var volumeTouched = false

  /** Set by the module: delivers an event to JavaScript. */
  @Volatile var eventSink: ((name: String, body: Map<String, Any?>) -> Unit)? = null
  @Volatile var isArmed = false
    private set

  private val tick = Runnable { check() }

  /** Main thread. Arming again (restart, +5 dk) replaces the deadline. */
  fun arm(player: Player, endsAt: Long, fade: Long) {
    handler.removeCallbacksAndMessages(null)
    restoreVolume(player)
    target = WeakReference(player)
    endsAtEpochMs = endsAt
    fadeMs = fade.coerceAtLeast(0L)
    isArmed = true
    check()
  }

  /** Main thread. */
  fun disarm(restore: Boolean) {
    handler.removeCallbacksAndMessages(null)
    if (restore) target?.get()?.let { restoreVolume(it) }
    target = null
    isArmed = false
  }

  private fun check() {
    val player = target?.get() ?: run { disarm(restore = false); return }
    val now = System.currentTimeMillis()
    val left = endsAtEpochMs - now
    if (left <= 0L) {
      val sounding = player.playWhenReady &&
        player.playbackState != Player.STATE_ENDED &&
        player.playbackState != Player.STATE_IDLE
      if (sounding) player.pause()
      // After the pause, so it is inaudible; the next play is not silent.
      // (JS play() also sets the volume back to 1.)
      restoreVolume(player)
      target = null
      isArmed = false
      emit(mapOf("paused" to sounding, "firedAtMs" to now.toDouble()))
      return
    }
    if (fadeMs > 0L && left <= fadeMs) {
      player.volume = (left.toFloat() / fadeMs.toFloat()).coerceIn(0f, 1f)
      volumeTouched = true
    } else {
      restoreVolume(player)
    }
    val delay = if (fadeMs > 0L && left <= fadeMs + TICK_MS) FADE_TICK_MS else minOf(TICK_MS, left)
    handler.postDelayed(tick, delay)
  }

  private fun restoreVolume(player: Player) {
    if (!volumeTouched) return
    player.volume = 1f
    volumeTouched = false
  }

  private fun emit(body: Map<String, Any?>) {
    try {
      eventSink?.invoke(EVENT_FIRED, body)
    } catch (error: Exception) {
      Log.w("SeslyMedia", "Sleep timer event not delivered", error)
    }
  }
}
