package app.tardis.mobile

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.activity.ComponentActivity
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/** First run, and the launcher shortcut: ask where the ship is and prove it answers. */
class ServerActivity : ComponentActivity() {
    private val io: ExecutorService = Executors.newSingleThreadExecutor()
    private lateinit var field: EditText
    private lateinit var go: Button
    private lateinit var skip: TextView
    private lateinit var status: TextView
    private var probing: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_server)
        field = findViewById(R.id.server_url)
        go = findViewById(R.id.connect)
        skip = findViewById(R.id.skip_check)
        status = findViewById(R.id.status)
        findViewById<TextView>(R.id.version).text = getString(R.string.version_line, BuildConfig.VERSION_NAME)

        field.setText(Prefs.serverUrl(this).orEmpty())
        field.setSelection(field.text.length)
        field.setOnEditorActionListener { _, actionId, _ ->
            if (actionId == EditorInfo.IME_ACTION_GO) {
                attempt(verify = true)
                true
            } else {
                false
            }
        }
        go.setOnClickListener { attempt(verify = true) }
        skip.setOnClickListener { attempt(verify = false) }
    }

    private fun attempt(verify: Boolean) {
        if (probing != null) return
        val origin = Prefs.normalize(field.text.toString())
        if (origin == null) {
            status.text = getString(R.string.enter_full_address)
            return
        }
        if (!verify) {
            save(origin)
            return
        }
        probing = origin
        setBusy(true)
        status.text = getString(R.string.materialising)
        io.execute {
            val problem = Ship.probe(origin)
            runOnUiThread {
                if (isFinishing || isDestroyed) return@runOnUiThread
                // Only the address that was actually probed may be saved.
                if (probing != origin) return@runOnUiThread
                probing = null
                setBusy(false)
                if (problem == null) {
                    save(origin)
                } else {
                    status.text = problem
                    skip.visibility = View.VISIBLE
                }
            }
        }
    }

    private fun setBusy(busy: Boolean) {
        go.isEnabled = !busy
        field.isEnabled = !busy
        if (busy) skip.visibility = View.GONE
    }

    private fun save(origin: String) {
        Prefs.setServerUrl(this, origin)
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
        )
        finish()
    }

    override fun onDestroy() {
        io.shutdownNow()
        super.onDestroy()
    }
}
