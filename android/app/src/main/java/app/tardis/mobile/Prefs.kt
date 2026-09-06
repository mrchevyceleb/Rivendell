package app.tardis.mobile

import android.content.Context
import android.net.Uri
import java.net.URI
import java.net.URISyntaxException

/** The one thing this shell remembers: where the ship is. */
object Prefs {
    private const val FILE = "tardis"
    private const val KEY_SERVER = "server_url"

    private val LOOPBACK = setOf("localhost", "127.0.0.1", "::1", "[::1]")
    private val IPV4 = Regex("""\d{1,3}(\.\d{1,3}){3}""")
    private val HAS_SCHEME = Regex("""^[a-zA-Z][a-zA-Z0-9+.-]*://""")

    fun serverUrl(context: Context): String? =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .getString(KEY_SERVER, null)
            ?.takeIf { it.isNotBlank() }

    fun setServerUrl(context: Context, origin: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_SERVER, origin)
            .apply()
    }

    private fun defaultPort(scheme: String): Int = if (scheme == "https") 443 else 80

    private fun looksLikeIp(host: String): Boolean = IPV4.matches(host) || host.startsWith("[")

    /**
     * Turn what a person types into an origin. Bare hosts get a scheme: plain
     * HTTP for loopback and IP literals (a LAN box), HTTPS for names (Tailscale
     * Serve and any real front door). Paths and queries are dropped: the app is
     * always mounted at the origin root.
     */
    fun normalize(raw: String): String? {
        var input = raw.trim()
        if (input.isEmpty()) return null
        if (!HAS_SCHEME.containsMatchIn(input)) {
            val host = input.substringBefore('/').substringBefore(':').lowercase()
            input = (if (host in LOOPBACK || looksLikeIp(host)) "http://" else "https://") + input
        }
        val uri = try {
            URI(input)
        } catch (e: URISyntaxException) {
            return null
        }
        val scheme = uri.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = uri.host?.lowercase() ?: return null
        val port = if (uri.port > 0 && uri.port != defaultPort(scheme)) ":${uri.port}" else ""
        return "$scheme://$host$port"
    }

    fun origin(url: String): String = normalize(url) ?: url

    fun originOf(uri: Uri): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        val port = uri.port
        val portPart = if (port > 0 && port != defaultPort(scheme)) ":$port" else ""
        return "$scheme://$host$portPart"
    }
}
