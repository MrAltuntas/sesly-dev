package expo.modules.seslymedia

import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player

/**
 * A pass-through view of expo-audio's ExoPlayer that can be cut loose.
 *
 * [SeslyMediaPlayer] listens to the player it forwards and Media3 offers no
 * way to remove that listener short of releasing the wrapped player, which
 * would stop expo-audio's playback. Everything that listens through this
 * proxy is remembered, so [detach] can unhook it all while the ExoPlayer
 * keeps playing for expo-audio.
 */
internal class DetachablePlayer(player: Player) : ForwardingPlayer(player) {
  private val listeners = mutableListOf<Player.Listener>()
  private var detached = false

  override fun addListener(listener: Player.Listener) {
    if (detached) return
    listeners.add(listener)
    super.addListener(listener)
  }

  override fun removeListener(listener: Player.Listener) {
    listeners.remove(listener)
    super.removeListener(listener)
  }

  /** Removes every listener added through this proxy. Idempotent. */
  fun detach() {
    if (detached) return
    detached = true
    listeners.toList().forEach { super.removeListener(it) }
    listeners.clear()
  }
}
