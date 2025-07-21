let rfidTags = [];
let formatParts = []; // Dynamic format parts from API
let assignments = {}; // Format part -> RFID tag assignments from database

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

async function readRFIDTags() {
  try {
    console.log('Reading RFID tags from server...');
    const response = await fetch(`${API_BASE_URL}/api/opcua/tags`);
    if (!response.ok) {
      throw new Error(`Server error: ${response.status}`);
    }
    const data = await response.json();
    if (Array.isArray(data.tags)) {
      rfidTags = ["", ...data.tags]; // blank + fetched tags
      console.log("RFID tags fetched:", rfidTags);
      updateDropdowns();
    } else {
      throw new Error("Invalid response format");
    }
  } catch (error) {
    console.error("Error fetching RFID tags:", error);
    alert("Failed to read RFID tags from antenna.");
  }
   if (!rfidTags || rfidTags.length === 0) {
    alert("Please upload a valid format file first.");
    return;
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

function assignRFID(partId) {
  const select = document.getElementById('select-' + partId);
  const checkbox = document.getElementById('check-' + partId);

  if (!select || !checkbox) {
    console.error(`Missing elements for part ${partId}`);
    alert("Failed to assign. UI elements missing.");
    return;
  }

  const selectedValue = select.value;

  // If user hasn't selected a valid tag
  if (!selectedValue || selectedValue === "") {
    alert("Please select a valid RFID tag before assigning.");
    return;
  }

  // Simulate successful assignment (can be replaced with API call if needed)
  checkbox.checked = true;

  // Re-check if all are assigned
  checkAllAssigned();

  console.log(`Assigned ${selectedValue} to ${partId}`);
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

// Initialize the application
window.onload = () => {
  const uploadInput = document.getElementById("fileInput");
  if (uploadInput) {
    uploadInput.addEventListener("change", handleFileUpload);
  }
  refreshFormatParts();
};

function handleFileUpload() {
  const input = document.getElementById('fileInput');
  const file = input.files[0];
  if (!file) {
    alert("Please select a file.");
    return;
  }

  function extractFormatsFromDropdown(doc) {
  const dropdown = doc.querySelector('select'); // First <select> element
  if (!dropdown) return [];

  const options = Array.from(dropdown.querySelectorAll('option'));
  return options.map(opt => opt.textContent.trim()).filter(text => text && text.startsWith("Format"));
}


  const reader = new FileReader();
  reader.onload = (e) => {
    const htmlContent = e.target.result;
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, "text/html");
    const script = doc.querySelector("#FormatData");

    if (!script) {
      alert("Invalid format file. No format data found.");
      return;
    }

    try {
  let rawScript = script.innerHTML;
  
  // Remove newlines, invisible characters, and sanitize
  rawScript = rawScript.replace(/[\u0000-\u001F\u007F-\u009F]/g, '');
  
  const match = rawScript.match(/var\s+formats\s*=\s*({[\s\S]*?});?/);
  if (!match || !match[1]) {
    alert("Could not parse format data.");
    return;
  }

  const formats = JSON.parse(match[1]);

  const formatKeys = Object.keys(formats);
  if (formatKeys.length === 0) {
    alert("No formats found.");
    return;
  }

  const format = formats[formatKeys[0]];
  const parts = format.data
    .map(d => ({ id: d.formatPart }))
    .filter(p => p.id && p.id !== "FTL." && !/^[-\s]*$/.test(p.id));

  loadParts(parts);
} catch (err) {
  console.error("Error parsing format data", err);
}

const formats = extractFormatsFromDropdown(doc);
console.log("Extracted formats:", formats);

if (formats.length > 0) {
  rfidTags = formats;  // Use formats as RFID tags for demo/testing
  updateDropdowns();
  alert("The format file uploaded has been read and formats detected.");
} else {
  alert("No format options found in uploaded file.");
}


  };
  reader.readAsText(file);
}
