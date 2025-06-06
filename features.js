let rfidTags = [];

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

window.onload = () => {
  const parts = [
    { id: '1A1' }, { id: '2A1' }, { id: '3A2' },
    { id: '2B1' }, { id: '3C2' }, { id: '4D3' },
  ];

  const allList = document.getElementById('format-parts-list');
  const assignedList = document.getElementById('assigned-parts-list');

  parts.forEach(p => {
    // Right side
    const row = document.createElement('div');
    row.className = 'part-entry';
    row.innerHTML = `
      <label>${p.id}</label>
      <select id="select-${p.id}" class="rfid-select"></select>
      <button onclick="assignRFID('${p.id}')">Assign</button>
    `;
    allList.appendChild(row);

    // Left side
    const assigned = document.createElement('div');
    assigned.className = 'part-entry';
    assigned.innerHTML = `
      <label>${p.id}</label>
      <input type="checkbox" id="check-${p.id}" class="assign-check" disabled>
    `;
    assignedList.appendChild(assigned);
  });
};
