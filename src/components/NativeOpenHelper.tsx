import { useEffect, useState } from 'react';
import { Download, ExternalLink, X } from 'lucide-react';

// Tiny on-demand panel that explains the one-time install needed for the
// `rivendell://` URL scheme to launch files natively on a Windows PC. Linked
// from the sidebar footer; only the trigger renders for non-Windows clients
// (the installer is Windows-only). Dismissal is per-PC via localStorage so
// the user isn't nagged after install.
const STORAGE_KEY = 'rivendell.native-open.installed';

function isWindows(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Windows/i.test(navigator.userAgent);
}

export function NativeOpenHelper() {
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!isWindows()) return null;

  return (
    <>
      <button
        type="button"
        className="native-open-trigger"
        onClick={() => setOpen(true)}
        title="Set up native file opening on this Windows PC"
      >
        <Download size={13} />
        <span>{acknowledged ? 'Native open' : 'Set up native open'}</span>
      </button>
      {open ? (
        <div className="native-open-overlay" role="dialog" aria-label="Set up native file opening">
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
            <h3>Open files natively on Windows</h3>
            <p>
              One-time setup per Windows PC. After this, every file link in Rivendell opens in
              its default Windows app (Word, Excel, Explorer, etc.) instead of the in-app preview.
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
                Refresh Rivendell. Click any file link in Hall — it should open in its native app.
                The first click in each browser may show a one-time confirmation dialog.
              </li>
            </ol>
            <p className="native-open-hint">
              <ExternalLink size={12} /> Browser fallback (the small icon next to each link card) keeps
              working without the installer; it streams the file over Tailscale.
            </p>
            <button
              type="button"
              className="native-open-ack"
              onClick={() => {
                window.localStorage.setItem(STORAGE_KEY, '1');
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
