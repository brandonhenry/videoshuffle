window.addEventListener('DOMContentLoaded', () => {
  const selectBtn = document.getElementById('select-files');
  const settingsBtn = document.getElementById('open-settings');
  const processBtn = document.getElementById('process-videos');
  const fileList = document.getElementById('file-list');
  const statusEl = document.getElementById('status');
  const progressBar = document.getElementById('progress-bar');
  const timeRemaining = document.getElementById('time-remaining');
  const resultActions = document.getElementById('result-actions');
  const installFFmpegBtn = document.getElementById('install-ffmpeg');
  const openVideoBtn = document.getElementById('open-video');
  const openFolderBtn = document.getElementById('open-folder');
  const clearHistoryBtn = document.getElementById('clear-history');
  let selectedFiles = [];
  let processingStartTime = null;

  // Settings modal elements
  const settingsModal = document.getElementById('settings-modal');
  const removeAudioCheckbox = document.getElementById('remove-audio');
  const minLengthInput = document.getElementById('min-length');
  const maxLengthInput = document.getElementById('max-length');
  const maxDurationInput = document.getElementById('max-duration');
  const darkModeCheckbox = document.getElementById('dark-mode');
  const saveSettingsBtn = document.getElementById('save-settings');
  const cancelSettingsBtn = document.getElementById('cancel-settings');

  selectBtn.addEventListener('click', async () => {
    const files = await window.electronAPI.openFiles();
    selectedFiles = files;
    fileList.innerHTML = '';
    files.forEach(file => {
      const li = document.createElement('li');
      const videoEl = document.createElement('video');
      videoEl.src = `file://${file}`;
      videoEl.controls = true;
      videoEl.width = 160;
      videoEl.height = 90;
      videoEl.style.objectFit = 'cover';
      li.appendChild(videoEl);
      fileList.appendChild(li);
    });
    // Further processing will be triggered here
  });

  settingsBtn.addEventListener('click', async () => {
    const settings = await window.electronAPI.getSettings();
    removeAudioCheckbox.checked = settings.removeAudio;
    minLengthInput.value = settings.minLength;
    maxLengthInput.value = settings.maxLength;
    darkModeCheckbox.checked = settings.darkMode;
    maxDurationInput.value = formatTime(settings.maxDuration * 1000);
    settingsModal.classList.remove('hidden');
  });

  processBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) {
      statusEl.textContent = 'Please select files first.';
      statusEl.classList.add('error');
      return;
    }
    statusEl.textContent = 'Processing...';
    statusEl.classList.remove('error');
    processingStartTime = Date.now();
    progressBar.hidden = false;
    timeRemaining.hidden = false;
    progressBar.removeAttribute('value');
    resultActions.classList.add('hidden');
    const settings = await window.electronAPI.getSettings();
    try {
      const result = await window.electronAPI.processVideos(selectedFiles, settings);
      if (result.success) {
        progressBar.hidden = true;
        timeRemaining.hidden = true;
        statusEl.textContent = `Video saved to ${result.output}`;
        statusEl.classList.remove('error');
        resultActions.classList.remove('hidden');
        openVideoBtn.addEventListener('click', () => window.electronAPI.openVideo(result.output));
        openFolderBtn.addEventListener('click', () => window.electronAPI.revealVideo(result.output));
        // Save project to history and reload history list
        await window.electronAPI.saveHistory([result.output]);
        loadHistory();
        fileList.innerHTML = '';
      } else {
        statusEl.textContent = 'Processing failed.';
      }
    } catch (err) {
      progressBar.hidden = true;
      timeRemaining.hidden = true;
      statusEl.classList.add('error');
      statusEl.textContent = 'Error: ' + err.message;
    }
  });

  // Save and cancel settings
  saveSettingsBtn.addEventListener('click', async () => {
    const newSettings = {
      removeAudio: removeAudioCheckbox.checked,
      minLength: Number(minLengthInput.value),
      maxLength: Number(maxLengthInput.value),
      darkMode: darkModeCheckbox.checked,
      maxDuration: (() => { const parts = maxDurationInput.value.split(':'); return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10); })()
    };
    await window.electronAPI.setSettings(newSettings);
    document.body.classList.toggle('dark-mode', newSettings.darkMode);
    settingsModal.classList.add('hidden');
  });
  cancelSettingsBtn.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  async function loadSettings() {
    const settings = await window.electronAPI.getSettings();
    console.log('Loaded settings:', settings);
    // Apply theme based on settings
    document.body.classList.toggle('dark-mode', settings.darkMode);
  }
  // Function to load and display previous project history
  async function loadHistory() {
    const history = await window.electronAPI.getHistory();
    const historyListEl = document.getElementById('history-list');
    historyListEl.innerHTML = '';
    history.forEach(entry => {
      const li = document.createElement('li');
      entry.forEach(file => {
        const videoEl = document.createElement('video');
        videoEl.src = `file://${file}`;
        videoEl.controls = true;
        videoEl.width = 160;
        videoEl.height = 90;
        videoEl.style.objectFit = 'cover';
        li.appendChild(videoEl);
      });
      historyListEl.appendChild(li);
    });
  }

  loadSettings();
  // Load and render project history on startup
  loadHistory();
  clearHistoryBtn.addEventListener('click', async () => {
    await window.electronAPI.clearHistory();
    loadHistory();
  });
  // Listen for video processing progress
  window.electronAPI.onProgress((progress) => {
    statusEl.textContent = progress;
    if (progress.startsWith('Overall:')) {
      const match = progress.match(/([\d.]+)%/);
      if (match && processingStartTime) {
        const percent = parseFloat(match[1]);
        progressBar.value = percent;
        const elapsed = Date.now() - processingStartTime;
        const remaining = elapsed * (100 - percent) / percent;
        timeRemaining.textContent = `Time left: ${formatTime(remaining)}`;
      }
    }
  });

  // Install FFmpeg on demand
  installFFmpegBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Installing FFmpeg...';
    statusEl.classList.remove('error');
    try {
      const msg = await window.electronAPI.installFFmpeg();
      statusEl.textContent = msg;
    } catch (err) {
      statusEl.textContent = 'FFmpeg install failed: ' + err.message;
      statusEl.classList.add('error');
    }
  });

});

function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2,'0')}`;
}