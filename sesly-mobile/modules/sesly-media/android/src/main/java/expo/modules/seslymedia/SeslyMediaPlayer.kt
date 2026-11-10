package expo.modules.seslymedia

import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.ForwardingSimpleBasePlayer
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.Tracks
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture

/**
 * The player the media session shows: expo-audio's ExoPlayer as it is (its
 * real position, duration, speed, buffering and play state, so the system
 * seek bar is always right), with three changes:
 *
 *  - the story's metadata (title, narrator, artwork) on the current item,
 *  - only the commands a story needs (play/pause, seek, back and forward by
 *    the skip interval, stop); no previous/next, speed, volume or playlist,
 *  - every command is routed to JavaScript through [onCommand] instead of
 *    touching the ExoPlayer. The JS audio store stays the single owner of
 *    playback (audio focus, saved position, sleep timer, premium rules) and
 *    drives expo-audio, whose state then flows back here.
 *
 * While JS acts, the command's future stays pending so Media3 shows the
 * expected state (paused, the new position) instead of flickering back.
 * It completes when the ExoPlayer reaches that state or after
 * [COMMAND_TIMEOUT_MS], whichever comes first.
 */
@OptIn(UnstableApi::class)
internal class SeslyMediaPlayer(
  private val target: DetachablePlayer,
  private val onCommand: (command: String, valueMs: Long?) -> Unit
) : ForwardingSimpleBasePlayer(target) {

  private class Waiter(
    val isDone: (events: Player.Events?) -> Boolean,
    val future: SettableFuture<Any?>
  )

  private val handler = Handler(target.applicationLooper)
  private val waiters = mutableListOf<Waiter>()
  private var nowPlaying: MediaMetadata? = null
  private var skipBackMs: Long = DEFAULT_SKIP_MS
  private var skipForwardMs: Long = DEFAULT_SKIP_MS

  init {
    target.addListener(object : Player.Listener {
      override fun onEvents(player: Player, events: Player.Events) {
        settleWaiters(events)
      }
    })
  }

  /** The story's metadata. Main thread. */
  fun setNowPlaying(metadata: MediaMetadata) {
    nowPlaying = metadata
    invalidateState()
  }

  /** Skip intervals of the back and forward buttons. Main thread. */
  fun setSkipIntervals(backMs: Long, forwardMs: Long) {
    skipBackMs = backMs.coerceAtLeast(1)
    skipForwardMs = forwardMs.coerceAtLeast(1)
    invalidateState()
  }

  override fun getState(): State {
    val base = super.getState()
    val builder = base.buildUpon()
      .setAvailableCommands(storyCommands(base.availableCommands))
      .setSeekBackIncrementMs(skipBackMs)
      .setSeekForwardIncrementMs(skipForwardMs)
    val story = nowPlaying
    if (
      story != null &&
      target.isCommandAvailable(Player.COMMAND_GET_TIMELINE) &&
      !target.currentTimeline.isEmpty
    ) {
      val tracks =
        if (target.isCommandAvailable(Player.COMMAND_GET_TRACKS)) target.currentTracks else Tracks.EMPTY
      val fromStream =
        if (target.isCommandAvailable(Player.COMMAND_GET_METADATA)) target.mediaMetadata else MediaMetadata.EMPTY
      // The stream's own tags (if any) fill in what the story leaves empty.
      val merged = fromStream.buildUpon().populate(story).build()
      builder.setPlaylist(target.currentTimeline, tracks, merged)
    }
    return builder.build()
  }

  override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> {
    // Always forwarded, even when the ExoPlayer already matches: at the end
    // of a story playWhenReady is still true and "play" means "start over",
    // which the JS store decides.
    onCommand(if (playWhenReady) COMMAND_PLAY else COMMAND_PAUSE, null)
    return await(settledNow = true) {
      if (playWhenReady) {
        target.playWhenReady && target.playbackState != Player.STATE_ENDED
      } else {
        !target.playWhenReady
      }
    }
  }

  override fun handleSeek(mediaItemIndex: Int, positionMs: Long, seekCommand: Int): ListenableFuture<*> {
    when (seekCommand) {
      Player.COMMAND_SEEK_BACK -> onCommand(COMMAND_SKIP_BACKWARD, skipBackMs)
      Player.COMMAND_SEEK_FORWARD -> onCommand(COMMAND_SKIP_FORWARD, skipForwardMs)
      Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
      Player.COMMAND_SEEK_TO_MEDIA_ITEM -> onCommand(COMMAND_SEEK_TO, positionMs.coerceAtLeast(0))
      Player.COMMAND_SEEK_TO_DEFAULT_POSITION -> onCommand(COMMAND_SEEK_TO, 0)
      else -> return Futures.immediateVoidFuture()
    }
    // Only the seek's position discontinuity settles it.
    return await(settledNow = false) { events ->
      events?.contains(Player.EVENT_POSITION_DISCONTINUITY) == true
    }
  }

  override fun handleStop(): ListenableFuture<*> {
    // A dismissed notification, a stop key or a controller's stop. JS
    // pauses and takes the story off the lock screen.
    onCommand(COMMAND_STOP, null)
    return Futures.immediateVoidFuture()
  }

  override fun handleRelease(): ListenableFuture<*> {
    // Never release expo-audio's ExoPlayer: only let go of it.
    settleAll()
    target.detach()
    return Futures.immediateVoidFuture()
  }

  /**
   * A future that completes once [isDone] holds after a player event, or
   * after [COMMAND_TIMEOUT_MS]. With [settledNow] it completes at once when
   * the player already is in the requested state.
   */
  private fun await(
    settledNow: Boolean,
    isDone: (events: Player.Events?) -> Boolean
  ): ListenableFuture<*> {
    if (settledNow && isDone(null)) return Futures.immediateVoidFuture()
    val waiter = Waiter(isDone, SettableFuture.create())
    waiters.add(waiter)
    handler.postDelayed({
      if (waiters.remove(waiter)) waiter.future.set(null)
    }, COMMAND_TIMEOUT_MS)
    return waiter.future
  }

  private fun settleWaiters(events: Player.Events) {
    if (waiters.isEmpty()) return
    val done = waiters.filter { it.isDone(events) }
    if (done.isEmpty()) return
    waiters.removeAll(done)
    done.forEach { it.future.set(null) }
  }

  private fun settleAll() {
    val all = waiters.toList()
    waiters.clear()
    all.forEach { it.future.set(null) }
  }

  companion object {
    const val COMMAND_PLAY = "play"
    const val COMMAND_PAUSE = "pause"
    const val COMMAND_STOP = "stop"
    const val COMMAND_SEEK_TO = "seekTo"
    const val COMMAND_SKIP_BACKWARD = "skipBackward"
    const val COMMAND_SKIP_FORWARD = "skipForward"

    const val DEFAULT_SKIP_MS = 15_000L

    /** How long the session shows a command's expected state while JS acts. */
    const val COMMAND_TIMEOUT_MS = 1_500L

    /** Commands the ExoPlayer may offer that a story keeps. */
    private val STORY_COMMANDS = intArrayOf(
      Player.COMMAND_PLAY_PAUSE,
      Player.COMMAND_PREPARE,
      Player.COMMAND_STOP,
      Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
      Player.COMMAND_SEEK_BACK,
      Player.COMMAND_SEEK_FORWARD,
      Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
      Player.COMMAND_GET_TIMELINE,
      Player.COMMAND_GET_METADATA,
      Player.COMMAND_GET_TRACKS,
      Player.COMMAND_GET_AUDIO_ATTRIBUTES,
      Player.COMMAND_GET_VOLUME,
      Player.COMMAND_GET_DEVICE_VOLUME
    )

    private fun storyCommands(available: Player.Commands): Player.Commands {
      val builder = Player.Commands.Builder()
      STORY_COMMANDS.forEach { if (available.contains(it)) builder.add(it) }
      return builder.build()
    }
  }
}
