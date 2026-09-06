package app.tardis.mobile

import android.content.Context
import android.net.Uri
import java.net.URI
import java.net.URISyntaxException

/** The one thing this shell remembers: where the ship is. */
object Prefs {
    private const val FILE = "tardis"
    private const val KEY_SERVER = "server_url"

    // Matches the cleartext allowance in res/xml/network_security_config.xml.
    private val LOOPBACK = setOf("localhost", "127.0.0.1", "10.0.2.2")
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

    /**
     * Turn what a person types into an origin. Bare hosts get HTTPS, the only
     * boundary TARDIS trusts off the box; loopback alone defaults to plain HTTP.
     * Paths and queries are dropped: the app is always mounted at the origin root.
     */
    fun normalize(raw: String): String? {
        var input = raw.trim()
        if (input.isEmpty()) return null
        if (!HAS_SCHEME.containsMatchIn(input)) {
            val authority = input.substringBefore('/')
            val host = (if (authority.startsWith("[")) authority.substringBefore(']') + "]" else authority.substringBefore(':')).lowercase()
            input = (if (host in LOOPBACK) "http://" else "https://") + input
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

    /** Plain HTTP is only reachable for the hosts the network policy allows. */
    fun isCleartextAllowed(origin: String): Boolean {
        if (!origin.startsWith("http://")) return true
        val host = origin.removePrefix("http://").substringBefore(':')
        return host in LOOPBACK
    }

    fun originOf(uri: Uri): String? {
        val scheme = uri.scheme?.lowercase() ?: return null
        val host = uri.host?.lowercase() ?: return null
        val port = uri.port
        val portPart = if (port > 0 && port != defaultPort(scheme)) ":$port" else ""
        return "$scheme://$host$portPart"
    }
}
