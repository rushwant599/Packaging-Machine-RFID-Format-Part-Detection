let rfidTags = [];
let formatParts = []; // Dynamic format parts from API
let assignments = {}; // Format part -> RFID tag assignments from database

// API configuration: prefer same-origin under HTTPS/nginx, else dev fallback to :8001
const API_BASE_URL = (() => {
  try {
    const { protocol, hostname, port } = window.location;
    const isStandard = (protocol === 'https:' && (!port || port === '443')) || (protocol === 'http:' && (!port || port === '80'));
    if (protocol === 'https:' || isStandard) {
      return `${protocol}//${hostname}`; // nginx reverse proxy
    }
    return `${protocol}//${hostname}:8001`; // local dev direct backend
  } catch {
    return 'http://localhost:8001';
  }
})();

// Mirror backend _sanitize_part: replace any non [A-Za-z0-9_\-] with '_'
function sanitizeFormatPartId(id) {
  if (id == null) return '';
  return String(id).trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
}

function isLocalhostHost(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.localhost');
}

function isSecureForCamera() {
  // getUserMedia requires a secure context (HTTPS) except on localhost
  try {
    if (typeof window !== 'undefined') {
  const { protocol, hostname } = window.location;
      if (window.isSecureContext) return true;
      if (protocol === 'https:') return true;
      if (isLocalhostHost(hostname)) return true;
      // Also allow when served via http but behind a reverse proxy that terminates TLS and forwards as http with private IP
      // In such cases, browsers still block camera on http, so return false to show guidance.
    }
  } catch {}
  return false;
}

async function loadFormatParts() {
  try {
    console.log('Loading format parts from API...');
    const response = await fetch(`${API_BASE_URL}/api/format-parts`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Format parts loaded:', data);
    
    if (data.formatParts && Array.isArray(data.formatParts)) {
      formatParts = data.formatParts.map(part => ({ id: part }));
      console.log(`Loaded ${formatParts.length} format parts:`, formatParts);
      updatePartsDisplay();
    } else {
      console.warn('No format parts found in API response');
      // Fallback to empty array
      formatParts = [];
      updatePartsDisplay();
    }
  } catch (error) {
    console.error('Error loading format parts:', error);
    // Fallback to static data if API fails
    formatParts = [
      { id: '1A1' }, { id: '2A1' }, { id: '3A2' },
      { id: '2B1' }, { id: '3C2' }, { id: '4D3' },
    ];
    console.log('Using fallback format parts');
    updatePartsDisplay();
  }
}

async function readRFIDTags() {
  try {
    console.log('Loading RFID tags from backend...');
    const response = await fetch(`${API_BASE_URL}/api/rfid-tag-ids`);
    if (!response.ok) throw new Error(`HTTP error ${response.status}`);
    const data = await response.json();
    if (data.success && Array.isArray(data.tagIds)) {
      rfidTags = ["", ...data.tagIds];
      console.log(`Loaded ${data.tagIds.length} RFID tags.`);
      updateDropdowns();
      return;
    }
    console.warn('Unexpected RFID tags response structure', data);
  } catch (e) {
    console.error('Error loading RFID tags', e);
  }
  // Fallback: keep existing rfidTags (no static demo values anymore)
  if (!rfidTags.length) {
    rfidTags = [""]; // only unassigned option
  }
  updateDropdowns();
}

function updateDropdowns() {
  const partRows = document.querySelectorAll('.rfid-select');
  // Build reverse map: tagId -> formatPart it's assigned to
  const assignedByTag = {};
  Object.keys(assignments || {}).forEach(part => {
    const tag = assignments[part];
    if (tag) assignedByTag[tag] = part;
  });

  partRows.forEach(select => {
    const prevValue = select.value;
    const partId = select.id.replace('select-', '');
    const currentAssigned = assignments[partId] || "";

    // Clear existing
    select.innerHTML = '';

    // 1) Always add unassigned first
    const optEmpty = document.createElement('option');
    optEmpty.value = "";
    optEmpty.textContent = "(unassigned)";
    select.appendChild(optEmpty);

    // 2) If this part already has a tag, add it next (enabled).
    if (currentAssigned) {
      const optCurr = document.createElement('option');
      optCurr.value = currentAssigned;
      optCurr.textContent = `${currentAssigned} (assigned)`;
      // Green highlight for assigned
      optCurr.style.backgroundColor = '#d4edda';
      optCurr.style.color = '#155724';
      select.appendChild(optCurr);
    }

    // 3) Add all available tags (not assigned anywhere)
    const available = rfidTags.filter(t => t && t !== currentAssigned && !assignedByTag[t]);
    available.forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      select.appendChild(opt);
    });

    // 4) Add all tags assigned to other parts at the end, disabled + green
    const usedElsewhere = rfidTags.filter(t => t && t !== currentAssigned && assignedByTag[t]);
    usedElsewhere.forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = `${tag} (assigned to ${assignedByTag[tag]})`;
      opt.disabled = true;
      opt.style.backgroundColor = '#d4edda';
      opt.style.color = '#155724';
      select.appendChild(opt);
    });

    // Restore selection priority: 1) current assignment 2) previous if still enabled 3) empty
    if (currentAssigned) {
      select.value = currentAssigned;
    } else if (prevValue) {
      // Find matching option and ensure it's not disabled
      let canSelectPrev = false;
      for (const opt of select.options) {
        if (opt.value === prevValue && !opt.disabled) {
          canSelectPrev = true;
          break;
        }
      }
      select.value = canSelectPrev ? prevValue : "";
    } else {
      select.value = "";
    }
  });
}

