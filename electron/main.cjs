'use strict';

const { app, BrowserWindow, dialog, protocol, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs/promises');
const path = require('node:path');

protocol.registerSchemesAsPrivileged([
  { scheme: 'taiba', privileges: { standard: true, secure: true, allowServiceWorkers: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

const APP_SCHEME = 'taiba';
const APP_HOST = 'app';
const APP_ENTRY = 'app/index.html';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
let updatePromptOpen = false;
let updateDownloadInProgress = false;
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.pdf': 'application/pdf',
  '.webmanifest': 'application/manifest+json'
};

let mainWindow;

function appRoot() {
  return app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
}

function isInsideRoot(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function serveLocalApp(request) {
  const url = new URL(request.url);
  if (url.protocol !== APP_SCHEME + ':' || url.hostname !== APP_HOST) {
    return new Response('Not found', { status: 404 });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method not allowed', { status: 405 });
  }

  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { return new Response('Bad request', { status: 400 }); }
  const root = await fs.realpath(appRoot());
  const filePath = path.resolve(root, '.' + pathname);
  if (!isInsideRoot(filePath, root)) return new Response('Forbidden', { status: 403 });

  try {
    // Lexical containment is not enough: a packaged or development asset may
    // be a symlink whose target escapes the application directory.
    const realPath = await fs.realpath(filePath);
    if (!isInsideRoot(realPath, root)) return new Response('Forbidden', { status: 403 });
    const stat = await fs.stat(realPath);
    const resolved = stat.isDirectory() ? await fs.realpath(path.join(realPath, 'index.html')) : realPath;
    if (!isInsideRoot(resolved, root)) return new Response('Forbidden', { status: 403 });
    const body = await fs.readFile(resolved);
    const headers = {
      'Content-Type': MIME_TYPES[path.extname(resolved).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache'
    };
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
  } catch {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

function openSafeExternal(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' || url.protocol === 'mailto:' || url.protocol === 'tel:') {
      return shell.openExternal(url.toString());
    }
  } catch { /* malformed or unsupported URL */ }
  return Promise.resolve();
}


function configureAutoUpdates() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = false;

  autoUpdater.on('error', error => {
    console.error('[Taiba updater]', error);
    // Update failures must never interrupt offline laboratory work.
    updateDownloadInProgress = false;
    updatePromptOpen = false;
  });

  autoUpdater.on('update-available', async info => {
    if (updatePromptOpen || !mainWindow || mainWindow.isDestroyed()) return;
    updatePromptOpen = true;
    try {
      const answer = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'تحديث جديد لطيبة سمارت لاب',
        message: 'يتوفر إصدار جديد من البرنامج: ' + info.version,
        detail: 'لن يتم تنزيل التحديث دون موافقتك. احفظ عملك قبل بدء التنزيل.',
        buttons: ['تنزيل التحديث', 'لاحقًا'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      });
      if (answer.response !== 0) return;
      updateDownloadInProgress = true;
      await autoUpdater.downloadUpdate();
    } catch (error) {
      console.error('[Taiba updater download]', error);
      updateDownloadInProgress = false;
    } finally {
      updatePromptOpen = false;
    }
  });

  autoUpdater.on('update-downloaded', async info => {
    autoUpdater.autoInstallOnAppQuit = true;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const answer = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'التحديث جاهز',
      message: 'تم تنزيل الإصدار ' + info.version + ' والتحقق منه.',
      detail: 'يمكنك إعادة تشغيل البرنامج الآن لتثبيته، أو المتابعة والعمل وتثبيته عند إغلاق البرنامج لاحقًا.',
      buttons: ['إعادة التشغيل والتحديث', 'لاحقًا'],
      defaultId: 0,
      cancelId: 1
    });
    if (answer.response === 0) autoUpdater.quitAndInstall();
  });

  const check = () => {
    if (updateDownloadInProgress) return;
    void autoUpdater.checkForUpdates().catch(error => console.error('[Taiba updater check]', error));
  };
  setTimeout(check, 12_000);
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 960,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f8f7',
    title: 'Taiba Smart Lab',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openSafeExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(APP_SCHEME + '://' + APP_HOST + '/')) {
      event.preventDefault();
      void openSafeExternal(targetUrl);
    }
  });
  mainWindow.webContents.on('will-redirect', (event, targetUrl) => {
    if (!targetUrl.startsWith(APP_SCHEME + '://' + APP_HOST + '/')) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadURL(APP_SCHEME + '://' + APP_HOST + '/' + APP_ENTRY);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    protocol.handle(APP_SCHEME, serveLocalApp);
    app.on('web-contents-created', (_event, contents) => {
      contents.setWindowOpenHandler(({ url }) => {
        void openSafeExternal(url);
        return { action: 'deny' };
      });
      contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      contents.session.setPermissionCheckHandler(() => false);
    });
    configureAutoUpdates();
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  }).catch(error => {
    dialog.showErrorBox('Taiba Smart Lab', 'تعذر تشغيل التطبيق: ' + (error?.message || String(error)));
    app.quit();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
