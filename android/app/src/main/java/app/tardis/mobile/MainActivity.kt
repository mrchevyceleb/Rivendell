package app.tardis.mobile

import android.Manifest
import android.annotation.SuppressLint
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.util.concurrent.atomic.AtomicBoolean

/**
 * The whole app: one WebView pointed at the TARDIS server. Everything that
 * matters lives on the server; this activity only keeps the ship reachable,
 * hands links to the right app, lets the console use the microphone, and
 * follows the console theme with the system bars.
 */
class MainActivity : ComponentActivity() {
    private lateinit var root: FrameLayout
    private lateinit var web: WebView
    private var serverUrl = ""
    private var serverOrigin = ""
    private var offlineShown = false
    private var bridgeAttached = false
    private var lastReason = ""
    private val retrying = AtomicBoolean(false)
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingAudio: PermissionRequest? = null

    private val fileChooser =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val callback = fileCallback ?: return@registerForActivityResult
            fileCallback = null
            callback.onReceiveValue(
                WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data),
            )
        }

    private val micPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
            val request = pendingAudio ?: return@registerForActivityResult
            pendingAudio = null
            if (granted) request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else request.deny()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        val url = Prefs.serverUrl(this)
        if (url == null) {
            startActivity(Intent(this, ServerActivity::class.java))
            finish()
            return
        }
        serverUrl = url
        serverOrigin = Prefs.origin(url)

        root = FrameLayout(this).apply { setBackgroundColor(DARK_BG) }
        web = buildWebView()
        root.addView(
            web,
            FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT),
        )
        setContentView(root)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)

        onBackPressedDispatcher.addCallback(this) {
            if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
        }

        loadShip()
    }

    override fun onResume() {
        super.onResume()
        if (::web.isInitialized) web.onResume()
    }

    override fun onPause() {
        if (::web.isInitialized) web.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        if (::web.isInitialized) {
            root.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWebView(): WebView = WebView(this).apply {
        setBackgroundColor(DARK_BG)
        settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = true
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString TARDIS-Android/${BuildConfig.VERSION_NAME}"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        // Theme reports arrive through an origin-scoped message channel, so
        // only top-level pages from the server itself can reach the shell.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(this, THEME_OBJECT, setOf(serverOrigin)) { _, message, _, isMainFrame, _ ->
                if (isMainFrame) applyTheme(message.data == "light")
            }
        }
        webViewClient = ShipClient()
        webChromeClient = ShipChrome()
        setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            download(url, userAgent, contentDisposition, mimeType)
        }
    }

    private fun isShipUrl(uri: Uri): Boolean = Prefs.originOf(uri) == serverOrigin

    private inner class ShipClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            return when (uri.scheme?.lowercase()) {
                "http", "https" -> if (isShipUrl(uri)) false else {
                    openOutside(uri)
                    true
                }
                "file", "about", "blob", "data", "javascript" -> false
                "intent" -> {
                    openIntentUri(uri.toString())
                    true
                }
                else -> {
                    openOutside(uri)
                    true
                }
            }
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame || !isShipUrl(request.url)) return
            showOffline(error.description?.toString().orEmpty())
        }

        override fun onPageFinished(view: WebView, url: String?) {
            if (url == null || !isShipUrl(Uri.parse(url))) return
            if (offlineShown) {
                offlineShown = false
                view.clearHistory()
            }
            view.evaluateJavascript(THEME_HOOK, null)
        }
    }

    private inner class ShipChrome : WebChromeClient() {
        override fun onPermissionRequest(request: PermissionRequest) {
            val wantsMic = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
            val fromShip = Prefs.originOf(request.origin) == serverOrigin
            if (!wantsMic || !fromShip) {
                request.deny()
                return
            }
            val granted = ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) ==
                PackageManager.PERMISSION_GRANTED
            if (granted) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
            } else {
                pendingAudio?.deny()
                pendingAudio = request
                micPermission.launch(Manifest.permission.RECORD_AUDIO)
            }
        }

        override fun onShowFileChooser(
            view: WebView,
            callback: ValueCallback<Array<Uri>>,
            params: FileChooserParams,
        ): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                fileChooser.launch(params.createIntent())
                true
            } catch (e: Exception) {
                fileCallback = null
                false
            }
        }
    }

    /**
     * Exposed to the bundled offline page as `TardisShell`, and to nothing
     * else: it is attached right before that asset loads and removed again
     * before the next server page loads.
     */
    private inner class ShellBridge {
        @JavascriptInterface
        fun serverUrl(): String = serverUrl

        @JavascriptInterface
        fun reason(): String = lastReason

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        @JavascriptInterface
        fun retry() = retryShip()

        @JavascriptInterface
        fun changeServer() {
            runOnUiThread { startActivity(Intent(this@MainActivity, ServerActivity::class.java)) }
        }
    }

    private fun loadShip() {
        if (bridgeAttached) {
            web.removeJavascriptInterface(BRIDGE_OBJECT)
            bridgeAttached = false
        }
        web.loadUrl(serverUrl)
    }

    private fun showOffline(reason: String) {
        offlineShown = true
        lastReason = reason
        if (!bridgeAttached) {
            web.addJavascriptInterface(ShellBridge(), BRIDGE_OBJECT)
            bridgeAttached = true
        }
        web.loadUrl(OFFLINE_PAGE)
    }

    /** Knock before entering: only reload the console once the server answers. */
    private fun retryShip() {
        if (!retrying.compareAndSet(false, true)) return
        Thread {
            val problem = Ship.probe(serverUrl, 4000)
            runOnUiThread {
                retrying.set(false)
                if (isFinishing || isDestroyed) return@runOnUiThread
                if (problem == null) {
                    loadShip()
                } else {
                    lastReason = problem
                    web.evaluateJavascript("window.tardisOffline && window.tardisOffline(${JSONObject.quote(problem)})", null)
                }
            }
        }.start()
    }

    private fun applyTheme(light: Boolean) {
        val color = if (light) LIGHT_BG else DARK_BG
        root.setBackgroundColor(color)
        web.setBackgroundColor(color)
        window.statusBarColor = color
        window.navigationBarColor = color
        WindowInsetsControllerCompat(window, root).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
    }

    private fun openOutside(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        } catch (e: Exception) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
        }
    }

    /** Chrome-style intent:// links, sanitised the way a browser would. */
    private fun openIntentUri(url: String) {
        val intent = try {
            Intent.parseUri(url, Intent.URI_INTENT_SCHEME)
        } catch (e: Exception) {
            Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
            return
        }
        intent.addCategory(Intent.CATEGORY_BROWSABLE)
        intent.component = null
        intent.selector = null
        val fallback = intent.getStringExtra("browser_fallback_url")
            ?.let { Uri.parse(it) }
            ?.takeIf { it.scheme == "http" || it.scheme == "https" }
        try {
            startActivity(intent)
        } catch (e: Exception) {
            if (fallback != null) openOutside(fallback)
            else Toast.makeText(this, R.string.no_app_for_link, Toast.LENGTH_SHORT).show()
        }
    }

    private fun download(url: String, userAgent: String?, contentDisposition: String?, mimeType: String?) {
        if (!url.startsWith("http", ignoreCase = true)) {
            Toast.makeText(this, R.string.download_unsupported, Toast.LENGTH_SHORT).show()
            return
        }
        val name = URLUtil.guessFileName(url, contentDisposition, mimeType)
        val request = DownloadManager.Request(Uri.parse(url)).apply {
            if (!mimeType.isNullOrEmpty()) setMimeType(mimeType)
            if (!userAgent.isNullOrEmpty()) addRequestHeader("User-Agent", userAgent)
            CookieManager.getInstance().getCookie(url)?.let { addRequestHeader("Cookie", it) }
            setTitle(name)
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
        }
        (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
        Toast.makeText(this, getString(R.string.download_started, name), Toast.LENGTH_SHORT).show()
    }

    private companion object {
        const val DARK_BG = 0xFF08080A.toInt()
        const val LIGHT_BG = 0xFFF4F1EA.toInt()
        const val OFFLINE_PAGE = "file:///android_asset/offline.html"
        const val BRIDGE_OBJECT = "TardisShell"
        const val THEME_OBJECT = "TardisTheme"

        // Mirrors the console theme onto the system bars. Idempotent per page.
        const val THEME_HOOK = "(function(){if(window.__tardisThemeHook||!window.TardisTheme)return;window.__tardisThemeHook=true;" +
            "var send=function(){try{TardisTheme.postMessage(document.documentElement.getAttribute('data-theme')==='light'?'light':'dark')}catch(e){}};" +
            "new MutationObserver(send).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});send();})();"
    }
}
