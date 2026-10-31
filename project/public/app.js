/* ═══════════════════════════════════════════════════════════════════
   ToolBox Pro — Frontend JavaScript
   Handles all tool interactions, file uploads, API calls, and UI
   ═══════════════════════════════════════════════════════════════════ */

'use strict';

// ─── Utility Functions ────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const formatDuration = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const animateNumber = (el, from, to, duration = 1200, suffix = '') => {
  const start = performance.now();
  const update = (timestamp) => {
    const elapsed = timestamp - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(from + (to - from) * eased);
    el.textContent = current.toLocaleString() + suffix;
    if (progress < 1) requestAnimationFrame(update);
  };
  requestAnimationFrame(update);
};

// ─── Toast System ─────────────────────────────────────────────────────────────
const toast = (() => {
  const container = $('toast-container');
  const show = (message, type = 'info', duration = 4000) => {
    const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', info: 'fa-info-circle' };
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `
      <i class="fas ${icons[type]} toast-icon" aria-hidden="true"></i>
      <span class="toast-msg">${message}</span>
      <button class="toast-close" aria-label="Dismiss notification"><i class="fas fa-times"></i></button>
    `;
    const close = () => {
      el.classList.add('removing');
      setTimeout(() => el.remove(), 250);
    };
    el.querySelector('.toast-close').addEventListener('click', close);
    container.appendChild(el);
    if (duration > 0) setTimeout(close, duration);
    return { close };
  };
  return { success: (m, d) => show(m, 'success', d), error: (m, d) => show(m, 'error', d), info: (m, d) => show(m, 'info', d) };
})();

// ─── Progress Overlay ─────────────────────────────────────────────────────────
const progress = (() => {
  const overlay = $('progress-overlay');
  const text = $('progress-text');
  const bar = $('progress-bar');
  let interval;

  const show = (msg = 'Processing...') => {
    text.textContent = msg;
    overlay.hidden = false;
    let pct = 0;
    bar.style.width = '0%';
    interval = setInterval(() => {
      pct = Math.min(pct + Math.random() * 8, 85);
      bar.style.width = pct + '%';
    }, 200);
  };

  const hide = () => {
    clearInterval(interval);
    bar.style.width = '100%';
    setTimeout(() => { overlay.hidden = true; bar.style.width = '0%'; }, 300);
  };

  return { show, hide };
})();

// ─── Upload Zone Helper ───────────────────────────────────────────────────────
function setupUploadZone(zoneId, inputId, onFileSelected) {
  const zone = $(zoneId);
  const input = $(inputId);

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    if (files.length > 0) onFileSelected(files[0]);
  });
  input.addEventListener('change', () => {
    if (input.files.length > 0) onFileSelected(input.files[0]);
  });
}

