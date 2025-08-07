const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
require('electron-reload')(__dirname);
const { execFile } = require('child_process');

const ffmpegPath = require('ffmpeg-static');
const ffmpeg = require('fluent-ffmpeg');
const ffprobePath = require('ffprobe-static').path;
const os = require('os');
const fs = require('fs');
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);
const { autoUpdater } = require('electron-updater');

// Add helper to load electron-store module from unpacked ASAR in packaged builds
async function loadStore() {
  // Dynamically load electron-store module, handling packaged vs dev paths
  let modulePath;
  if (app.isPackaged) {
    // In a packaged build (asar disabled or otherwise), app.getAppPath() points to 'Resources/app'
    modulePath = path.join(app.getAppPath(), 'node_modules', 'electron-store', 'index.js');
  } else {
    // In development, resolve via require
    modulePath = require.resolve('electron-store');
  }
  const StoreModule = await import(`file://${modulePath}`);
  return StoreModule.default;
}

app.setName('Shufflr');

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'Shufflr',
    icon: path.join(__dirname, 'icon.png'),
    fullscreenable: false,
    fullscreen: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  // Set the dock icon on macOS
  if (app.dock) {
    app.dock.setIcon(path.join(__dirname, 'icon.png'));
  }
  createWindow();
  autoUpdater.checkForUpdatesAndNotify();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('dialog:openFiles', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Media', extensions: ['mp4', 'webp'] }]
  });
  return canceled ? [] : filePaths;
});

ipcMain.handle('settings:get', async () => {
  const Store = await loadStore();
  const store = new Store({ defaults: { removeAudio: false, minLength: 3, maxLength: 5, darkMode: false, maxDuration: 600, history: [] } });
  return store.store;
});

ipcMain.handle('settings:set', async (event, settings) => {
  const Store = await loadStore();
  const store = new Store({ defaults: { removeAudio: false, minLength: 3, maxLength: 5, darkMode: false, maxDuration: 600, history: [] } });
  store.set(settings);
  return store.store;
});

