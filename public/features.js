let rfidTags = [];
let formatParts = []; // Dynamic format parts from API

// API configuration
const API_BASE_URL = 'http://localhost:8001';

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

function readRFIDTags() {
  // Simulated list of tags
  rfidTags = ["", "RFID-001", "RFID-002", "RFID-003", "RFID-004"];
  updateDropdowns();
}

function updateDropdowns() {
  const partRows = document.querySelectorAll('.rfid-select');
  partRows.forEach(select => {
    const currentValue = select.value;
    select.innerHTML = '';
    rfidTags.forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag === "" ? "(unassigned)" : tag;
      select.appendChild(opt);
    });
    select.value = currentValue;
  });
}

function assignRFID(partId) {
  const select = document.getElementById('select-' + partId);
  const value = select.value;
  const checkbox = document.getElementById('check-' + partId);
  checkbox.checked = value !== "";
  checkAllAssigned();
}

function checkAllAssigned() {
  const checkboxes = document.querySelectorAll('.assign-check');
  const allChecked = [...checkboxes].every(cb => cb.checked);
  document.getElementById('final-check').checked = allChecked;
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
    `;
    assignedList.appendChild(assigned);
  });
  
  // Update dropdowns with RFID tags
  updateDropdowns();
  console.log(`Updated display with ${formatParts.length} format parts`);
}

async function refreshFormatParts() {
  console.log('Refreshing format parts...');
  await loadFormatParts();
}

// Initialize the application
window.onload = async () => {
  console.log('Initializing RFID Parts Application...');
  
  // Load RFID tags
  readRFIDTags();
  
  // Load format parts from API
  await loadFormatParts();
  
  console.log('Application initialized successfully');
};
