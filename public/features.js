let rfidTags = [];
let formatParts = []; // Dynamic format parts from API
let assignments = {}; // Format part -> RFID tag assignments from database

// API configuration
const API_BASE_URL = 'http://localhost:8001';

// Mirror backend _sanitize_part: replace any non [A-Za-z0-9_\-] with '_'
function sanitizeFormatPartId(id) {
  if (id == null) return '';
  return String(id).trim().replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
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
  partRows.forEach(select => {
    const currentValue = select.value;
    const partId = select.id.replace('select-', '');
    
    select.innerHTML = '';
    rfidTags.forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag === "" ? "(unassigned)" : tag;
      select.appendChild(opt);
    });
    
    // Set value from database if available
    if (assignments[partId]) {
      select.value = assignments[partId];
    } else {
      select.value = currentValue;
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
    } else {
      console.warn('No assignments found in API response');
      assignments = {};
      updateAssignmentDisplay();
    }
  } catch (error) {
    console.error('Error loading assignments:', error);
    assignments = {};
    updateAssignmentDisplay();
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
  if (mediaStream) {
    stopCamera();
    return;
  }
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    video.srcObject = mediaStream;
    video.style.display = 'block';
    document.getElementById('camera-controls').style.display = 'flex';
    document.getElementById('camera-btn').textContent = 'Kamera läuft';
  } catch (e) {
    document.getElementById('upload-status').textContent = 'Kamera Fehler: ' + e;
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