// Helper: get duration via MP4Box
async function getDuration(file) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(file, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

// Helper: extract a timed segment using GPAC's MP4Box CLI
async function extractSegment(file, startTime, duration, outputPath, removeAudio, width, height, fps) {
  return new Promise((resolve, reject) => {
    // Re-encode segment with uniform resolution and fps, capturing stderr
    const stderrLines = [];
    let command = ffmpeg(file)
      .seekInput(startTime)
      .duration(duration)
      .videoCodec('libx264')
      .audioCodec('aac')
      .videoFilters(`scale=${width}:${height},fps=${fps}`)
      .outputOptions('-preset', 'fast', '-crf', '23');
    if (removeAudio) {
      command.noAudio();
    }
    command
      .on('start', cmd => console.log('FFmpeg extract command:', cmd))
      .on('stderr', line => { stderrLines.push(line); console.error('FFmpeg extract stderr:', line); })
      .on('end', resolve)
      .on('error', err => {
        console.error('Segment extraction error:', err);
        reject(new Error(`FFmpeg extract failed: ${stderrLines.join('\n')}`));
      })
      .save(outputPath);
  });
}

// Replace trimming and merging logic with MP4Box-based implementation
ipcMain.handle('videos:process', async (event, files, options) => {
  const tmpDir = os.tmpdir();
  // Probe first file for target resolution and frame rate
  const probeData = await new Promise((res, rej) => ffmpeg.ffprobe(files[0], (err, data) => err ? rej(err) : res(data)));
  const videoStream = probeData.streams.find(s => s.codec_type === 'video');
  const targetW = videoStream.width;
  const targetH = videoStream.height;
  const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
  const targetFps = den ? num / den : 30;
  const clipPaths = [];
  event.sender.send('videos:progress', 'Overall: 0%');

  // Calculate random segments across all files until reaching maxDuration
  const totalDurationSec = options.maxDuration;
  const segments = [];
  let processedTime = 0;
  let segmentIndex = 0;
  while (processedTime < totalDurationSec) {
    // Determine segment length (clamp to remaining overall time)
    let segLen = options.minLength + Math.random() * (options.maxLength - options.minLength);
    const remainingOverall = totalDurationSec - processedTime;
    if (segLen > remainingOverall) segLen = remainingOverall;

    // Pick a random file and compute a random start within its duration
    const fileIndex = Math.floor(Math.random() * files.length);
    const file = files[fileIndex];
    const fileDuration = await getDuration(file);
    const maxStart = fileDuration - segLen;
    const startTime = maxStart > 0 ? Math.random() * maxStart : 0;

    segments.push({ file, startTime, duration: segLen, fileIndex, segmentIndex });
    processedTime += segLen;
    segmentIndex++;
  }
  console.log(`Generated ${segments.length} segments totalling ${processedTime.toFixed(2)}s (expected ${totalDurationSec}s)`);

  // Trim each segment and emit overall progress
  const totalSegments = segments.length;
  let completedSegments = 0;
  for (const seg of segments) {
    const { file, startTime, duration: segLen, fileIndex, segmentIndex } = seg;
    const outputClip = path.join(tmpDir, `clip_${fileIndex}_${segmentIndex}_${Date.now()}.mp4`);
    event.sender.send('videos:progress', `Trimming segment ${completedSegments + 1}/${totalSegments}`);
    // Extract with unified resolution and fps
    await extractSegment(file, startTime, segLen, outputClip, options.removeAudio, targetW, targetH, targetFps);
    clipPaths.push(outputClip);
    completedSegments++;
    const overallPct = (completedSegments / totalSegments) * 100;
    event.sender.send('videos:progress', `Overall: ${overallPct.toFixed(2)}%`);
  }

  // Shuffle clips
  for (let i = clipPaths.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [clipPaths[i], clipPaths[j]] = [clipPaths[j], clipPaths[i]];
  }

  // Merge clips quickly using concat demuxer (stream copy)
  const outputMerged = path.join(tmpDir, `merged_${Date.now()}.mp4`);
  event.sender.send('videos:progress', 'Merging clips...');
  // Create concat playlist
  const playlistFile = path.join(tmpDir, `playlist_${Date.now()}.txt`);
  fs.writeFileSync(playlistFile, clipPaths.map(p => `file '${p}'`).join('\n') + '\n');
  await new Promise((resolve, reject) => {
    const stderrLines = [];
    ffmpeg()
      .input(playlistFile)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions(['-c', 'copy', '-t', options.maxDuration.toString()])
      .on('start', cmd => console.log('FFmpeg merge command:', cmd))
      .on('stderr', line => { stderrLines.push(line); console.error('FFmpeg merge stderr:', line); })
      .on('end', resolve)
      .on('error', err => {
        console.error('Merge error:', err);
        reject(new Error(`FFmpeg merge failed: ${stderrLines.join('\n')}`));
      })
      .save(outputMerged);
  });
  // Clean up temporary clips and playlist
  fs.unlinkSync(playlistFile);
  clipPaths.forEach(p => fs.unlinkSync(p));
  return { success: true, output: outputMerged };
});

// IPC handlers for project history
ipcMain.handle('history:get', async () => {
  const Store = await loadStore();
  const store = new Store({ defaults: { removeAudio: false, minLength: 3, maxLength: 5, darkMode: false, maxDuration: 600, history: [] } });
  return store.get('history', []);
});
ipcMain.handle('history:save', async (event, files) => {
  const Store = await loadStore();
  const store = new Store({ defaults: { removeAudio: false, minLength: 3, maxLength: 5, darkMode: false, maxDuration: 600, history: [] } });
  let history = store.get('history', []);
  history.unshift(files);
  store.set('history', history);
  return history;
});
ipcMain.handle('history:clear', async () => {
  const Store = await loadStore();
  const store = new Store({ defaults: { removeAudio: false, minLength: 3, maxLength: 5, darkMode: false, maxDuration: 600, history: [] } });
  store.set('history', []);
  return [];
});
// One-click FFmpeg install
ipcMain.handle('install-ffmpeg', async () => {
  if (process.platform === 'darwin') {
    return new Promise((resolve, reject) => {
      execFile('brew', ['install', 'ffmpeg'], (error, stdout, stderr) => {
        if (error) reject(stderr || error.message);
        else resolve('Installed via Homebrew');
      });
    });
  } else if (process.platform === 'win32') {
    return new Promise((resolve, reject) => {
      execFile('choco', ['install', 'ffmpeg', '-y'], (error, stdout, stderr) => {
        if (error) reject(stderr || error.message);
        else resolve('Installed via Chocolatey');
      });
    });
  } else {
    throw new Error('Platform not supported');
  }
});
// IPC handlers for opening and revealing the processed video
ipcMain.handle('video:open', (event, filePath) => {
  return shell.openPath(filePath);
});
ipcMain.handle('video:reveal', (event, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});

// Auto-update event handlers
autoUpdater.on('update-available', () => {
  dialog.showMessageBox({
    type: 'info',
    title: 'Update available',
    message: 'A new update is available. Downloading now...'
  });
});
autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox({
    type: 'info',
    buttons: ['Restart', 'Later'],
    title: 'Update Ready',
    message: 'A new update is ready. Restart the app to apply the updates.'
  }).then(({response}) => {
    if (response === 0) autoUpdater.quitAndInstall();
  });
});