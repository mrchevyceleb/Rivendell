// Auto-update through GitHub Releases. electron-updater can replace the app
// in place on Windows (NSIS) and Linux (AppImage). macOS requires a signed
// build for in-place updates, so there the menu points at the releases page.
import { app, dialog, shell, type BrowserWindow, type MessageBoxOptions } from 'electron';
import { autoUpdater } from 'electron-updater';

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
let started = false;

export function canAutoUpdate(): boolean {
  if (!app.isPackaged) return false;
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  return false;
}

export function startUpdater(): void {
  if (started || !canAutoUpdate()) return;
  started = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('error', (error) => console.error('[tardis] updater:', error.message));
  const check = () => {
    autoUpdater
      .checkForUpdatesAndNotify({
        title: 'TARDIS has regenerated',
        body: 'Version {version} is downloaded. It installs when you quit.',
      })
      .catch((error: unknown) => console.error('[tardis] update check failed:', error));
  };
  setTimeout(check, 8000);
  setInterval(check, CHECK_EVERY_MS);
}

function tell(win: BrowserWindow | null, options: MessageBoxOptions): Promise<unknown> {
  return win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

export async function checkForUpdatesInteractive(win: BrowserWindow | null, releasesUrl: string): Promise<void> {
  if (!canAutoUpdate()) {
    await shell.openExternal(releasesUrl);
    return;
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    const next = result?.updateInfo?.version;
    if (!next || next === app.getVersion()) {
      await tell(win, {
        type: 'info',
        title: 'TARDIS',
        message: 'TARDIS is up to date.',
        detail: `Type 40 TT Capsule · v${app.getVersion()}`,
      });
      return;
    }
    await tell(win, {
      type: 'info',
      title: 'TARDIS',
      message: `Version ${next} is on its way.`,
      detail: 'It downloads in the background and installs when you quit.',
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await tell(win, {
      type: 'warning',
      title: 'TARDIS',
      message: 'Could not check for updates.',
      detail: reason,
    });
  }
}
