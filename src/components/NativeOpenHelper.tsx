import { useEffect, useState } from 'react';
import { Download, ExternalLink, X } from 'lucide-react';
import { NATIVE_OPEN_STORAGE_KEY } from '../chat/utils/proxyLinks';
import { nativeShell } from '../native/shell';

// Tiny on-demand panel that explains the one-time install needed for the
// `rivendell://` URL scheme to launch files and web URLs through Windows'
// default-app associations. Linked from the sidebar footer; only the trigger
// renders on Windows (the installer is Windows-only). Dismissal is per-PC.

function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Windows/i.test(navigator.userAgent);
}

export function NativeOpenHelper() {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(NATIVE_OPEN_STORAGE_KEY) === '1';
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // The desktop shell opens files itself; the helper is for browser tabs.
  if (!isWindows() || nativeShell()) return null;

  return (
    <>
      <button
        type="button"
        className="native-open-trigger"
        onClick={() => setOpen(true)}
        title="Open files in native apps and web links in your default Windows browser"
      >
        <Download size={13} />
        <span>{acknowledged ? 'Default apps' : 'Set up default apps'}</span>
      </button>
      {open ? (
        <div className="native-open-overlay" role="dialog" aria-label="Set up Windows default apps">
          <div className="native-open-panel">
            <button
              type="button"
              className="native-open-close"
              onClick={() => setOpen(false)}
              title="Close"
              aria-label="Close"
            >
              <X size={16} />
            </button>
            <h3>Open with your Windows defaults</h3>
            <p>
              One-time setup per Windows PC. Agent web links open in your default browser, and
              workspace files open in their default apps (Word, Excel, Explorer, etc.). If you
              installed an older helper, rerun the latest installer to update or repair it.
            </p>
            <ol>
              <li>
                <a
                  className="native-open-cta"
                  href="/api/files/installer/windows.ps1"
                  download="install-rivendell-handler.ps1"
                >
                  <Download size={14} /> Download installer
                </a>
              </li>
              <li>
                Open PowerShell in the same folder, then run:
                <pre className="native-open-cmd">{'powershell -ExecutionPolicy Bypass -File .\\install-rivendell-handler.ps1'}</pre>
              </li>
              <li>
                Reopen TARDIS. Agent web links now use your default browser; workspace links
                use their default apps. The first click may show a one-time confirmation dialog.
              </li>
            </ol>
            <p className="native-open-hint">
              <ExternalLink size={12} /> If the helper stops responding, TARDIS resets this setting
              and opens that click normally so links never become dead ends.
            </p>
            <button
              type="button"
              className="native-open-ack"
              onClick={() => {
                window.localStorage.setItem(NATIVE_OPEN_STORAGE_KEY, '1');
                setAcknowledged(true);
                setOpen(false);
              }}
            >
              I've installed it
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
