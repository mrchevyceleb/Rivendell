package app.tardis.mobile

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/** Health probe shared by the address screen and the offline retry loop. */
object Ship {
    /**
     * Returns null when a TARDIS answers at [origin], otherwise a short reason.
     * Redirects are not followed: the origin that answers is the one trusted.
     */
    fun probe(origin: String, timeoutMs: Int = 6000): String? {
        return try {
            val connection = (URL("$origin/api/health").openConnection() as HttpURLConnection).apply {
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                instanceFollowRedirects = false
                setRequestProperty("Accept", "application/json")
            }
            try {
                val code = connection.responseCode
                if (code in 300..399) return "$origin redirects elsewhere. Enter the address the server actually answers on."
                if (code != HttpURLConnection.HTTP_OK) return "The server at $origin answered $code."
                val body = connection.inputStream.use { readCapped(it, MAX_BODY_BYTES) }
                val json = JSONObject(body)
                if (json.optBoolean("ok") && json.optString("app") == "rivendell") null
                else "That address answers, but it is not a TARDIS."
            } finally {
                connection.disconnect()
            }
        } catch (e: Exception) {
            val detail = e.message?.takeIf { it.isNotBlank() }?.let { ": $it" } ?: ""
            "Couldn't reach $origin (${e.javaClass.simpleName}$detail)."
        }
    }

    /** /api/health is a few hundred bytes; never let a misbehaving host stream forever. */
    private fun readCapped(input: InputStream, limit: Int): String {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        while (out.size() < limit) {
            val read = input.read(buffer, 0, minOf(buffer.size, limit - out.size()))
            if (read < 0) break
            out.write(buffer, 0, read)
        }
        return out.toString(Charsets.UTF_8.name())
    }

    private const val MAX_BODY_BYTES = 64 * 1024
}
