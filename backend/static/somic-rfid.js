// Translated strings and language detection
(function () {
  var LANG = (function detectLang() {
    try {
      if (typeof location !== 'undefined' && location.search) {
        var p = new URLSearchParams(location.search);
        var q = (p.get('lang') || '').toLowerCase();
        if (q === 'de' || q === 'en') return q;
      }
      if (typeof document !== 'undefined') {
        var dl = (document.documentElement && document.documentElement.lang || '').toLowerCase();
        if (dl === 'de' || dl === 'en') return dl;
      }
      if (typeof navigator !== 'undefined' && navigator.language) {
        var nl = navigator.language.toLowerCase();
        if (nl.indexOf('de') === 0) return 'de';
      }
    } catch (e) {}
    return 'de'; 
  })();

  // Translations dictionary
  var DICT = {
    en: {
      legend_text: 'RFID: ✔ detected, ✖ not detected, – unassigned',
      live: 'Live',
      wrong: 'Wrong',
      wrong_tags: 'Wrong tags:',
      no_wrong_tags: 'No wrong tags',
      wrong_tags_tooltip_error: 'Wrong tags (tooltip error)',
      format: 'Format',
      recognized: 'recognized',
      missing: 'missing',
      per_format: 'Per format',
      no_assignments: 'No assignments',
      no_rfid_assigned: 'No RFID assigned',
      tag: 'Tag',
      detected: 'detected',
      not_detected: 'not detected',
      key: 'Key',
      norm: 'Norm',
      ws_prefix: 'WebSocket: ',
    },
    de: {
      legend_text: 'RFID: ✔ erkannt, ✖ nicht erkannt, – nicht zugeordnet',
      live: 'Live',
      wrong: 'Falsch',
      wrong_tags: 'Falsche Tags:',
      no_wrong_tags: 'Keine falschen Tags',
      wrong_tags_tooltip_error: 'Falsche Tags (Tooltip Fehler)',
      format: 'Format',
      recognized: 'erkannt',
      missing: 'fehlen',
      per_format: 'Pro Format',
      no_assignments: 'Keine Zuordnungen',
      no_rfid_assigned: 'Kein RFID zugeordnet',
      tag: 'Tag',
      detected: 'erkannt',
      not_detected: 'nicht erkannt',
      key: 'Key',
      norm: 'Norm',
      ws_prefix: 'WebSocket: ',
    }
  };
  // Translation lookup
  function t(key){
    var d = DICT[LANG] || DICT.de;
    return (d && d[key]) || (DICT.en && DICT.en[key]) || key;
  }
  // Set language and update UI
  function setLanguage(lang){
    if (lang === 'de' || lang === 'en') {
      LANG = lang;
      try { if (document && document.documentElement) document.documentElement.lang = lang; } catch(e){}
      ensureLegend();
      updateLegend();
      updateAll();
    }
  }
  try { window.setLanguage = setLanguage; } catch(e){}
  try {
    window.addEventListener('message', function(ev){
      try{
        var data = ev && ev.data; if (!data || typeof data !== 'object') return;
        if (data.type === 'set-language' && (data.lang === 'de' || data.lang === 'en')) setLanguage(data.lang);
      }catch(e){}
    });
  } catch(e){}
  
  // Utility: debounce
  function debounce(fn, ms) { var t; return function () { var ctx = this, args = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(ctx, args); }, ms); }; }
  
  // Normalize tag string: uppercase, alphanumeric only
  function normalizeTag(t) { return (t || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  // Find index of FTL column in given table
  function findFTLIndex(table) {
    try {
      var head = table.querySelector('tr.caption[name="TableHead"]');
      var ths = head ? head.querySelectorAll('th') : table.querySelectorAll('thead th');
      for (var i = 0; i < ths.length; i++) {
        var txt = (ths[i].textContent || '').toLowerCase().replace(/\./g, '').trim();
        if (txt === 'ftl') return i;
      }
    } catch (e) { }
    return 3;
  }

  // Build a mapping from data-format-key -> target td element for the current table view
  function buildMap() {
    var map = new Map();
    var tables = document.querySelectorAll('table.main');
    if (!tables || !tables.length) return map;
    tables.forEach(function (table) {
      var rows = table.querySelectorAll('tr');
      rows.forEach(function (tr) {
        try {
          var first = tr.querySelector('td.value.index');
          if (!first) return;
          var tds = tr.querySelectorAll('td');
          if (!tds || tds.length < 1) return;
          if (tds[0] !== first) return;
          var nr = (first.textContent || '').trim();
          if (!nr) return;
          var ftl = getFtlForNr(nr);
          if (!ftl) {
            var ftlIdx = findFTLIndex(table);
            ftl = (tds[ftlIdx] && tds[ftlIdx].textContent) ? tds[ftlIdx].textContent.trim() : '';
          }
          var key = ftl ? (nr + ' ' + ftl) : nr;
          var target = tr.querySelector('td[data-format-key]');
          if (!target) {
            target = document.createElement('td');
            target.textContent = '–';
            if (tds[2]) tds[2].parentNode.insertBefore(target, tds[2]); else tr.appendChild(target);
          }
          try {
            target.style.padding = '0 8px';
            target.style.textAlign = 'center';
            target.style.verticalAlign = 'middle';
            target.style.border = target.style.border || '1px solid #000000';
            target.style.fontWeight = '700';
            target.style.color = target.style.color || '#666';
            target.style.whiteSpace = 'nowrap';
          } catch (e) { }
          target.setAttribute('data-format-key', key);
          target.setAttribute('data-nr', nr);
          if (ftl) target.setAttribute('data-ftl', ftl); else target.removeAttribute('data-ftl');
          map.set(key, target);
        } catch (e) { }
      });
    });
    return map;
  }

  // Global state
  var assignments = {};
  var liveSet = new Set();
  var map = buildMap();
  var wsState = 'connecting';

  // Build a Set of all normalized tag IDs that are assigned to any format part/key
  function getAssignedTagSet() {
    var set = new Set();
    try {
      Object.keys(assignments || {}).forEach(function (k) {
        var v = assignments[k];
        var raw = null;
        if (typeof v === 'string') raw = v; else if (v && typeof v === 'object') raw = v.rfid_tag_id || v.rfidTagId || v.tagId || null;
        var n = raw ? normalizeTag(raw) : null;
        if (n) set.add(n);
      });
    } catch (e) { }
    return set;
  }

  // --- Format JSON handling (active format -> NR to FTL mapping) ---
  var formatMaps = { byFormat: {}, names: [] };
  var currentFormat = null;
  function setCurrentFormat(fmt) {
    try {
      if (!fmt || typeof fmt !== 'string') return;
      if (formatMaps && Array.isArray(formatMaps.names) && formatMaps.names.indexOf(fmt) !== -1) {
        currentFormat = fmt;
        debouncedRebuild();
      }
    } catch (e) { }
  }

  // Build formatMaps from given format JSON data
  function buildFormatMaps(data) {
    try {
      var fmts = (data && data.formats) || {};
      var names = Object.keys(fmts);
      var by = {};
      names.forEach(function (name) {
        var fmt = fmts[name] || {};
        var arr = Array.isArray(fmt.data) ? fmt.data : [];
        var nrToFtl = {};
        for (var i = 0; i < arr.length; i++) {
          var it = arr[i];
          if (!it || typeof it !== 'object') continue;
          var nr = (it.valueIndex || '').toString().trim();
          var ftl = (it.formatPart || '').toString().trim();
          if (!nr) continue;
          if (!ftl || /^FTL\.?$/i.test(ftl)) continue;
          if (!nrToFtl[nr]) nrToFtl[nr] = ftl;
        }
        by[name] = nrToFtl;
      });
      formatMaps.byFormat = by;
      formatMaps.names = names;
      if (!currentFormat) {
        var candidates = [];
        try { if (window.SelectedFormat) candidates.push(window.SelectedFormat); } catch (e) { }
        try { if (window.selectedFormat) candidates.push(window.selectedFormat); } catch (e) { }
        try { if (window.ActiveFormat) candidates.push(window.ActiveFormat); } catch (e) { }
        try { if (window.activeFormat) candidates.push(window.activeFormat); } catch (e) { }
        try {
          var sels = document.querySelectorAll('select, input[list]');
          outer: for (var sidx = 0; sidx < sels.length; sidx++) {
            var sel = sels[sidx];
            if (sel && sel.tagName === 'SELECT') {
              var opt = sel.options && sel.options[sel.selectedIndex];
              if (opt && opt.text && names.indexOf(opt.text.trim()) !== -1) { candidates.push(opt.text.trim()); break outer; }
              if (opt && opt.value && names.indexOf(opt.value.trim()) !== -1) { candidates.push(opt.value.trim()); break outer; }
            }
          }
        } catch (e) { }
        for (var c = 0; c < candidates.length; c++) {
          var nm = (candidates[c] || '').toString().trim();
          if (names.indexOf(nm) !== -1) { currentFormat = nm; break; }
        }
        if (!currentFormat && names.length) { currentFormat = names[0]; }
      }
    } catch (e) { }
  }

  // Get FTL for given NR in current format
  function getFtlForNr(nr) {
    try {
      if (!nr) return '';
      if (currentFormat && formatMaps && formatMaps.byFormat) {
        var m = formatMaps.byFormat[currentFormat];
        if (m) {
          var f = m[nr];
          if (f) return f;
          var nrTrim = nr.toString().replace(/^0+/, '');
          if (nrTrim && m[nrTrim]) return m[nrTrim];
          var nrPad = nrTrim ? ('0' + nrTrim) : null;
          if (nrPad && m[nrPad]) return m[nrPad];
        }
      }
    } catch (e) { }
    return '';
  }

  // Optional Legend / Status Badge
  function isLegendEnabled() {
    try {
      var meta = document.querySelector('meta[name="somic-rfid-legend"]');
      if (meta) { return (meta.getAttribute('content') || '1') !== '0'; }
    } catch (e) { }
    return true; 
  }

  // Legend element
  var legendEl = null;
  function placeLegend() {
    try {
      if (!legendEl) return;
      var table = document.querySelector('table.main');
      if (table && table.parentNode) {
        if (legendEl.nextSibling !== table) {
          table.parentNode.insertBefore(legendEl, table);
        }
      } else if (document.body && legendEl.parentNode !== document.body) {
        document.body.insertBefore(legendEl, document.body.firstChild);
      }
    } catch (e) { }
  }

  // Create legend element if not existing
  function ensureLegend() {
    if (!isLegendEnabled()) return null;
    if (legendEl && document.body.contains(legendEl)) return legendEl;
    var table = document.querySelector('table.main');
    var el = document.createElement('div');
    el.setAttribute('id', 'somic-rfid-legend');
    el.style.font = '12px/1.3 system-ui, Segoe UI, Roboto, Arial, sans-serif';
    el.style.background = '#f6f7f8';
    el.style.border = '1px solid #d7dadd';
    el.style.borderRadius = '6px';
    el.style.padding = '6px 10px';
    el.style.margin = '8px 0 10px 0';
    el.style.color = '#333';
    el.style.display = 'flex';
    el.style.gap = '12px';
    el.style.alignItems = 'center';

    var dot = document.createElement('span');
    dot.setAttribute('id', 'somic-rfid-ws-dot');
    dot.style.display = 'inline-block';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.background = '#f0ad4e';
    dot.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.05)';

  var txt = document.createElement('span');
    txt.setAttribute('id', 'somic-rfid-legend-text');
  txt.textContent = t('legend_text');

  var live = document.createElement('span');
    live.setAttribute('id', 'somic-rfid-livecount');
    live.style.opacity = '0.8';
  live.textContent = '(' + t('live') + ': 0)';

  var wrong = document.createElement('span');
    wrong.setAttribute('id', 'somic-rfid-wrongcount');
    wrong.style.opacity = '0.8';
  wrong.textContent = '(' + t('wrong') + ': 0)';

  var fmtStats = document.createElement('span');
    fmtStats.setAttribute('id', 'somic-rfid-formatstats');
    fmtStats.style.opacity = '0.9';
  fmtStats.textContent = t('format') + ': –';

    el.appendChild(dot);
    el.appendChild(txt);
    el.appendChild(live);
    el.appendChild(wrong);
    el.appendChild(fmtStats);

    if (table && table.parentNode) {
      table.parentNode.insertBefore(el, table);
    } else {
      document.body.insertBefore(el, document.body.firstChild);
    }
    legendEl = el;
    placeLegend();
    return el;
  }

  // Compute number of tags that are currently seen but not part of the active format rows
  function computeWrongCount() {
    try {
      var expected = new Set();
      map.forEach(function (td) {
        var tag = resolveAssignmentForTd(td);
        var norm = tag ? normalizeTag(tag) : null;
        if (norm) expected.add(norm);
      });
      var wrong = 0;
      var assignedSet = getAssignedTagSet();
      if (liveSet && typeof liveSet.forEach === 'function') {
        liveSet.forEach(function (t) { if (assignedSet.has(t) && !expected.has(t)) wrong++; });
      }
      return wrong;
    } catch (e) { return 0; }
  }

  // Return array of wrong details: [{ keys: [formatPart...], tagRaw: string|null, tagNorm: string }]
  function computeWrongDetails() {
    var details = [];
    try {
      var expected = new Set();
      map.forEach(function (td) {
        var tag = resolveAssignmentForTd(td);
        var norm = tag ? normalizeTag(tag) : null;
        if (norm) expected.add(norm);
      });
      var rev = {};
      try {
        Object.keys(assignments || {}).forEach(function (k) {
          var v = assignments[k];
          var raw = null;
          if (typeof v === 'string') raw = v; else if (v && typeof v === 'object') raw = v.rfid_tag_id || v.rfidTagId || v.tagId || null;
          var n = raw ? normalizeTag(raw) : null;
          if (n) { if (!rev[n]) rev[n] = []; if (rev[n].indexOf(k) === -1) rev[n].push(k); }
        });
      } catch (e) { }
      if (liveSet && typeof liveSet.forEach === 'function') {
        liveSet.forEach(function (t) {
          if (!expected.has(t) && rev[t] && rev[t].length) {
            var keys = rev[t] || [];
            var raw = null;
            for (var i = 0; i < keys.length && !raw; i++) {
              var kv = assignments[keys[i]];
              if (typeof kv === 'string') raw = kv; else if (kv && typeof kv === 'object') raw = kv.rfid_tag_id || kv.rfidTagId || kv.tagId || null;
            }
            details.push({ keys: keys, tagRaw: raw, tagNorm: t });
          }
        });
      }
    } catch (e) { }
    return details;
  }

  // Resolve assignment from NR+FTL against global assignments map
  function resolveAssignmentByNrFtl(nr, ftl) {
    try {
      var candidates = [];
      if (nr && ftl) {
        var k = nr + ' ' + ftl;
        candidates.push(k);
        candidates.push(k.replace(/\s+/g, ' ').trim());
        candidates.push(k.replace(/\./g, '').replace(/\s+/g, ' ').trim());
        candidates.push(nr + ' ' + (ftl.replace(/\./g, '')));
      }
      if (ftl) {
        candidates.push(ftl);
        candidates.push(ftl.replace(/\./g, ''));
        candidates.push(ftl.replace(/\s+/g, ''));
      }
      var seenC = new Set(); var final = [];
      for (var i = 0; i < candidates.length; i++) { var c = candidates[i]; if (c && !seenC.has(c)) { seenC.add(c); final.push(c); } }
      for (var j = 0; j < final.length; j++) {
        var key = final[j];
        var assign = assignments[key];
        if (assign) {
          if (typeof assign === 'string') return assign;
          if (assign && typeof assign === 'object') {
            var maybe = assign.rfid_tag_id || assign.rfidTagId || assign.tagId || null;
            if (maybe) return maybe;
          }
        }
      }
    } catch (e) { }
    return null;
  }

  // Compute per-format stats: recognized vs missing among assigned tags for that format
  function computeFormatStats() {
    var out = { current: { name: currentFormat || '', recognized: 0, total: 0, missing: 0 }, all: [] };
    try {
      var names = (formatMaps && Array.isArray(formatMaps.names)) ? formatMaps.names : [];
      for (var n = 0; n < names.length; n++) {
        var name = names[n];
        var nrMap = (formatMaps.byFormat && formatMaps.byFormat[name]) || {};
        var total = 0, recognized = 0;
        for (var nr in nrMap) {
          if (Object.prototype.hasOwnProperty.call(nrMap, nr)) {
            var ftl = nrMap[nr];
            var raw = resolveAssignmentByNrFtl(nr, ftl);
            if (raw) {
              total += 1;
              var norm = normalizeTag(raw);
              if (norm && liveSet && liveSet.has(norm)) recognized += 1;
            }
          }
        }
        var missing = Math.max(0, total - recognized);
        var rec = { name: name, recognized: recognized, total: total, missing: missing };
        out.all.push(rec);
        if (name === currentFormat) { out.current = rec; }
      }
      if (!out.current || !out.current.name) { if (out.all.length) { out.current = out.all[0]; } }
    } catch (e) { }
    return out;
  }

  // Update legend contents
  function updateLegend() {
    var el = ensureLegend();
    if (!el) return;
    var legendText = el.querySelector('#somic-rfid-legend-text');
    if (legendText) { legendText.textContent = t('legend_text'); }
    var dot = el.querySelector('#somic-rfid-ws-dot');
    var live = el.querySelector('#somic-rfid-livecount');
    var wrong = el.querySelector('#somic-rfid-wrongcount');
    var fmtStats = el.querySelector('#somic-rfid-formatstats');
    if (dot) {
      var color = '#f0ad4e'; // default/connecting
      if (wsState === 'connected') color = '#2eb85c';
      else if (wsState === 'reconnecting') color = '#f0ad4e';
      else if (wsState === 'error') color = '#d9534f';
      else if (wsState === 'connecting') color = '#f0ad4e';
      dot.style.background = color;
      dot.title = t('ws_prefix') + wsState;
    }
    if (live) {
      var assignedSet = getAssignedTagSet();
      var liveAssigned = 0;
      try {
        if (liveSet && typeof liveSet.forEach === 'function') {
          liveSet.forEach(function (t) { if (assignedSet.has(t)) liveAssigned++; });
        }
      } catch (e) { }
      live.textContent = '(' + t('live') + ': ' + liveAssigned + ')';
    }
    if (wrong) {
      var wdetails = computeWrongDetails();
      wrong.textContent = '(' + t('wrong') + ': ' + (wdetails ? wdetails.length : 0) + ')';
      try {
        var lines = [];
        for (var i = 0; i < Math.min(wdetails.length, 30); i++) {
          var d = wdetails[i];
          var keyLabel = (d.keys && d.keys.length) ? d.keys.join(', ') : '(?)';
          var raw = d.tagRaw || d.tagNorm || '';
          var last6 = raw ? raw.toString().slice(-6) : '';
          lines.push(keyLabel + ' • …' + last6);
        }
        if (wdetails.length > 30) lines.push('…');
        wrong.title = lines.length ? (t('wrong_tags') + '\n' + lines.join('\n')) : t('no_wrong_tags');
      } catch (e) { wrong.title = t('wrong_tags_tooltip_error'); }
    }
    if (fmtStats) {
      var stats = computeFormatStats();
      var c = stats.current || { recognized: 0, total: 0, missing: 0, name: '' };
      fmtStats.textContent = t('format') + ': ' + c.recognized + '/' + c.total + ' ' + t('recognized') + ' · ' + c.missing + '/' + c.total + ' ' + t('missing');
      try {
        var lines2 = [];
        for (var k = 0; k < Math.min(stats.all.length, 40); k++) {
          var r = stats.all[k];
          lines2.push(r.name + ': ' + r.recognized + '/' + r.total + ' ' + t('recognized') + ' · ' + r.missing + '/' + r.total + ' ' + t('missing'));
        }
        if (stats.all.length > 40) lines2.push('…');
        fmtStats.title = lines2.length ? (t('per_format') + ':\n' + lines2.join('\n')) : t('no_assignments');
      } catch (e) { fmtStats.title = ''; }
    }
  }

  // Resolve assignment for a given TD by trying multiple key variants (exact, normalized, FTL-only)
  function resolveAssignmentForTd(td) {
    if (!td) return null;
    var dataKey = td.getAttribute('data-format-key') || '';
    var nr = td.getAttribute('data-nr') || '';
    var ftl = td.getAttribute('data-ftl') || '';
    var candidates = [];
    if (dataKey) {
      candidates.push(dataKey);
      candidates.push(dataKey.replace(/\s+/g, ' ').trim());
      candidates.push(dataKey.replace(/\./g, '').replace(/\s+/g, ' ').trim());
    }
    if (nr && ftl) {
      var k = nr + ' ' + ftl;
      candidates.push(k);
      candidates.push((nr + ' ' + ftl.replace(/\./g, '')));
      candidates.push(k.replace(/\./g, '').replace(/\s+/g, ' ').trim());
    }
    if (ftl) {
      candidates.push(ftl);
      candidates.push(ftl.replace(/\./g, ''));
      candidates.push(ftl.replace(/\s+/g, ''));
    }
    var seenC = new Set();
    var final = [];
    for (var i = 0; i < candidates.length; i++) { var c = candidates[i]; if (c && !seenC.has(c)) { seenC.add(c); final.push(c); } }
    for (var j = 0; j < final.length; j++) {
      var key = final[j];
      var assign = assignments[key];
      if (assign) {
        if (typeof assign === 'string') return assign;
        if (assign && typeof assign === 'object') {
          var maybe = assign.rfid_tag_id || assign.rfidTagId || assign.tagId || null;
          if (maybe) return maybe;
        }
      }
    }
    return null;
  }

  // Update all TDs in the map based on current assignments and liveSet
  function updateAll() {
    map.forEach(function (td) {
      var tag = resolveAssignmentForTd(td);
      var norm = tag ? normalizeTag(tag) : null;
      var seen = norm ? liveSet.has(norm) : false;
      var symbol = !tag ? '–' : (seen ? '✔' : '✖');
      td.textContent = symbol;
      var kinfo = td.getAttribute('data-format-key') || '';
      td.title = !tag
        ? (t('no_rfid_assigned') + ' | ' + t('key') + '=' + kinfo)
        : (seen
          ? (t('tag') + ' ' + tag + ' ' + t('detected') + ' | ' + t('key') + '=' + kinfo + ' | ' + t('norm') + '=' + norm)
          : (t('tag') + ' ' + tag + ' ' + t('not_detected') + ' | ' + t('key') + '=' + kinfo + ' | ' + t('norm') + '=' + norm)
        );
      td.style.color = tag ? (seen ? '#0a7a15' : '#b30000') : '#666';
      try {
        if (!tag) {
          td.style.backgroundColor = '#ffffff';
          td.style.borderColor = '#000000';
        } else if (seen) {
          td.style.backgroundColor = '#99e47cff';
          td.style.borderColor = '#000000';
        } else {
          td.style.backgroundColor = '#ec7e7eff';
          td.style.borderColor = '#000000';
        }
      } catch (e) { }
    });
    updateLegend();
  }

  // Handlers for incoming data
  function handleAssignmentsUpdate(obj) { assignments = obj || {}; updateAll(); }

  // live IDs is an array of tag strings
  function handleLiveIds(ids) { liveSet = new Set((ids || []).map(function (t) { return normalizeTag(t); }).filter(Boolean)); updateAll(); }

  // Rebuild map and update all
  function rebuildMap() { map = buildMap(); updateAll(); }
  var debouncedRebuild = debounce(rebuildMap, 100);

  // Observe main table for changes
  function observeMainTable() {
    try {
      var table = document.querySelector('table.main');
      if (!table) return;
      var observer = new MutationObserver(function () { debouncedRebuild(); });
      observer.observe(table, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch (e) { }
  }

  // Observe the document for late insertion of table.main and reposition legend
  function observeForTable() {
    try {
      if (document.querySelector('table.main')) return;
      var docObs = new MutationObserver(function () {
        var t = document.querySelector('table.main');
        if (t) {
          try { docObs.disconnect(); } catch (e) { }
          observeMainTable();
          ensureLegend();
          placeLegend();
          debouncedRebuild();
        }
      });
      var target = document.body || document.documentElement;
      if (target) { docObs.observe(target, { childList: true, subtree: true }); }
    } catch (e) { }
  }

  // hook into global functions that change the format or data
  function hookFn(name) {
    try {
      var fn = window[name];
      if (typeof fn === 'function') {
        window[name] = function () {
          try {
            if (name === 'setActiveFormat' && arguments && arguments.length) { setCurrentFormat(arguments[0]); }
            if (name === 'setDiffFormat' && arguments && arguments.length) {
              var toFmt = arguments[1]; var fromFmt = arguments[0];
              if (typeof toFmt === 'string') setCurrentFormat(toFmt); else if (typeof fromFmt === 'string') setCurrentFormat(fromFmt);
            }
          } catch (e) { }
          var r = fn.apply(this, arguments);
          setTimeout(debouncedRebuild, 0);
          return r;
        };
      }
    } catch (e) { }
  }
  hookFn('setActiveFormat');
  hookFn('setDiffFormat');
  hookFn('updateValue');
  hookFn('onValueChanged');

  // Start observing and initial setup
  var DEFAULT_BACKEND_PORT = 8001;
  function backendOrigins() {
    var list = [];
    try {
      var ref = (typeof document !== 'undefined' && document.referrer) ? document.referrer : '';
      var refUrl = null;
      try { if (ref) refUrl = new URL(ref); } catch (e) { }
      var locProto = (typeof location !== 'undefined' ? location.protocol : '');
      var isHttpLike = /^https?:$/.test(locProto);
      var isHttps = (locProto === 'https:') || (refUrl && refUrl.protocol === 'https:');
      var m = document.querySelector('meta[name="somic-backend-origin"]');
      var c = m && m.getAttribute('content');
      if (c) {
        try {
          var mu = new URL(c);
          if (mu.hostname && mu.hostname !== '0.0.0.0') {
            if (!(isHttps && mu.protocol === 'http:')) {
              var mo = mu.origin; if (list.indexOf(mo) === -1) list.push(mo);
            }
          }
        } catch (e) { }
      }

      if (refUrl && /^https?:$/.test(refUrl.protocol)) {
        var ro = refUrl.origin; if (list.indexOf(ro) === -1) list.push(ro);
      }

      if (isHttpLike && location.origin) { if (list.indexOf(location.origin) === -1) list.push(location.origin); }

      try {
        var host = (refUrl && refUrl.hostname) || (location && location.hostname) || '';
        var isLocal = (host === 'localhost' || host === '127.0.0.1' || host === '::1');
        if (isLocal) {
          var useProto = isHttps ? 'https:' : ((locProto && /^https?:$/.test(locProto)) ? locProto : 'http:');
          var devOrigin = useProto + '//' + (host || 'localhost') + ':' + DEFAULT_BACKEND_PORT;
          if (list.indexOf(devOrigin) === -1) list.push(devOrigin);
        }
      } catch (e) { }
    } catch (e) { }
    return list;
  }

  // WebSocket connection with reconnection logic
  function connectWs() {
    var origins = backendOrigins();
    var idx = 0;
    var connectedOnce = false;
    function tryNext() {
      if (idx >= origins.length) { wsState = 'error'; updateLegend(); setTimeout(connectWs, 2000); return; }
      var origin = origins[idx++];
      var u;
      try { u = new URL(origin); } catch (e) { return tryNext(); }
      var pageHttps = false;
      try {
        if (location && location.protocol === 'https:') pageHttps = true;
        else if (document && document.referrer) { var r = new URL(document.referrer); if (r.protocol === 'https:') pageHttps = true; }
      } catch (e) { }
      var proto = pageHttps ? 'wss' : ((u.protocol === 'https:') ? 'wss' : 'ws');
      var wsUrl = proto + '://' + u.host + '/ws/opc-ua';
      var ws;
      try { ws = new WebSocket(wsUrl); } catch (e) { return tryNext(); }
      var opened = false;
      ws.onopen = function () { opened = true; connectedOnce = true; wsState = 'connected'; updateLegend(); };
      ws.onmessage = function (ev) {
        try {
          var msg = JSON.parse(ev.data);
          if (msg && msg.type === 'live_event_ids' && Array.isArray(msg.ids)) handleLiveIds(msg.ids);
          if (msg && msg.type === 'assignments_update' && msg.assignments) handleAssignmentsUpdate(msg.assignments);
        } catch (e) { }
      };
      ws.onclose = function () {
        if (!opened) {
          return tryNext();
        }
        wsState = 'reconnecting'; updateLegend(); setTimeout(connectWs, 2000);
      };
      ws.onerror = function () { if (!opened) { try { ws.close(); } catch (e) { } tryNext(); } else { wsState = 'error'; updateLegend(); try { ws.close(); } catch (e) { } } };
    }
    tryNext();
  }

  // Helper to fetch from backend with absolute URL
  function apiFetch(path) {
    var origins = backendOrigins();
    var i = 0;
    var triedRelative = false;
    function attempt() {
      if (!triedRelative) {
        triedRelative = true;
        try {
          return fetch(path).then(function (r) { if (r && r.ok) return r; return attempt(); }).catch(function () { return attempt(); });
        } catch (e) { }
      }
      if (i >= origins.length) { return Promise.reject(new Error('No backend origins reachable')); }
      var origin = origins[i++];
      var url = origin.replace(/\/$/, '') + path;
      try {
        return fetch(url).then(function (r) { if (r && r.ok) return r; return attempt(); }).catch(function () { return attempt(); });
      } catch (e) { return attempt(); }
    }
    return attempt();
  }

  // Initial setup
  connectWs();
  observeMainTable();
  ensureLegend();
  updateLegend();
  observeForTable();
  try {
    apiFetch('/api/live-event-ids').then(function (r) { return r && r.ok ? r.json() : null; }).then(function (d) { if (d && Array.isArray(d.ids)) handleLiveIds(d.ids); });
    apiFetch('/api/format-assignments').then(function (r) { return r && r.ok ? r.json() : null; }).then(function (d) { if (d && d.assignments) handleAssignmentsUpdate(d.assignments); });
    apiFetch('/api/format-data').then(function (r) { return r && r.ok ? r.json() : null; }).then(function (d) { if (d && d.data) { buildFormatMaps(d.data); debouncedRebuild(); } });
  } catch (e) { }
})();
