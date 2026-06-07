const { app, BrowserWindow, shell, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let tray = null;
let serverProcess = null;
const SERVER_PORT = 3000;
const SERVER_URL = `http://localhost:${SERVER_PORT}`;

// ── Khởi động Node server (server.js) ──
function startServer() {
  const serverPath = path.join(__dirname, 'server.js');
  serverProcess = spawn(process.execPath, [serverPath], {
    cwd: __dirname,
    env: { ...process.env },
    stdio: 'inherit',
  });
  serverProcess.on('error', (err) => console.error('Server error:', err));
}

// ── Chờ server sẵn sàng rồi mới load ──
function waitForServer(retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http.get(SERVER_URL, () => resolve())
        .on('error', () => {
          if (retries-- <= 0) return reject(new Error('Server không khởi động được'));
          setTimeout(attempt, 1000);
        });
    };
    attempt();
  });
}

// ── Tạo cửa sổ chính ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 600,
    title: 'MailBox',
    icon: path.join(__dirname, 'public', 'icon-512.png'),
    backgroundColor: '#0d0d14',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(SERVER_URL);

  // Hiện cửa sổ sau khi load xong (tránh flash trắng)
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Mở link ngoài bằng trình duyệt hệ thống
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Thu nhỏ xuống tray thay vì đóng
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── System Tray ──
function createTray() {
  const iconPath = path.join(__dirname, 'public', 'icon-192.png');
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('MailBox');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mở MailBox', click: () => mainWindow?.show() },
    { type: 'separator' },
    { label: 'Thoát', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('double-click', () => mainWindow?.show());
}

// ── App lifecycle ──
app.whenReady().then(async () => {
  startServer();
  createTray();
  try {
    await waitForServer();
  } catch {
    console.error('Không thể kết nối server sau 10 giây.');
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else mainWindow?.show();
  });
});

app.on('window-all-closed', () => {
  // Trên macOS giữ app sống trong tray
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) serverProcess.kill();
});
