// main.js
const { app, BrowserWindow, screen, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

let win;
let defaultSpeed = 2; // Default movement speed (pixels per 20ms)
let velocity = { x: defaultSpeed, y: defaultSpeed };
let bounceInterval;
let isDragging = false;
let dragStartBounds = null;
let movementEnabled = false; // Start off stationary
let defaultWindowSize = { width: 640, height: 480 };

// Function to scan for video files in the samples folder
function getVideoFiles(folderPath) {
  try {
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      const readmePath = path.join(folderPath, 'README.txt');
      fs.writeFileSync(readmePath, 'Place your video files in this folder (.mp4, .webm, .ogg, .mov, .mkv supported).');
    }
    const files = fs.readdirSync(folderPath);
    return files
      .filter(file => ['.mp4', '.webm', '.ogg', '.mov', '.mkv']
        .includes(path.extname(file).toLowerCase()))
      .map(file => ({ name: file, path: path.join(folderPath, file) }));
  } catch (error) {
    console.error('Error scanning video files:', error);
    return [];
  }
}

// Show video selection dialog
function showVideoSelectionDialog() {
  const samplesPath = path.join(__dirname, 'samples');
  const videoFiles = getVideoFiles(samplesPath);
  if (videoFiles.length === 0) {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'No Videos Found',
      message: 'No video files found in the samples folder. Please add some videos and restart the app.',
      buttons: ['OK']
    });
    return;
  }

  const videoOptions = videoFiles.map(f => f.name);
  dialog.showMessageBox(win, {
    type: 'question',
    title: 'Select Video',
    message: 'Choose a video to play:',
    buttons: videoOptions,
    cancelId: -1
  }).then(result => {
    if (result.response >= 0) {
      win.webContents.send('change-video', videoFiles[result.response].path);
    }
  });
}

function startBouncing() {
  if (bounceInterval) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  bounceInterval = setInterval(() => {
    if (isDragging) return;
    let b = win.getBounds();
    b.x += velocity.x;
    b.y += velocity.y;
    if (b.x + b.width > width || b.x < 0) velocity.x = -velocity.x;
    if (b.y + b.height > height || b.y < 0) velocity.y = -velocity.y;
    win.setBounds(b);
  }, 20);
}

function stopBouncing() {
  clearInterval(bounceInterval);
  bounceInterval = null;
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const x = Math.floor((width - defaultWindowSize.width) / 2);
  const y = Math.floor((height - defaultWindowSize.height) / 2);

  win = new BrowserWindow({
    width: defaultWindowSize.width,
    height: defaultWindowSize.height,
    x, y,
    frame: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false
    }
  });

  win.loadFile('index.html');
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('default-window-size', defaultWindowSize);
    setTimeout(showVideoSelectionDialog, 500);
  });

  win.webContents.openDevTools({ mode: 'detach' });
  win.on('resize', () => {
    console.log('Window was resized to:', win.getBounds());
  });

  if (movementEnabled) startBouncing();
}

// IPC handlers

ipcMain.on('drag-start', (event, mousePosition) => {
  isDragging = true;
  stopBouncing();
  dragStartBounds = win.getBounds();
});

ipcMain.on('drag-move', (event, dragDelta) => {
  if (!isDragging || !dragStartBounds) return;
  const nb = {
    x: dragStartBounds.x + dragDelta.dx,
    y: dragStartBounds.y + dragDelta.dy,
    width: dragStartBounds.width,
    height: dragStartBounds.height
  };
  win.setBounds(nb);
});

// ← Updated drag-end handler to default data to {}
ipcMain.on('drag-end', (event, data = {}) => {
  isDragging = false;
  // destructure with fallback to defaultSpeed
  const { vx = defaultSpeed, vy = defaultSpeed } = data;

  // if momentum too small, reset to default
  const minMomentum = 0.5;
  if (Math.abs(vx) < minMomentum && Math.abs(vy) < minMomentum) {
    velocity.x = Math.sign(velocity.x) * defaultSpeed;
    velocity.y = Math.sign(velocity.y) * defaultSpeed;
  } else {
    velocity.x = vx;
    velocity.y = vy;
  }

  movementEnabled = false;
  stopBouncing();
});

ipcMain.on('update-speed', (event, newSpeed) => {
  defaultSpeed = newSpeed;
  velocity.x = Math.sign(velocity.x || 1) * newSpeed;
  velocity.y = Math.sign(velocity.y || 1) * newSpeed;
});

ipcMain.on('toggle-movement', () => {
  movementEnabled = !movementEnabled;
  if (movementEnabled) startBouncing();
  else stopBouncing();
});

ipcMain.on('open-video-dialog', showVideoSelectionDialog);

ipcMain.on('get-current-bounds', event => {
  event.reply('current-bounds', win.getBounds());
});

ipcMain.on('set-bounds', (event, bounds) => {
  if (bounds
      && typeof bounds.x === 'number'
      && typeof bounds.y === 'number'
      && typeof bounds.width === 'number'
      && typeof bounds.height === 'number') {
    win.setBounds(bounds);
  }
});

ipcMain.on('reset-to-default-size', () => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const cb = win.getBounds();
  const newX = Math.max(0, cb.x + (cb.width - defaultWindowSize.width) / 2);
  const newY = Math.max(0, cb.y + (cb.height - defaultWindowSize.height) / 2);
  win.setBounds({
    width: defaultWindowSize.width,
    height: defaultWindowSize.height,
    x: Math.min(newX, width - defaultWindowSize.width),
    y: Math.min(newY, height - defaultWindowSize.height)
  });
});

ipcMain.on('update-default-size', (event, newSize) => {
  if (newSize && typeof newSize.width === 'number' && typeof newSize.height === 'number') {
    defaultWindowSize = { width: newSize.width, height: newSize.height };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
