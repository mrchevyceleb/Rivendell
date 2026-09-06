package app.tardis.mobile

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Health probe shared by the address screen and the offline retry loop. */
object Ship {
    /** Returns null when a TARDIS answers at [origin], otherwise a short reason. */
    fun probe(origin: String, timeoutMs: Int = 6000): String? {
        return try {
            val connection = (URL("$origin/api/health").openConnection() as HttpURLConnection).apply {
                connectTimeout = timeoutMs
                readTimeout = timeoutMs
                instanceFollowRedirects = true
                setRequestProperty("Accept", "application/json")
            }
            try {
                val code = connection.responseCode
                if (code != HttpURLConnection.HTTP_OK) return "The server at $origin answered $code."
                val body = connection.inputStream.bufferedReader().use { it.readText() }
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
}