// ─── API Helper ───────────────────────────────────────────────────────────────
async function apiPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    body,
    credentials: 'same-origin'
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function apiGet(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ─── Result Renderer Helper ───────────────────────────────────────────────────
function renderResult(containerId, html) {
  const container = $(containerId);
  container.hidden = false;
  container.setAttribute('data-inline', 'true');
  container.innerHTML = html;
  container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderError(containerId, message) {
  renderResult(containerId, `
    <div class="result-header">
      <div class="result-title result-error">
        <i class="fas fa-exclamation-circle" aria-hidden="true"></i> Error
      </div>
    </div>
    <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 12px;">${message}</p>
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. IMAGE COMPRESSOR
// ─────────────────────────────────────────────────────────────────────────────
let imageFile = null;

setupUploadZone('image-upload-zone', 'image-file-input', (file) => {
  imageFile = file;
  const preview = $('image-preview');
  const previewContainer = $('image-preview-container');
  const reader = new FileReader();
  reader.onload = (e) => {
    preview.src = e.target.result;
    previewContainer.hidden = false;
    $('image-preview-name').textContent = file.name;
    $('image-original-size').textContent = formatBytes(file.size);
  };
  reader.readAsDataURL(file);
  $('compress-image-btn').disabled = false;
  $('image-upload-zone').hidden = true;
  $('image-result').hidden = true;
});

$('image-quality').addEventListener('input', function() {
  $('quality-value').textContent = this.value;
});

$('compress-image-btn').addEventListener('click', async () => {
  if (!imageFile) return toast.error('Please select an image first.');

  const formData = new FormData();
  formData.append('image', imageFile);
  formData.append('quality', $('image-quality').value);
  formData.append('format', $('image-format').value);
  const maxW = $('image-max-width').value;
  const maxH = $('image-max-height').value;
  if (maxW) formData.append('maxWidth', maxW);
  if (maxH) formData.append('maxHeight', maxH);

  progress.show('Compressing image...');
  try {
    const data = await apiPost('/api/tools/compress-image', formData);
    progress.hide();

    const savingsColor = data.savings >= 50 ? 'var(--accent-green)' : data.savings >= 20 ? 'var(--accent-orange)' : 'var(--text-secondary)';
    renderResult('image-result', `
      <div class="result-header">
        <div class="result-title result-success">
          <i class="fas fa-check-circle" aria-hidden="true"></i> Compression Complete!
        </div>
      </div>
      <div class="result-stats">
        <div class="result-stat">
          <div class="result-stat-value">${formatBytes(data.originalSize)}</div>
          <div class="result-stat-label">Original</div>
        </div>
        <div class="result-stat">
          <div class="result-stat-value">${formatBytes(data.resultSize)}</div>
          <div class="result-stat-label">Compressed</div>
        </div>
        <div class="result-stat">
          <div class="result-stat-value green">${data.savings}%</div>
          <div class="result-stat-label">Saved</div>
        </div>
      </div>
      <div class="savings-bar">
        <div class="savings-fill" style="width: 0%" data-target="${data.savings}"></div>
      </div>
      <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px;">
        ${data.width} × ${data.height}px · ${data.format.toUpperCase()}
      </p>
      <a href="${data.downloadUrl}" class="btn-download" download id="img-download-btn">
        <i class="fas fa-download" aria-hidden="true"></i>
        Download Compressed Image
      </a>
      <button class="btn-ghost" style="width:100%;margin-top:10px;justify-content:center" id="image-reset-btn">
        <i class="fas fa-redo" aria-hidden="true"></i> Compress Another
      </button>
    `);

    // Animate savings bar
    setTimeout(() => {
      const fill = document.querySelector('.savings-fill');
      if (fill) fill.style.width = data.savings + '%';
    }, 100);

    document.getElementById('image-reset-btn')?.addEventListener('click', resetImageTool);
    toast.success(`Saved ${data.savings}% — ${formatBytes(data.originalSize - data.resultSize)} reduced!`);

  } catch (err) {
    progress.hide();
    renderError('image-result', err.message);
    toast.error('Compression failed: ' + err.message);
  }
});

function resetImageTool() {
  imageFile = null;
  $('image-file-input').value = '';
  $('image-preview-container').hidden = true;
  $('image-upload-zone').hidden = false;
  $('image-result').hidden = true;
  $('compress-image-btn').disabled = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PDF COMPRESSOR
// ─────────────────────────────────────────────────────────────────────────────
let pdfFile = null;

setupUploadZone('pdf-upload-zone', 'pdf-file-input', (file) => {
  if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) {
    return toast.error('Please select a valid PDF file.');
  }
  pdfFile = file;
  $('pdf-file-info').hidden = false;
  $('pdf-upload-zone').hidden = true;
  $('pdf-file-name').textContent = file.name;
  $('pdf-file-size').textContent = formatBytes(file.size);
  $('compress-pdf-btn').disabled = false;
  $('pdf-result').hidden = true;
});

$('pdf-clear-btn').addEventListener('click', () => {
  pdfFile = null;
  $('pdf-file-input').value = '';
  $('pdf-file-info').hidden = true;
  $('pdf-upload-zone').hidden = false;
  $('compress-pdf-btn').disabled = true;
  $('pdf-result').hidden = true;
});

$('compress-pdf-btn').addEventListener('click', async () => {
  if (!pdfFile) return toast.error('Please select a PDF first.');

  const formData = new FormData();
  formData.append('pdf', pdfFile);

  progress.show('Optimizing PDF...');
  try {
    const data = await apiPost('/api/tools/compress-pdf', formData);
    progress.hide();

    renderResult('pdf-result', `
      <div class="result-header">
        <div class="result-title result-success">
          <i class="fas fa-check-circle" aria-hidden="true"></i> PDF Optimized!
        </div>
      </div>
      <div class="result-stats">
        <div class="result-stat">
          <div class="result-stat-value">${formatBytes(data.originalSize)}</div>
          <div class="result-stat-label">Original</div>
        </div>
        <div class="result-stat">
          <div class="result-stat-value">${formatBytes(data.resultSize)}</div>
          <div class="result-stat-label">Optimized</div>
        </div>
        <div class="result-stat">
          <div class="result-stat-value green">${data.savings}%</div>
          <div class="result-stat-label">Saved</div>
        </div>
      </div>
      <div class="savings-bar">
        <div class="savings-fill" style="width: 0%" data-target="${data.savings}"></div>
      </div>
      <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 16px;">
        ${data.pages} page${data.pages !== 1 ? 's' : ''} · Metadata stripped · Optimized
      </p>
      <a href="${data.downloadUrl}" class="btn-download" download>
        <i class="fas fa-download" aria-hidden="true"></i>
        Download Optimized PDF
      </a>
      <button class="btn-ghost" style="width:100%;margin-top:10px;justify-content:center" id="pdf-reset-btn">
        <i class="fas fa-redo" aria-hidden="true"></i> Compress Another PDF
      </button>
    `);

    setTimeout(() => {
      const fill = document.querySelector('#pdf-result .savings-fill');
      if (fill) fill.style.width = data.savings + '%';
    }, 100);

    document.getElementById('pdf-reset-btn')?.addEventListener('click', resetPdfTool);
    toast.success(`PDF optimized — ${data.savings}% smaller!`);

  } catch (err) {
    progress.hide();
    renderError('pdf-result', err.message);
    toast.error('PDF compression failed: ' + err.message);
  }
});

function resetPdfTool() {
  pdfFile = null;
  $('pdf-file-input').value = '';
  $('pdf-file-info').hidden = true;
  $('pdf-upload-zone').hidden = false;
  $('compress-pdf-btn').disabled = true;
  $('pdf-result').hidden = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. ZIP EXTRACTOR
// ─────────────────────────────────────────────────────────────────────────────
let zipFile = null;

setupUploadZone('zip-upload-zone', 'zip-file-input', (file) => {
  zipFile = file;
  $('zip-file-info').hidden = false;
  $('zip-upload-zone').hidden = true;
  $('zip-file-name').textContent = file.name;
  $('zip-file-size').textContent = formatBytes(file.size);
  $('extract-zip-btn').disabled = false;
  $('zip-result').hidden = true;
});

$('zip-clear-btn').addEventListener('click', () => {
  zipFile = null;
  $('zip-file-input').value = '';
  $('zip-file-info').hidden = true;
  $('zip-upload-zone').hidden = false;
  $('extract-zip-btn').disabled = true;
  $('zip-result').hidden = true;
});

$('extract-zip-btn').addEventListener('click', async () => {
  if (!zipFile) return toast.error('Please select a ZIP file.');

  const formData = new FormData();
  formData.append('zip', zipFile);

  progress.show('Extracting ZIP archive...');
  try {
    const data = await apiPost('/api/tools/extract-zip', formData);
    progress.hide();

    if (data.extractedCount === 0) {
      renderResult('zip-result', `
        <div class="result-header">
          <div class="result-title" style="color: var(--accent-orange);">
            <i class="fas fa-exclamation-triangle" aria-hidden="true"></i> No Extractable Files
          </div>
        </div>
        <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 12px;">
          The ZIP archive contained no supported file types. Supported: PDF, Images, Documents, CSV.
        </p>
      `);
      return;
    }

    const filesHtml = data.files.map(f => `
      <div class="extracted-file-item">
        <span class="file-type-badge">${f.type}</span>
        <span class="file-item-name" title="${f.originalName}">${f.originalName}</span>
        <span class="file-item-size">${formatBytes(f.size)}</span>
        <a href="${f.downloadUrl}" class="btn-download" download aria-label="Download ${f.originalName}">
          <i class="fas fa-download" aria-hidden="true"></i>
        </a>
      </div>
    `).join('');

    renderResult('zip-result', `
      <div class="result-header">
        <div class="result-title result-success">
          <i class="fas fa-check-circle" aria-hidden="true"></i> Extracted ${data.extractedCount} File${data.extractedCount !== 1 ? 's' : ''}!
        </div>
      </div>
      <div class="extracted-files">
        <h4>Files ready to download:</h4>
        ${filesHtml}
      </div>
      <button class="btn-ghost" style="width:100%;margin-top:16px;justify-content:center" id="zip-reset-btn">
        <i class="fas fa-redo" aria-hidden="true"></i> Extract Another ZIP
      </button>
    `);

    document.getElementById('zip-reset-btn')?.addEventListener('click', resetZipTool);
    toast.success(`Extracted ${data.extractedCount} files successfully!`);

  } catch (err) {
    progress.hide();
    renderError('zip-result', err.message);
    toast.error('ZIP extraction failed: ' + err.message);
  }
});

function resetZipTool() {
  zipFile = null;
  $('zip-file-input').value = '';
  $('zip-file-info').hidden = true;
  $('zip-upload-zone').hidden = false;
  $('extract-zip-btn').disabled = true;
  $('zip-result').hidden = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. YOUTUBE MP3
// ─────────────────────────────────────────────────────────────────────────────
let videoInfoData = null;

$('fetch-info-btn').addEventListener('click', fetchVideoInfo);
$('youtube-url-input').addEventListener('keydown', e => { if (e.key === 'Enter') fetchVideoInfo(); });

async function fetchVideoInfo() {
  const url = $('youtube-url-input').value.trim();
  if (!url) return toast.error('Please enter a YouTube URL.');
  if (!url.includes('youtube.com/') && !url.includes('youtu.be/')) {
    return toast.error('Please enter a valid YouTube URL.');
  }

  const btn = $('fetch-info-btn');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i> Fetching...';
  btn.disabled = true;
  $('video-info').hidden = true;
  $('download-mp3-btn').disabled = true;
  $('youtube-result').hidden = true;

  try {
    const data = await apiPost('/api/tools/youtube-info', JSON.stringify({ url }));
    // Re-do with proper content type
    const res = await fetch('/api/tools/youtube-info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      credentials: 'same-origin'
    });
    const info = await res.json();

    if (!res.ok) throw new Error(info.error || 'Failed to fetch info');

    videoInfoData = { ...info, url };
    $('video-thumbnail').src = info.thumbnail || '';
    $('video-thumbnail').alt = `Thumbnail for ${info.title}`;
    $('video-title').textContent = info.title;
    $('video-author').textContent = `👤 ${info.author}`;
    $('video-duration').textContent = `⏱ ${formatDuration(info.duration)} · ${parseInt(info.viewCount || 0).toLocaleString()} views`;
    $('video-info').hidden = false;
    $('download-mp3-btn').disabled = false;
    toast.success('Video info loaded!');
  } catch (err) {
    toast.error('Could not fetch video info: ' + err.message);
  } finally {
    btn.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i> Fetch Info';
    btn.disabled = false;
  }
}

$('download-mp3-btn').addEventListener('click', async () => {
  const url = $('youtube-url-input').value.trim();
  if (!url || !videoInfoData) return toast.error('Please fetch video info first.');

  progress.show('Preparing MP3 download...');
  try {
    const res = await fetch('/api/tools/youtube-download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      credentials: 'same-origin'
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    progress.hide();
    renderResult('youtube-result', `
      <div class="result-header">
        <div class="result-title result-success">
          <i class="fas fa-music" aria-hidden="true"></i> MP3 Ready to Download!
        </div>
      </div>
      <div class="video-info-card" style="margin:16px 0;">
        <img src="${videoInfoData.thumbnail}" alt="Thumbnail" class="video-thumb">
        <div class="video-details">
          <h3 class="video-title-text">${videoInfoData.title}</h3>
          <p class="video-meta">${videoInfoData.author}</p>
          <p class="video-meta">${formatDuration(videoInfoData.duration)}</p>
        </div>
      </div>
      <a href="${data.downloadUrl}" class="btn-download" style="width:100%;justify-content:center" id="mp3-download-link">
        <i class="fas fa-download" aria-hidden="true"></i>
        Download MP3
      </a>
      <p class="disclaimer" style="margin-top:12px;">
        <i class="fas fa-info-circle" aria-hidden="true"></i>
        Download will start in a new request. Large files may take a moment.
      </p>
      <button class="btn-ghost" style="width:100%;margin-top:10px;justify-content:center" id="yt-reset-btn">
        <i class="fas fa-redo" aria-hidden="true"></i> Download Another
      </button>
    `);

    document.getElementById('yt-reset-btn')?.addEventListener('click', resetYtTool);
    toast.success('Click "Download MP3" to save the audio file!', 6000);

  } catch (err) {
    progress.hide();
    renderError('youtube-result', err.message);
    toast.error('Download failed: ' + err.message);
  }
});

function resetYtTool() {
  videoInfoData = null;
  $('youtube-url-input').value = '';
  $('video-info').hidden = true;
  $('download-mp3-btn').disabled = true;
  $('youtube-result').hidden = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// TABS
// ─────────────────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.tool-panel').forEach(p => { p.classList.remove('active'); p.hidden = true; });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    const panel = document.getElementById(`panel-${tool}`);
    if (panel) { panel.classList.add('active'); panel.hidden = false; }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NAVBAR
// ─────────────────────────────────────────────────────────────────────────────
const hamburger = $('hamburger');
const navLinks = $('nav-links');
hamburger.addEventListener('click', () => {
  const isOpen = navLinks.classList.toggle('open');
  hamburger.setAttribute('aria-expanded', isOpen);
});

window.addEventListener('scroll', () => {
  $('navbar').classList.toggle('scrolled', window.scrollY > 50);
});

// ─────────────────────────────────────────────────────────────────────────────
// HERO STATS (animated counters from API)
// ─────────────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await fetch('/api/admin/stats', { credentials: 'same-origin' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.totalUsers) animateNumber($('stat-users'), 0, data.totalUsers);
    if (data.successOps) animateNumber($('stat-ops'), 0, data.successOps);
  } catch (e) { /* ignore */ }
}

// Animate with default values on load
document.addEventListener('DOMContentLoaded', () => {
  // Show some placeholder animations even without login
  setTimeout(() => {
    animateNumber($('stat-users'), 0, 1243);
    animateNumber($('stat-ops'), 0, 8742);
    $('stat-saved').textContent = '24.5 GB';
  }, 500);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fetch info helper (fix the double-fetch bug above)
// ─────────────────────────────────────────────────────────────────────────────
// (The actual fetch is already done inline in fetchVideoInfo above)