async function assignRFID(partId) {
  const select = document.getElementById('select-' + partId);
  const value = select.value;
  const checkbox = document.getElementById('check-' + partId);
  
  // Save to database
  const success = await saveAssignment(partId, value);
  
  if (success) {
    checkbox.checked = value !== "";
    checkAllAssigned();
    // Refresh dropdowns to reflect disabled/green states and prevent selecting used tags
    updateDropdowns();
  } else {
    // Revert on error
    alert('Fehler beim Speichern der Zuordnung');
    select.value = assignments[partId] || "";
  }
}

function checkAllAssigned() {
  const checkboxes = document.querySelectorAll('.assign-check');
  const allChecked = [...checkboxes].every(cb => cb.checked);
  document.getElementById('final-check').checked = allChecked;
}

function updateAssignmentDisplay() {
  // Update checkboxes based on assignments
  formatParts.forEach(p => {
    const checkbox = document.getElementById('check-' + p.id);
    if (checkbox) {
      checkbox.checked = !!assignments[p.id];
    }
  });
  checkAllAssigned();
}

function updatePartsDisplay() {
  const allList = document.getElementById('format-parts-list');
  const assignedList = document.getElementById('assigned-parts-list');
  
  if (!allList || !assignedList) {
    console.error('Required DOM elements not found');
    return;
  }
  
  // Clear existing content
  allList.innerHTML = '';
  assignedList.innerHTML = '';
  if (formatParts.length === 0) {
    allList.innerHTML = '<div class="no-parts">No format parts available. Please upload an HTML file first.</div>';
    assignedList.innerHTML = '<div class="no-parts">No parts to assign.</div>';
    return;
  }
  
  formatParts.forEach(p => {
    // Right side - All Parts
    const row = document.createElement('div');
    row.className = 'part-entry';
    row.innerHTML = `
      <label>${p.id}</label>
      <select id="select-${p.id}" class="rfid-select"></select>
      <button onclick="assignRFID('${p.id}')">Assign</button>
    `;
    allList.appendChild(row);

    // Left side - Assigned Parts
    const assigned = document.createElement('div');
    assigned.className = 'part-entry';
    assigned.innerHTML = `
      <label>${p.id}</label>
      <input type="checkbox" id="check-${p.id}" class="assign-check" disabled>
      <button onClick="showPicture('${p.id}')">Show picture</button>
  <button onClick="openUpload('${p.id}')">Upload</button>
    `;
    assignedList.appendChild(assigned);
  });
  
  // Update dropdowns with RFID tags
  updateDropdowns();
  
  // Update assignment display
  updateAssignmentDisplay();
  
  console.log(`Updated display with ${formatParts.length} format parts`);
}

async function refreshFormatParts() {
  console.log('Refreshing format parts and assignments...');
  await loadFormatParts();
  await loadAssignments();
}

// Load assignments from database
async function loadAssignments() {
  try {
    console.log('Loading assignments from database...');
    const response = await fetch(`${API_BASE_URL}/api/format-assignments`);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log('Assignments loaded:', data);
    
    if (data.success && data.assignments) {
      assignments = data.assignments;
      console.log(`Loaded ${Object.keys(assignments).length} assignments:`, assignments);
      updateAssignmentDisplay();
      updateDropdowns();
    } else {
      console.warn('No assignments found in API response');
      assignments = {};
      updateAssignmentDisplay();
      updateDropdowns();
    }
  } catch (error) {
    console.error('Error loading assignments:', error);
    assignments = {};
    updateAssignmentDisplay();
    updateDropdowns();
  }
}

