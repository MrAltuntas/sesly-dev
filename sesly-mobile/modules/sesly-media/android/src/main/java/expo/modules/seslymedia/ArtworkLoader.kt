package expo.modules.seslymedia

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.util.LruCache
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Lock-screen artwork: the story cover, downloaded once and kept on disk,
 * or the app's placeholder cover when there is none (or it fails).
 *
 * Every picture is cut to a square from the upper part of the cover (the
 * part the app's square covers show) and stored as a 512 px JPEG, small
 * enough for the session's binder transactions.
 *
 * Results are delivered on the main thread. A newer [load] call makes the
 * pending results of older ones void.
 */
internal class ArtworkLoader(context: Context) {
  private val appContext = context.applicationContext
  private val executor = Executors.newSingleThreadExecutor { runnable ->
    Thread(runnable, "SeslyMediaArtwork").apply { isDaemon = true }
  }
  private val mainHandler = Handler(Looper.getMainLooper())
  private val generation = AtomicInteger(0)
  private val memory = LruCache<String, ByteArray>(MEMORY_ENTRIES)
  private val diskDir: File by lazy { File(appContext.cacheDir, DISK_DIR).apply { mkdirs() } }

  /**
   * Loads the artwork for a story. [onResult] may run twice: first with the
   * placeholder (when the cover is not cached yet), then with the cover.
   */
  fun load(coverUrl: String?, fallbackUri: String?, onResult: (ByteArray) -> Unit) {
    val ticket = generation.incrementAndGet()
    executor.execute {
      try {
        val cover = coverUrl?.takeIf { isHttp(it) }
        val cached = cover?.let { readCached(coverCacheKey(it)) }
        if (cached != null) {
          deliver(ticket, cached, onResult)
          return@execute
        }
        val fallback = fallbackUri?.let { loadFallback(it) }
        if (fallback != null) deliver(ticket, fallback, onResult)
        if (cover != null && ticket == generation.get()) {
          downloadCover(cover)?.let { deliver(ticket, it, onResult) }
        }
      } catch (error: Throwable) {
        Log.w(TAG, "Artwork load failed", error)
      }
    }
  }

  /** Drops the results of every pending load. */
  fun cancel() {
    generation.incrementAndGet()
  }

  private fun deliver(ticket: Int, bytes: ByteArray, onResult: (ByteArray) -> Unit) {
    mainHandler.post {
      if (ticket == generation.get()) onResult(bytes)
    }
  }

  // ---------------------------------------------------------------------------
  // Cover (remote, disk cached)
  // ---------------------------------------------------------------------------

  private fun downloadCover(url: String): ByteArray? {
    val raw = fetch(url) ?: return null
    val artwork = toArtwork(raw) ?: return null
    val key = coverCacheKey(url)
    memory.put(key, artwork)
    writeCached(key, artwork)
    return artwork
  }

  private fun readCached(key: String): ByteArray? {
    memory.get(key)?.let { return it }
    val file = File(diskDir, "$key.jpg")
    if (!file.isFile) return null
    return try {
      file.readBytes().also {
        memory.put(key, it)
        file.setLastModified(System.currentTimeMillis())
      }
    } catch (error: Exception) {
      null
    }
  }

  private fun writeCached(key: String, bytes: ByteArray) {
    try {
      val tmp = File(diskDir, "$key.tmp")
      tmp.writeBytes(bytes)
      tmp.renameTo(File(diskDir, "$key.jpg"))
      prune()
    } catch (error: Exception) {
      Log.w(TAG, "Artwork cache write failed", error)
    }
  }

  private fun prune() {
    val files = diskDir.listFiles { file -> file.name.endsWith(".jpg") } ?: return
    if (files.size <= DISK_ENTRIES) return
    files.sortedBy { it.lastModified() }
      .take(files.size - DISK_ENTRIES)
      .forEach { it.delete() }
  }

  // ---------------------------------------------------------------------------
  // Placeholder (an app asset)
  // ---------------------------------------------------------------------------

  /**
   * The placeholder as React Native resolves an image asset: a drawable
   * resource name in release builds, the Metro server URL in development, or
   * a file / content URI.
   */
  private fun loadFallback(uri: String): ByteArray? {
    val key = "fallback:$uri"
    memory.get(key)?.let { return it }
    val raw = when {
      isHttp(uri) -> fetch(uri)
      uri.startsWith("file://") -> Uri.parse(uri).path?.let { path -> File(path).takeIf { it.isFile }?.readBytes() }
      uri.startsWith("content://") || uri.startsWith("android.resource://") ->
        appContext.contentResolver.openInputStream(Uri.parse(uri))?.use { it.readBytes() }
      else -> readResource(uri)
    } ?: return null
    return toArtwork(raw)?.also { memory.put(key, it) }
  }

  private fun readResource(name: String): ByteArray? {
    val resources = appContext.resources
    val clean = name.substringBeforeLast('.').lowercase()
    for (type in arrayOf("drawable", "raw", "mipmap")) {
      val id = resources.getIdentifier(clean, type, appContext.packageName)
      if (id != 0) {
        return resources.openRawResource(id).use { it.readBytes() }
      }
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Network and image processing
  // ---------------------------------------------------------------------------

  private fun fetch(url: String): ByteArray? {
    var connection: HttpURLConnection? = null
    return try {
      connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = CONNECT_TIMEOUT_MS
        readTimeout = READ_TIMEOUT_MS
        instanceFollowRedirects = true
      }
      if (connection.responseCode !in 200..299) return null
      connection.inputStream.use { readLimited(it) }
    } catch (error: Exception) {
      Log.w(TAG, "Artwork download failed: ${error.message}")
      null
    } finally {
      connection?.disconnect()
    }
  }

  private fun readLimited(input: InputStream): ByteArray? {
    val out = ByteArrayOutputStream()
    val buffer = ByteArray(16 * 1024)
    var total = 0
    while (true) {
      val read = input.read(buffer)
      if (read < 0) break
      total += read
      if (total > MAX_DOWNLOAD_BYTES) return null
      out.write(buffer, 0, read)
    }
    return out.toByteArray()
  }

  /** Square crop from the upper part of the picture, [ARTWORK_SIZE] px, JPEG. */
  private fun toArtwork(raw: ByteArray): ByteArray? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(raw, 0, raw.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

    var sample = 1
    while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= ARTWORK_SIZE) sample *= 2
    val decoded = BitmapFactory.decodeByteArray(
      raw, 0, raw.size,
      BitmapFactory.Options().apply { inSampleSize = sample }
    ) ?: return null

    val side = minOf(decoded.width, decoded.height)
    val left = (decoded.width - side) / 2
    val top = ((decoded.height - side) * UPPER_BIAS).toInt()
    val square = Bitmap.createBitmap(ARTWORK_SIZE, ARTWORK_SIZE, Bitmap.Config.ARGB_8888)
    android.graphics.Canvas(square).drawBitmap(
      decoded,
      Rect(left, top, left + side, top + side),
      Rect(0, 0, ARTWORK_SIZE, ARTWORK_SIZE),
      android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG)
    )
    if (square !== decoded) decoded.recycle()

    val out = ByteArrayOutputStream()
    square.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
    square.recycle()
    return out.toByteArray()
  }

  private fun isHttp(value: String): Boolean =
    value.startsWith("https://", ignoreCase = true) || value.startsWith("http://", ignoreCase = true)

  /** Signed URLs rotate their query string: key on the object path. */
  private fun coverCacheKey(url: String): String = sha1(url.substringBefore('?'))

  private fun sha1(value: String): String =
    MessageDigest.getInstance("SHA-1")
      .digest(value.toByteArray())
      .joinToString("") { "%02x".format(it) }

  companion object {
    private const val TAG = "SeslyMedia"
    private const val DISK_DIR = "sesly-media-artwork"
    private const val DISK_ENTRIES = 60
    private const val MEMORY_ENTRIES = 8
    private const val ARTWORK_SIZE = 512
    private const val JPEG_QUALITY = 88
    private const val UPPER_BIAS = 0.2f
    private const val CONNECT_TIMEOUT_MS = 8_000
    private const val READ_TIMEOUT_MS = 12_000
    private const val MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024
  }
}
