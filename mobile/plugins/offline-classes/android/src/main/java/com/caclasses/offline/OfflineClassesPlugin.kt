package com.caclasses.offline

import android.app.DownloadManager
import android.os.Build
import android.content.Context
import android.net.Uri
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import android.util.Base64

// Secure offline classes for Android.
//  - download: hands the file to the SYSTEM DownloadManager — it continues with
//    the app closed/locked (it's an OS service, immune to battery optimisation),
//    shows the standard download notification, and lands in the app-private
//    external files dir, WHERE IT STAYS. If the app was killed mid-download the
//    OS finishes it anyway and the next isDownloaded() picks it up.
//  - decrypt:  streams AES-256-CBC (PKCS5) to cacheDir/play-<id>.mp4 for the
//    player (the key is supplied per-play by the server and never stored).
@CapacitorPlugin(name = "OfflineClasses")
class OfflineClassesPlugin : Plugin() {

    private val io = Executors.newCachedThreadPool()

    // Where a download LANDS. DownloadManager is a separate OS process and
    // cannot write to our internal filesDir, so it must be the app's external
    // files dir (still app-private, still wiped on uninstall).
    private fun downloadDir(): File? = context.getExternalFilesDir(null)

    // Where downloads used to be MOVED to. A class is 400 MB – 1 GB and these
    // two are different mount points, so renameTo() always failed and it fell
    // back to copying the whole file: a minute of apparent hang at 100%, and a
    // phone briefly needing THREE copies of one class (the download, the copy,
    // and later the decrypted copy to play). On a phone that was short of space
    // the copy simply threw and the class "failed to download".
    //
    // Nothing is moved any more — but classes downloaded by the older build are
    // still sitting here, so this is still where we look first.
    private fun legacyDir(): File {
        val dir = File(context.filesDir, "classes")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun legacyFile(id: String) = File(legacyDir(), "$id.enc")
    private fun tmpName(id: String) = "dl-$id.enc"
    private fun tmpFile(id: String): File? = downloadDir()?.let { File(it, tmpName(id)) }

    /** The playable copy of this class, wherever it happens to live. */
    private fun encFile(id: String): File? {
        val legacy = legacyFile(id)
        if (legacy.exists()) return legacy
        return tmpFile(id)?.takeIf { it.exists() }
    }

    // Is the class fully here? Nothing is copied — a finished download IS the
    // final file. Older downloads in the internal dir are still honoured.
    private fun finalizeIfReady(id: String, expected: Long): Boolean {
        val f = encFile(id) ?: return false
        return f.exists() && (expected == 0L || f.length() == expected)
    }

    // Asked when the FIRST download starts, never at launch: a permission box
    // that appears the moment the app opens gets refused, and one that appears
    // as a class begins downloading explains itself. Declaring the permission
    // is not enough on Android 13+; unasked, the download runs with no
    // notification at all and looks like a download that never started.
    private var notificationsAsked = false

    /** Classes already retried in-app, so a real failure is reported not looped. */
    private val retried = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    /** No point retrying when the phone is simply full — it will fail again. */
    private fun outOfSpace(dm: DownloadManager, dlId: Long): Boolean {
        var reason = 0
        try {
            dm.query(DownloadManager.Query().setFilterById(dlId))?.use { c ->
                if (c.moveToFirst()) reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
            }
        } catch (_: Exception) { /* assume there is room */ }
        return reason == DownloadManager.ERROR_INSUFFICIENT_SPACE
    }

    /**
     * Download the class ourselves, in this app, when the system downloader
     * has refused. Streams straight to the final file and reports progress the
     * same way, so the screen behaves identically.
     */
    private fun fetchInApp(id: String, url: String, expected: Long, call: PluginCall): Boolean {
        val dest = tmpFile(id) ?: return false
        return try {
            val conn = (java.net.URL(url).openConnection() as java.net.HttpURLConnection).apply {
                connectTimeout = 30_000
                readTimeout = 60_000
                instanceFollowRedirects = true
            }
            if (conn.responseCode !in 200..299) {
                conn.disconnect()
                call.reject("download failed (server said ${conn.responseCode}) — please retry")
                return true
            }
            val total = if (expected > 0) expected else conn.contentLengthLong
            conn.inputStream.use { input ->
                java.io.FileOutputStream(dest).use { out ->
                    val buf = ByteArray(1 shl 20) // 1 MB
                    var done = 0L
                    var lastPct = -1
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        // Same throttle as everywhere else: the number on screen
                        // changes a hundred times, not a thousand.
                        val pct = if (total > 0) ((done * 100) / total).toInt() else 0
                        if (pct != lastPct) {
                            lastPct = pct
                            val p = JSObject(); p.put("id", id); p.put("received", done); p.put("total", total)
                            notifyListeners("downloadProgress", p)
                        }
                    }
                }
            }
            conn.disconnect()
            if (expected > 0 && dest.length() != expected) {
                dest.delete()
                call.reject("download arrived incomplete (${dest.length()} of $expected bytes) — please retry")
            } else {
                retried.remove(id)
                val r = JSObject(); r.put("path", dest.absolutePath); call.resolve(r)
            }
            true
        } catch (e: Exception) {
            try { dest.delete() } catch (_: Exception) { /* nothing to clean */ }
            call.reject("download failed (${e.message ?: "connection lost"}) — please retry")
            true
        }
    }