// Save assignment to database
async function saveAssignment(formatPart, rfidTagId) {
  try {
    console.log(`Saving assignment: ${formatPart} -> ${rfidTagId}`);
    
    if (!rfidTagId || rfidTagId === "") {
      // Unassign RFID from format part
      const response = await fetch(`${API_BASE_URL}/api/format-assignments/${formatPart}`, {
        method: 'DELETE'
      });
      
      if (response.ok) {
        delete assignments[formatPart];
        console.log(`Unassigned RFID from ${formatPart}`);
        return true;
      } else {
        console.error('Failed to unassign RFID');
        return false;
      }
    } else {
      // Assign RFID to format part
      const response = await fetch(`${API_BASE_URL}/api/format-assignments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          format_part: formatPart,
          rfid_tag_id: rfidTagId
        })
      });
      
      if (response.ok) {
        assignments[formatPart] = rfidTagId;
        console.log(`Assigned ${rfidTagId} to ${formatPart}`);
        return true;
      } else {
        console.error('Failed to save assignment');
        return false;
      }
    }
  } catch (error) {
    console.error('Error saving assignment:', error);
    return false;
  }
}

// Config for showPicture
let currentIndex = 0;
let matchedPictures = [];

const preview = document.getElementById("preview");
preview.addEventListener("click", hidePicture);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hidePicture();
  if (event.key === "ArrowLeft") showPrevious();
  if (event.key === "ArrowRight") showNext();
});

async function showPicture(id) {
  try {
  const safeId = sanitizeFormatPartId(id);
  const resp = await fetch(`${API_BASE_URL}/api/pictures/by-part/${safeId}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    let files = [];
    if (Array.isArray(data)) {
      files = data;
    } else if (data && Array.isArray(data.files)) {
      files = data.files;
    } else if (data && typeof data.filename === 'string') {
      files = [data.filename];
    }

    matchedPictures = files;
    if (matchedPictures.length > 0) {
      currentIndex = 0;
      showPictureFullScreen(`${API_BASE_URL}/pictures/${encodeURIComponent(matchedPictures[currentIndex])}`);
    } else {
      console.warn("No picture found for", id);
      hidePicture();
    }
  } catch (e) {
    console.error('Error loading pictures for part', id, e);
    hidePicture();
  }
}

function showPictureFullScreen(src) {
  preview.src = src;
  preview.style.display = "block";
  setTimeout(() => preview.classList.add("visible"), 10);
}

function hidePicture() {
  preview.classList.remove("visible");
  preview.addEventListener("transitionend", function handler() {
    preview.style.display = "none";
    preview.src = "";
    preview.removeEventListener("transitionend", handler);
  });
}

function showPrevious() {
  if (matchedPictures.length === 0) return;
  currentIndex = (currentIndex - 1 + matchedPictures.length) % matchedPictures.length;
  showPictureFullScreen(`${API_BASE_URL}/pictures/${encodeURIComponent(matchedPictures[currentIndex])}`);
}

function showNext() {
  if (matchedPictures.length === 0) return;
  currentIndex = (currentIndex + 1) % matchedPictures.length;
  showPictureFullScreen(`${API_BASE_URL}/pictures/${encodeURIComponent(matchedPictures[currentIndex])}`);
}

// Picture Upload (File or Camera)
let uploadPartId = null;
let mediaStream = null;
let videoInputDevices = []; // list of video input deviceIds
let currentVideoDeviceIndex = -1;

function openUpload(partId) {
  uploadPartId = partId;
  const modal = ensureUploadModal();
  modal.style.display = 'flex';
  modal.querySelector('#upload-title').textContent = `Upload Bild für ${partId}`;
}

function closeUpload() {
  const modal = document.getElementById('upload-modal');
  if (!modal) return;
  stopCamera();
  modal.style.display = 'none';
  uploadPartId = null;
}

function ensureUploadModal() {
  let modal = document.getElementById('upload-modal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'upload-modal';
  modal.innerHTML = `
  <div class="upload-backdrop" onclick="closeUpload()"></div>
  <div class="upload-content" onclick="event.stopPropagation()">
    <h3 id="upload-title">Upload Bild</h3>
    <div class="upload-actions">
      <input id="file-input" type="file" accept="image/*" style="display:none" />
      <button onclick="triggerFile()">Datei wählen</button>
      <button id="camera-btn" onclick="toggleCamera()">Kamera</button>
      <button id="flip-btn" onclick="flipCamera()" style="display:none">Flip</button>
      <select id="camera-select" style="display:none; margin-left:8px"></select>
      <button onclick="closeUpload()">Schließen</button>
    </div>
    <div class="camera-area">
      <video id="camera" autoplay playsinline style="display:none"></video>
      <canvas id="snapshot" style="display:none"></canvas>
      <div class="camera-controls" id="camera-controls" style="display:none">
        <button onclick="takeSnapshot()">Foto aufnehmen</button>
        <button onclick="stopCamera()">Kamera stoppen</button>
      </div>
    </div>
    <div id="upload-status" class="upload-status"></div>
  </div>`;
  document.body.appendChild(modal);
  // File change handler
  modal.querySelector('#file-input').addEventListener('change', handleFileSelected);
  // camera select change handler
  modal.querySelector('#camera-select').addEventListener('change', (e) => {
    const idx = parseInt(e.target.value, 10);
    if (!Number.isNaN(idx) && idx >= 0) {
      startCameraForDevice(idx);
    }
  });
  return modal;
}

function triggerFile() {
  const input = document.getElementById('file-input');
  if (input) input.click();
}

async function handleFileSelected(ev) {
  const file = ev.target.files[0];
  if (!file || !uploadPartId) return;
  const status = document.getElementById('upload-status');
  status.textContent = 'Lade hoch...';
  try {
    const form = new FormData();
    form.append('file', file);
    const resp = await fetch(`${API_BASE_URL}/api/pictures/${encodeURIComponent(uploadPartId)}`, { method: 'POST', body: form });
    const data = await resp.json();
    if (resp.ok && data.success) {
      status.textContent = 'Upload erfolgreich';
    } else {
      status.textContent = 'Fehler beim Upload';
    }
  } catch (e) {
    status.textContent = 'Fehler: ' + e;
  }
  ev.target.value = '';
}

async function toggleCamera() {
  const video = document.getElementById('camera');
  if (!video) return;
  const status = document.getElementById('upload-status');
  if (mediaStream) {
    stopCamera();
    return;
  }
  // Security and API availability checks
  if (!isSecureForCamera()) {
    if (status) status.textContent = 'Kamera benötigt HTTPS oder localhost. Bitte App über https://<deine-ip>:3000 öffnen oder Datei-Upload verwenden.';
    return;
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
    if (status) status.textContent = 'Kamera-API nicht verfügbar. Bitte HTTPS verwenden oder Datei-Upload nutzen.';
    return;
  }
  try {
    // Permission-first: request a minimal getUserMedia to prompt permission if needed,
    // then enumerate devices and populate the select. This avoids empty labels/deviceIds.
    await populateCameraSelect();

    // Start camera for current index (if set) or default to first device
    const startIndex = (currentVideoDeviceIndex >= 0) ? currentVideoDeviceIndex : (videoInputDevices.length > 0 ? 0 : -1);
    if (startIndex >= 0) {
      await startCameraForDevice(startIndex);
    } else {
      // fallback to generic getUserMedia
      mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = mediaStream;
      video.style.display = 'block';
      document.getElementById('camera-controls').style.display = 'flex';
      document.getElementById('camera-btn').textContent = 'Kamera läuft';
      const flipBtn = document.getElementById('flip-btn');
      if (flipBtn) flipBtn.style.display = 'none';
    }
  } catch (e) {
    if (status) status.textContent = 'Kamera Fehler: ' + e;
  }
}

// Start camera explicitly for a device index
async function startCameraForDevice(index) {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return;
  if (!videoInputDevices || videoInputDevices.length === 0) return;
  const video = document.getElementById('camera');
  const status = document.getElementById('upload-status');
  try {
    const device = videoInputDevices[index];
    const constraints = { video: { deviceId: { exact: device.deviceId } }, audio: false };
    // Stop any existing stream
    if (mediaStream) stopCamera();
    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    currentVideoDeviceIndex = index;
    video.srcObject = mediaStream;
    video.style.display = 'block';
    document.getElementById('camera-controls').style.display = 'flex';
    document.getElementById('camera-btn').textContent = 'Kamera läuft';
    const flipBtn = document.getElementById('flip-btn');
    if (flipBtn) flipBtn.style.display = (videoInputDevices && videoInputDevices.length > 1) ? 'inline-block' : 'none';
    if (status) status.textContent = '';
    // Update camera-select to reflect selection
    const sel = document.getElementById('camera-select');
    if (sel) {
      sel.value = String(currentVideoDeviceIndex);
      sel.style.display = (videoInputDevices && videoInputDevices.length > 1) ? 'inline-block' : 'none';
    }
  } catch (e) {
    if (status) status.textContent = 'Kamera Fehler: ' + e;
  }
}

// Flip between available video input devices
async function flipCamera() {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    videoInputDevices = devices.filter(d => d.kind === 'videoinput');
    if (!videoInputDevices || videoInputDevices.length <= 1) return;
    // Move to next index
    const next = (currentVideoDeviceIndex + 1) % videoInputDevices.length;
    await startCameraForDevice(next);
  } catch (e) {
    console.warn('Error flipping camera', e);
  }
}

// Permission-first device enumeration and populate select
async function populateCameraSelect() {
  // If enumerateDevices is missing, nothing we can do
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
  try {
    // If labels/deviceIds are not available yet, ask for permission with minimal constraints
    let needPermission = false;
    try {
      const devicesCheck = await navigator.mediaDevices.enumerateDevices();
      // If device labels are empty (''), we probably need permission
      needPermission = devicesCheck.every(d => d.kind !== 'videoinput' || !d.label);
    } catch (e) {
      needPermission = true;
    }

    if (needPermission && navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      // request a tiny stream to trigger permission prompt but stop immediately
      let tmpStream = null;
      try {
        tmpStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (e) {
        // permission denied or other error; continue and try to enumerate (likely will have no labels)
      } finally {
        if (tmpStream) {
          tmpStream.getTracks().forEach(t => t.stop());
        }
      }
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    videoInputDevices = devices.filter(d => d.kind === 'videoinput');
    // Build select options
    const sel = document.getElementById('camera-select');
    if (sel) {
      sel.innerHTML = '';
      videoInputDevices.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = d.label || `Camera ${i+1}`;
        sel.appendChild(opt);
      });
      // default index
      currentVideoDeviceIndex = videoInputDevices.length > 0 ? 0 : -1;
      sel.value = currentVideoDeviceIndex >= 0 ? String(currentVideoDeviceIndex) : '';
      sel.style.display = (videoInputDevices.length > 1) ? 'inline-block' : 'none';
    }
    // Show flip button if multiple
    const flipBtn = document.getElementById('flip-btn');
    if (flipBtn) flipBtn.style.display = (videoInputDevices && videoInputDevices.length > 1) ? 'inline-block' : 'none';
  } catch (e) {
    console.warn('populateCameraSelect failed', e);
  }
}

function stopCamera() {
  if (mediaStream) {
    mediaStream.getTracks().forEach(t => t.stop());
    mediaStream = null;
  }
  const video = document.getElementById('camera');
  if (video) video.style.display = 'none';
  const controls = document.getElementById('camera-controls');
  if (controls) controls.style.display = 'none';
  const btn = document.getElementById('camera-btn');
  if (btn) btn.textContent = 'Kamera';
  const flipBtn = document.getElementById('flip-btn');
  if (flipBtn) flipBtn.style.display = 'none';
}

async function takeSnapshot() {
  if (!mediaStream || !uploadPartId) return;
  const video = document.getElementById('camera');
  const canvas = document.getElementById('snapshot');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const status = document.getElementById('upload-status');
  status.textContent = 'Sende Foto...';
  try {
    const form = new FormData();
    form.append('image_base64', dataUrl);
    const resp = await fetch(`${API_BASE_URL}/api/pictures/${encodeURIComponent(uploadPartId)}`, { method: 'POST', body: form });
    const data = await resp.json();
    if (resp.ok && data.success) {
      status.textContent = 'Foto gespeichert';
    } else {
      status.textContent = 'Fehler beim Speichern';
    }
  } catch (e) {
    status.textContent = 'Fehler: ' + e;
  }
}

// Close modal with ESC
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeUpload();
  }
});

// Initialize the application
window.onload = async () => {
  console.log('Initializing RFID Parts Application...');
  
  // Load RFID tags
  readRFIDTags();
  
  // Load format parts from API
  await loadFormatParts();
  
  // Load assignments from database
  await loadAssignments();
  
  console.log('Application initialized successfully');
};
