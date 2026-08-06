package com.caclasses.offline

import android.app.DownloadManager
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
//    external files dir. We finalize (verify size + move) either in the watcher
//    thread or lazily on the next isDownloaded() call if the app was killed.
//  - decrypt:  streams AES-256-CBC (PKCS5) to cacheDir/play-<id>.mp4 for the
//    player (the key is supplied per-play by the server and never stored).
@CapacitorPlugin(name = "OfflineClasses")
class OfflineClassesPlugin : Plugin() {

    private val io = Executors.newCachedThreadPool()

    private fun classesDir(): File {
        val dir = File(context.filesDir, "classes")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun encFile(id: String) = File(classesDir(), "$id.enc")
    private fun tmpName(id: String) = "dl-$id.enc"
    private fun tmpFile(id: String) = File(context.getExternalFilesDir(null), tmpName(id))

    // Move a system-download that finished (possibly while the app was dead)
    // into its final place. Returns true when the class is ready to play.
    private fun finalizeIfReady(id: String, expected: Long): Boolean {
        val dest = encFile(id)
        if (dest.exists() && (expected == 0L || dest.length() == expected)) return true
        val tmp = tmpFile(id)
        if (tmp.exists() && (expected == 0L || tmp.length() == expected)) {
            if (dest.exists()) dest.delete()
            if (!tmp.renameTo(dest)) { tmp.copyTo(dest, overwrite = true); tmp.delete() }
            return true
        }
        return false
    }

    private fun expectedOf(call: PluginCall): Long =
        (call.getDouble("expectedSize") ?: 0.0).toLong() // NOT getInt — classes can exceed 2 GB

    @PluginMethod
    fun download(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("id required")
        val url = call.getString("url") ?: return call.reject("url required")
        val expected = expectedOf(call)
        if (finalizeIfReady(id, expected)) {
            val r = JSObject(); r.put("path", encFile(id).absolutePath); return call.resolve(r)
        }
        val tmp = tmpFile(id)
        if (tmp.exists()) tmp.delete()

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
                            if (!finalizeIfReady(id, expected)) {
                                tmpFile(id).delete()
                                call.reject("incomplete download — please retry")
                            } else {
                                val size = encFile(id).length()
                                val done = JSObject(); done.put("id", id); done.put("received", size); done.put("total", size)
                                notifyListeners("downloadProgress", done)
                                val r = JSObject(); r.put("path", encFile(id).absolutePath); call.resolve(r)
                            }
                            return@execute
                        }
                        DownloadManager.STATUS_FAILED -> {
                            call.reject("download failed — check internet and retry")
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
        encFile(id).delete()
        tmpFile(id).delete()
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
        val enc = encFile(id)
        if (!enc.exists()) return call.reject("not downloaded")
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