    private fun askForNotificationsOnce() {
        if (notificationsAsked || Build.VERSION.SDK_INT < 33) return
        notificationsAsked = true
        val perm = "android.permission.POST_NOTIFICATIONS"
        if (context.checkSelfPermission(perm) == android.content.pm.PackageManager.PERMISSION_GRANTED) return
        // Fire and carry on — the download must not wait on the answer.
        try { activity.requestPermissions(arrayOf(perm), 9411) } catch (_: Exception) { /* no activity */ }
    }

    // DownloadManager knows exactly why it gave up; the student deserves to be
    // told, rather than retrying a download the phone has no room for.
    private fun failReason(dm: DownloadManager, dlId: Long): String {
        var reason = 0
        try {
            dm.query(DownloadManager.Query().setFilterById(dlId))?.use { c ->
                if (c.moveToFirst()) reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON))
            }
        } catch (_: Exception) { /* fall through to the generic message */ }
        return when (reason) {
            DownloadManager.ERROR_INSUFFICIENT_SPACE -> "this phone is out of space"
            DownloadManager.ERROR_DEVICE_NOT_FOUND -> "storage not available"
            DownloadManager.ERROR_CANNOT_RESUME -> "the connection dropped and could not resume"
            DownloadManager.ERROR_HTTP_DATA_ERROR, DownloadManager.ERROR_TOO_MANY_REDIRECTS -> "the connection kept breaking"
            DownloadManager.ERROR_FILE_ERROR -> "the file could not be written"
            0 -> "check your internet"
            else -> "error $reason"
        }
    }

    private fun expectedOf(call: PluginCall): Long =
        (call.getDouble("expectedSize") ?: 0.0).toLong() // NOT getInt — classes can exceed 2 GB

    @PluginMethod
    fun download(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val url = call.getString("url") ?: return call.reject("url required")
        val expected = expectedOf(call)
        if (finalizeIfReady(id, expected)) {
            val r = JSObject(); r.put("path", encFile(id)!!.absolutePath); return call.resolve(r)
        }
        val tmp = tmpFile(id)
            ?: return call.reject("this phone's storage is not available right now — please try again")
        if (tmp.exists()) tmp.delete()

        askForNotificationsOnce()

        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val req = DownloadManager.Request(Uri.parse(url))
            .setTitle("CA Parveen Sharma — class download")
            .setDescription("Downloading class for offline viewing")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE)
            .setDestinationInExternalFilesDir(context, null, tmpName(id))
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)
        val dlId = dm.enqueue(req)

        call.setKeepAlive(true)
        // Watch progress while the app is alive. If the app dies mid-download the
        // OS finishes it anyway; the next isDownloaded()/download() finalizes it.
        io.execute {
            try {
                while (true) {
                    Thread.sleep(1500)
                    var status = -1; var received = 0L; var total = 0L
                    dm.query(DownloadManager.Query().setFilterById(dlId))?.use { c ->
                        if (c.moveToFirst()) {
                            status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS))
                            received = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR))
                            total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES))
                        } else status = DownloadManager.STATUS_FAILED
                    } ?: run { status = DownloadManager.STATUS_FAILED }

                    when (status) {
                        DownloadManager.STATUS_SUCCESSFUL -> {
                            val done = encFile(id)
                            if (done == null || !finalizeIfReady(id, expected)) {
                                // Say what is actually wrong. "Please retry" on a
                                // download that arrived short every time is a
                                // student retrying for ever.
                                val got = done?.length() ?: 0L
                                tmpFile(id)?.delete()
                                call.reject(
                                    if (got > 0) "download arrived incomplete ($got of $expected bytes) — please retry"
                                    else "download did not finish — please retry",
                                )
                            } else {
                                val size = done.length()
                                val ev = JSObject(); ev.put("id", id); ev.put("received", size); ev.put("total", size)
                                notifyListeners("downloadProgress", ev)
                                val r = JSObject(); r.put("path", done.absolutePath); call.resolve(r)
                            }
                            return@execute
                        }
                        DownloadManager.STATUS_FAILED -> {
                            val why = failReason(dm, dlId)
                            // DownloadManager is a separate OS service, and it
                            // can decline for reasons that have nothing to do
                            // with this app — disabled by the user, starved by
                            // battery saving, or simply refusing. When it does,
                            // the class does not have to be lost: fetch it here
                            // instead. Worse, because it only runs while the app
                            // is open — but a class that downloads while you
                            // watch beats a class that does not download.
                            if (!retried.contains(id) && !outOfSpace(dm, dlId)) {
                                retried.add(id)
                                if (fetchInApp(id, url, expected, call)) return@execute
                            }
                            call.reject("download failed ($why) — please retry")
                            return@execute
                        }
                        else -> {
                            if (total > 0) {
                                val p = JSObject(); p.put("id", id); p.put("received", received); p.put("total", total)
                                notifyListeners("downloadProgress", p)
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                call.reject("download failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun isDownloaded(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val ok = finalizeIfReady(id, expectedOf(call))
        val r = JSObject(); r.put("value", ok); call.resolve(r)
    }

    @PluginMethod
    fun remove(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        legacyFile(id).delete()   // a class downloaded by the older build
        tmpFile(id)?.delete()     // and one downloaded by this one
        File(context.cacheDir, "play-$id.mp4").delete()
        call.resolve()
    }

    // Present the Android share sheet for a file the web layer fetched
    // (the in-app WebView has no Web Share API, so shares need native help).
    @PluginMethod
    fun shareFile(call: PluginCall) {
        val name = call.getString("name") ?: return call.reject("name required")
        val b64 = call.getString("dataB64") ?: return call.reject("dataB64 required")
        val mime = call.getString("mimeType") ?: "application/pdf"
        try {
            val dir = File(context.cacheDir, "shared"); dir.mkdirs()
            val f = File(dir, name)
            f.writeBytes(Base64.decode(b64, Base64.DEFAULT))
            val uri = androidx.core.content.FileProvider.getUriForFile(context, context.packageName + ".fileprovider", f)
            val send = android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                type = mime
                putExtra(android.content.Intent.EXTRA_STREAM, uri)
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            val chooser = android.content.Intent.createChooser(send, name).apply {
                addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            activity.startActivity(chooser)
            call.resolve()
        } catch (e: Exception) {
            call.reject("share failed: ${e.message}")
        }
    }

    @PluginMethod
    fun decrypt(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val keyB64 = call.getString("keyB64") ?: return call.reject("keyB64 required")
        val ivB64 = call.getString("ivB64")
        val enc = encFile(id) ?: return call.reject("not downloaded")
        call.setKeepAlive(true)
        io.execute {
            try {
                val out = File(context.cacheDir, "play-$id.mp4")
                // Replay instantly: reuse the already-decrypted copy when it
                // matches (decrypted = encrypted minus 1–16 bytes of padding).
                if (out.exists() && out.length() >= enc.length() - 16 && out.length() < enc.length()) {
                    val r0 = JSObject(); r0.put("path", out.absolutePath); call.resolve(r0); return@execute
                }
                val key = Base64.decode(keyB64, Base64.DEFAULT)
                val iv = if (ivB64 != null) Base64.decode(ivB64, Base64.DEFAULT) else ByteArray(16)
                val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
                cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), IvParameterSpec(iv))
                if (out.exists()) out.delete()
                CipherInputStream(enc.inputStream(), cipher).use { cis ->
                    FileOutputStream(out).use { fos ->
                        val buf = ByteArray(4 * 1024 * 1024) // 4 MB — fewer syscalls
                        while (true) {
                            val n = cis.read(buf)
                            if (n < 0) break
                            fos.write(buf, 0, n)
                        }
                    }
                }
                val r = JSObject(); r.put("path", out.absolutePath); call.resolve(r)
            } catch (e: Exception) {
                call.reject("decrypt failed: ${e.message}")
            }
        }
    }
}
