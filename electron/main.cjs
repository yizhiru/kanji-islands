const { app, BrowserWindow, ipcMain, Menu, protocol, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'islands', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const root = path.resolve(__dirname, '..');
let mainWindow;
const devURL = process.env.KANJI_DEV_URL;
app.setName('汉字岛');

function createWindow() {
  mainWindow = new BrowserWindow({
    title: '汉字岛',
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#f6f5f0',
    icon: path.join(root, 'dist/app-icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedOrigin = devURL ? new URL(devURL).origin : 'islands://app';
    if (!url.startsWith(allowedOrigin + '/')) event.preventDefault();
  });
  mainWindow.on('closed', () => {
    mainWindow = undefined;
  });
  if (devURL) {
    const u = new URL(devURL);
    if (u.hostname !== '127.0.0.1' || u.protocol !== 'http:')
      throw new Error('Development URL must use local HTTP');
    mainWindow.loadURL(devURL);
  } else mainWindow.loadURL('islands://app/index.html');
}

app.whenReady().then(() => {
  protocol.handle('islands', (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
    const dist = path.join(root, 'dist');
    let filename;
    try {
      filename = path.resolve(dist, '.' + decodeURIComponent(url.pathname));
    } catch {
      return new Response('Bad path', { status: 400 });
    }
    if (!filename.startsWith(dist + path.sep)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(filename).href);
  });
  ipcMain.handle('sources:open', async (event, level, page) => {
    if (event.sender !== mainWindow?.webContents) throw new Error('Unknown sender');
    const filename =
      level === '初级' ? 'beginner.pdf' : level === '中级' ? 'intermediate.pdf' : null;
    if (!filename || !Number.isInteger(page) || page < 1 || page > (level === '初级' ? 36 : 64))
      throw new Error('Invalid source page');
    const sources = app.isPackaged
      ? path.join(process.resourcesPath, 'sources')
      : path.join(root, 'public/sources');
    const viewer = new BrowserWindow({
      title: `${level}词汇来源 · 第 ${page} 页`,
      width: 920,
      height: 1000,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    viewer.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    await viewer.loadFile(path.join(sources, filename), { hash: `page=${page}` });
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'editMenu' },
      {
        label: '视图',
        submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }],
      },
      { role: 'windowMenu' },
    ]),
  );
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
