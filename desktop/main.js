try{require('fs').appendFileSync('/tmp/pm-early.log','ENTRY '+new Date().toISOString()+'\n');}catch(e){}
const _el = require('electron');
const { app, BrowserWindow, ipcMain, screen, Menu, Tray, nativeImage } = _el;
const path = require('path');
const fs = require('fs');

const LOG = '/tmp/pixelmonkey.log';
function log(m){ try{ fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); }catch(e){} }
process.on('uncaughtException', (e)=>{ log('UNCAUGHT: '+(e&&e.stack||e)); });
process.on('exit',(c)=>log('PROCESS EXIT code='+c));
log('=== boot ===');

let win;
let tray = null;
let clickThrough = false;

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const W = 260, H = 300;
  let px = Math.round(width/2 - W/2), py = Math.round(height/2 - H/2);

  win = new BrowserWindow({
    width: W,
    height: H,
    x: px,
    y: py,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    log('window shown at '+px+','+py+' size '+W+'x'+H);
    // 自拍诊断：2 秒后截窗口内容存盘
    setTimeout(() => {
      win.webContents.capturePage().then(img => {
        try { fs.writeFileSync('/tmp/pm-capture.png', img.toPNG()); log('capture saved'); }
        catch(e){ log('capture write err: '+e); }
      }).catch(e => log('capturePage err: '+e));
    }, 2000);
  });

  win.setIgnoreMouseEvents(false);
}

// 注册 ipc 处理（移到函数里，避免模块加载阶段 ipcMain 未就绪）
function registerIpc(){
// 渲染进程告诉主进程：鼠标当前是否在可交互区域（猴子/按钮）上
ipcMain.on('set-ignore-mouse', (e, ignore) => {
  if (!win) return;
  // forward:true 让移动事件仍能穿过，用于 hover 检测
  win.setIgnoreMouseEvents(ignore, { forward: true });
});

// 窗口拖动
ipcMain.on('drag-window', (e, { dx, dy }) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});

ipcMain.on('quit-app', () => app.quit());

// 天气：主进程拉取（绕过渲染进程 CORS）。上海坐标。
ipcMain.handle('get-weather', async () => {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=31.2304&longitude=121.4737&current=temperature_2m,weather_code,relative_humidity_2m,apparent_temperature&timezone=Asia/Shanghai';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await r.json();
    const c = j && j.current || {};
    log('weather ok '+c.temperature_2m+' code '+c.weather_code);
    return { ok:true, temp:c.temperature_2m, feels:c.apparent_temperature, humidity:c.relative_humidity_2m, code:c.weather_code, time:c.time };
  } catch(e) {
    log('weather err: '+(e&&e.message||e));
    return { ok:false, error:String(e&&e.message||e) };
  }
});

// 收起/展开：缩小贴右边缘 / 恢复
let prevBounds = null;
ipcMain.on('resize-window', (e, { w, h, mode }) => {
  if (!win) return;
  const disp = screen.getPrimaryDisplay().workAreaSize;
  if (mode === 'edge') {
    prevBounds = win.getBounds();
    const mw = 92, mh = 100;
    win.setBounds({ x: disp.width - mw + 10, y: Math.round(disp.height/2 - mh/2), width: mw, height: mh });
  } else if (mode === 'restore') {
    if (prevBounds) win.setBounds(prevBounds);
    else {
      const W = 260, H = 300;
      win.setBounds({ x: disp.width - W - 40, y: disp.height - H - 40, width: W, height: H });
    }
  }
});
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'src', 'tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
  } catch (e) {
    log('tray error: '+(e&&e.stack||e));
    try { tray = new Tray(nativeImage.createEmpty()); } catch(e2){ log('tray fallback failed: '+e2); return; }
  }
  const menu = Menu.buildFromTemplate([
    { label: '🐵 像素猴子', enabled: false },
    { type: 'separator' },
    {
      label: '召回到右下角',
      click: () => {
        const { width, height } = screen.getPrimaryDisplay().workAreaSize;
        if (win) win.setPosition(width - 240, height - 260);
      }
    },
    {
      label: '置顶开关',
      type: 'checkbox',
      checked: true,
      click: (item) => { if (win) win.setAlwaysOnTop(item.checked, 'floating'); }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setToolTip('像素猴子');
  tray.setContextMenu(menu);
}

app.whenReady().then(() => {
  log('app ready');
  try { createWindow(); log('window created'); } catch(e){ log('createWindow err: '+(e&&e.stack||e)); }
  try { registerIpc(); log('ipc registered'); } catch(e){ log('registerIpc err: '+(e&&e.stack||e)); }
  try { createTray(); log('tray created'); } catch(e){ log('createTray err: '+(e&&e.stack||e)); }
  if (app.dock) { try{ app.dock.hide(); }catch(e){ log('dock hide err: '+e); } }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Mac 上关掉最后窗口不退出（挂件常驻）
app.on('window-all-closed', () => {
  log('window-all-closed (kept alive)');
});
