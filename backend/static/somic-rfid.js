(function(){
  // Utility: debounce
  function debounce(fn, ms){ var t; return function(){ var ctx=this, args=arguments; clearTimeout(t); t=setTimeout(function(){ fn.apply(ctx,args); }, ms); }; }
  function normalizeTag(t){ return (t||'').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g,''); }
  function findFTLIndex(table){
    try{
      var head = table.querySelector('tr.caption[name="TableHead"]');
      var ths = head ? head.querySelectorAll('th') : table.querySelectorAll('thead th');
      for(var i=0;i<ths.length;i++){
        var txt=(ths[i].textContent||'').toLowerCase().replace(/\./g,'').trim();
        if(txt==='ftl') return i;
      }
    }catch(e){}
    return 3; // fallback
  }

  // Build a mapping from data-format-key -> target td element for the current table view
  function buildMap(){
    var map = new Map();
    var tables = document.querySelectorAll('table.main');
    if(!tables || !tables.length) return map;
    tables.forEach(function(table){
      var rows = table.querySelectorAll('tr');
      rows.forEach(function(tr){
        try{
          // Accept any row that has a first cell with class td.value.index
          // (Some pages add classes to data rows; don't over-filter by class attr)
          var first = tr.querySelector('td.value.index');
          if(!first) return;
          var tds = tr.querySelectorAll('td');
          if(!tds || tds.length<1) return;
          if(tds[0]!==first) return;
          var nr = (first.textContent||'').trim();
          if(!nr) return;
          // Get FTL from current format JSON mapping (preferred), fallback to table cell if unknown
          var ftl = getFtlForNr(nr);
          if(!ftl){
            var ftlIdx = findFTLIndex(table);
            ftl = (tds[ftlIdx] && tds[ftlIdx].textContent) ? tds[ftlIdx].textContent.trim() : '';
          }
          var key = ftl ? (nr + ' ' + ftl) : nr;
          // Prefer existing td with data-format-key inside this row
          var target = tr.querySelector('td[data-format-key]');
          if(!target){
            // No RFID cell yet -> create one and insert before the 3rd column (index 2) if present
            target = document.createElement('td');
            target.textContent='–';
            target.style.padding='6px 8px';
            target.style.border='1px solid #c5c5c5';
            target.style.fontWeight='700';
            target.style.color='#666';
            if(tds[2]) tds[2].parentNode.insertBefore(target, tds[2]); else tr.appendChild(target);
          }
          target.setAttribute('data-format-key', key);
          target.setAttribute('data-nr', nr);
          if(ftl) target.setAttribute('data-ftl', ftl); else target.removeAttribute('data-ftl');
          map.set(key, target);
        }catch(e){}
      });
    });
    return map;
  }

  var assignments = {};
  var liveSet = new Set();
  var map = buildMap();
  var wsState = 'connecting'; // connecting | connected | reconnecting | error

  // --- Format JSON handling (active format -> NR to FTL mapping) ---
  var formatMaps = { byFormat: {}, names: [] };
  var currentFormat = null;
  function setCurrentFormat(fmt){
    try{
      if(!fmt || typeof fmt !== 'string') return;
      if(formatMaps && Array.isArray(formatMaps.names) && formatMaps.names.indexOf(fmt) !== -1){
        currentFormat = fmt;
        debouncedRebuild();
      }
    }catch(e){}
  }
  function buildFormatMaps(data){
    try{
      var fmts = (data && data.formats) || {};
      var names = Object.keys(fmts);
      var by = {};
      names.forEach(function(name){
        var fmt = fmts[name] || {};
        var arr = Array.isArray(fmt.data) ? fmt.data : [];
        var nrToFtl = {};
        for(var i=0;i<arr.length;i++){
          var it = arr[i];
          if(!it || typeof it !== 'object') continue;
          var nr = (it.valueIndex||'').toString().trim();
          var ftl = (it.formatPart||'').toString().trim();
          if(!nr) continue;
          if(!ftl || /^FTL\.?$/i.test(ftl)) continue; // ignore placeholders
          if(!nrToFtl[nr]) nrToFtl[nr] = ftl;
        }
        by[name] = nrToFtl;
      });
      formatMaps.byFormat = by;
      formatMaps.names = names;
      // Initialize current format if not set
      if(!currentFormat){
        // Heuristics: try common globals or DOM selects
        var candidates = [];
        try{ if(window.SelectedFormat) candidates.push(window.SelectedFormat); }catch(e){}
        try{ if(window.selectedFormat) candidates.push(window.selectedFormat); }catch(e){}
        try{ if(window.ActiveFormat) candidates.push(window.ActiveFormat); }catch(e){}
        try{ if(window.activeFormat) candidates.push(window.activeFormat); }catch(e){}
        // Try selects containing format names
        try{
          var sels = document.querySelectorAll('select, input[list]');
          outer: for(var sidx=0;sidx<sels.length;sidx++){
            var sel = sels[sidx];
            if(sel && sel.tagName === 'SELECT'){
              var opt = sel.options && sel.options[sel.selectedIndex];
              if(opt && opt.text && names.indexOf(opt.text.trim()) !== -1){ candidates.push(opt.text.trim()); break outer; }
              if(opt && opt.value && names.indexOf(opt.value.trim()) !== -1){ candidates.push(opt.value.trim()); break outer; }
            }
          }
        }catch(e){}
        for(var c=0;c<candidates.length;c++){
          var nm = (candidates[c]||'').toString().trim();
          if(names.indexOf(nm) !== -1){ currentFormat = nm; break; }
        }
        if(!currentFormat && names.length){ currentFormat = names[0]; }
      }
    }catch(e){}
  }
  function getFtlForNr(nr){
    try{
      if(!nr) return '';
      if(currentFormat && formatMaps && formatMaps.byFormat){
        var m = formatMaps.byFormat[currentFormat];
        if(m){
          var f = m[nr];
          if(f) return f;
          // also try zero-padded or trimmed variants
          var nrTrim = nr.toString().replace(/^0+/, '');
          if(nrTrim && m[nrTrim]) return m[nrTrim];
          var nrPad = nrTrim ? ('0'+nrTrim) : null;
          if(nrPad && m[nrPad]) return m[nrPad];
        }
      }
    }catch(e){}
    return '';
  }

  // --- Optional Legend / Status Badge ---
  function isLegendEnabled(){
    try{
      var meta = document.querySelector('meta[name="somic-rfid-legend"]');
      if(meta){ return (meta.getAttribute('content')||'1') !== '0'; }
    }catch(e){}
    return true; // default on
  }

  var legendEl = null;
  function placeLegend(){
    try{
      if(!legendEl) return;
      var table = document.querySelector('table.main');
      if(table && table.parentNode){
        if(legendEl.nextSibling !== table){
          table.parentNode.insertBefore(legendEl, table);
        }
      } else if(document.body && legendEl.parentNode !== document.body){
        document.body.insertBefore(legendEl, document.body.firstChild);
      }
    }catch(e){}
  }
  function ensureLegend(){
    if(!isLegendEnabled()) return null;
    if(legendEl && document.body.contains(legendEl)) return legendEl;
    var table = document.querySelector('table.main');
    var el = document.createElement('div');
    el.setAttribute('id','somic-rfid-legend');
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
    dot.setAttribute('id','somic-rfid-ws-dot');
    dot.style.display = 'inline-block';
    dot.style.width = '10px';
    dot.style.height = '10px';
    dot.style.borderRadius = '50%';
    dot.style.background = '#f0ad4e';
    dot.style.boxShadow = '0 0 0 1px rgba(0,0,0,0.05)';

    var txt = document.createElement('span');
    txt.setAttribute('id','somic-rfid-legend-text');
    txt.textContent = 'RFID: ✔ erkannt, ✖ nicht erkannt, – nicht zugeordnet';

    var live = document.createElement('span');
    live.setAttribute('id','somic-rfid-livecount');
    live.style.opacity = '0.8';
    live.textContent = '(Live: 0)';

  var wrong = document.createElement('span');
  wrong.setAttribute('id','somic-rfid-wrongcount');
  wrong.style.opacity = '0.8';
  wrong.textContent = '(Falsch: 0)';

    el.appendChild(dot);
    el.appendChild(txt);
    el.appendChild(live);
  el.appendChild(wrong);

    if(table && table.parentNode){
      table.parentNode.insertBefore(el, table);
    } else {
      document.body.insertBefore(el, document.body.firstChild);
    }
    legendEl = el;
    placeLegend();
    return el;
  }

  // Compute number of tags that are currently seen but not part of the active format rows
  function computeWrongCount(){
    try{
      // Build expected set from current table mapping using current assignments
      var expected = new Set();
      map.forEach(function(td){
        var tag = resolveAssignmentForTd(td);
        var norm = tag ? normalizeTag(tag) : null;
        if(norm) expected.add(norm);
      });
      var wrong = 0;
      if(liveSet && typeof liveSet.forEach === 'function'){
        liveSet.forEach(function(t){ if(!expected.has(t)) wrong++; });
      }
      return wrong;
    }catch(e){ return 0; }
  }

  function updateLegend(){
    var el = ensureLegend();
    if(!el) return;
    var dot = el.querySelector('#somic-rfid-ws-dot');
    var live = el.querySelector('#somic-rfid-livecount');
    var wrong = el.querySelector('#somic-rfid-wrongcount');
    if(dot){
      var color = '#f0ad4e'; // default/connecting
      if(wsState==='connected') color = '#2eb85c';
      else if(wsState==='reconnecting') color = '#f0ad4e';
      else if(wsState==='error') color = '#d9534f';
      else if(wsState==='connecting') color = '#f0ad4e';
      dot.style.background = color;
      dot.title = 'WebSocket: ' + wsState;
    }
    if(live){ live.textContent = '(Live: ' + (liveSet ? liveSet.size : 0) + ')'; }
    if(wrong){ wrong.textContent = '(Falsch: ' + computeWrongCount() + ')'; }
  }

  // Resolve assignment for a given TD by trying multiple key variants (exact, normalized, FTL-only)
  function resolveAssignmentForTd(td){
    if(!td) return null;
    var dataKey = td.getAttribute('data-format-key') || '';
    var nr = td.getAttribute('data-nr') || '';
    var ftl = td.getAttribute('data-ftl') || '';
    var candidates = [];
    // Combined key candidates
    if(dataKey){
      candidates.push(dataKey);
      candidates.push(dataKey.replace(/\s+/g,' ').trim());
      candidates.push(dataKey.replace(/\./g,'').replace(/\s+/g,' ').trim());
    }
    if(nr && ftl){
      var k = nr + ' ' + ftl;
      candidates.push(k);
      candidates.push((nr + ' ' + ftl.replace(/\./g,'')));
      candidates.push(k.replace(/\./g,'').replace(/\s+/g,' ').trim());
    }
    // FTL-only candidates (some backends store by format part only)
    if(ftl){
      candidates.push(ftl);
      candidates.push(ftl.replace(/\./g,''));
      candidates.push(ftl.replace(/\s+/g,''));
    }
    // Deduplicate
    var seenC = new Set();
    var final = [];
    for(var i=0;i<candidates.length;i++){ var c=candidates[i]; if(c && !seenC.has(c)){ seenC.add(c); final.push(c);} }
    // Try resolving
    for(var j=0;j<final.length;j++){
      var key = final[j];
      var assign = assignments[key];
      if(assign){
        if(typeof assign === 'string') return assign;
        if(assign && typeof assign === 'object'){
          var maybe = assign.rfid_tag_id || assign.rfidTagId || assign.tagId || null;
          if(maybe) return maybe;
        }
      }
    }
    return null;
  }

  function updateAll(){
    map.forEach(function(td){
      var tag = resolveAssignmentForTd(td);
      var norm = tag ? normalizeTag(tag) : null;
      var seen = norm ? liveSet.has(norm) : false;
      var symbol = !tag ? '–' : (seen ? '✔' : '✖');
      td.textContent = symbol;
      var kinfo = td.getAttribute('data-format-key') || '';
      td.title = !tag ? ('Kein RFID zugeordnet | Key=' + kinfo) : (seen ? ('Tag ' + tag + ' erkannt | Key=' + kinfo + ' | Norm=' + norm) : ('Tag ' + tag + ' nicht erkannt | Key=' + kinfo + ' | Norm=' + norm));
      td.style.color = tag ? (seen ? '#0a7a15' : '#b30000') : '#666';
    });
    updateLegend();
  }

  function handleAssignmentsUpdate(obj){ assignments = obj || {}; updateAll(); }
  function handleLiveIds(ids){ liveSet = new Set((ids||[]).map(function(t){ return normalizeTag(t); }).filter(Boolean)); updateAll(); }

  function rebuildMap(){ map = buildMap(); updateAll(); }
  var debouncedRebuild = debounce(rebuildMap, 100);

  function observeMainTable(){
    try{
      var table = document.querySelector('table.main');
      if(!table) return;
      var observer = new MutationObserver(function(){ debouncedRebuild(); });
      observer.observe(table, { childList: true, subtree: true, attributes: true, characterData: true });
    }catch(e){}
  }

  // Observe the document for late insertion of table.main and reposition legend
  function observeForTable(){
    try{
      if(document.querySelector('table.main')) return; // already present
      var docObs = new MutationObserver(function(){
        var t = document.querySelector('table.main');
        if(t){
          try{ docObs.disconnect(); }catch(e){}
          observeMainTable();
          ensureLegend();
          placeLegend();
          debouncedRebuild();
        }
      });
      var target = document.body || document.documentElement;
      if(target){ docObs.observe(target, { childList: true, subtree: true }); }
    }catch(e){}
  }

  function hookFn(name){
    try{
      var fn = window[name];
      if(typeof fn==='function'){
        window[name] = function(){
          // capture potential format name arguments
          try{
            if(name === 'setActiveFormat' && arguments && arguments.length){ setCurrentFormat(arguments[0]); }
            if(name === 'setDiffFormat' && arguments && arguments.length){
              // prefer second arg as target format if present
              var toFmt = arguments[1]; var fromFmt = arguments[0];
              if(typeof toFmt === 'string') setCurrentFormat(toFmt); else if(typeof fromFmt === 'string') setCurrentFormat(fromFmt);
            }
          }catch(e){}
          var r = fn.apply(this, arguments);
          setTimeout(debouncedRebuild, 0);
          return r;
        };
      }
    }catch(e){}
  }
  hookFn('setActiveFormat');
  hookFn('setDiffFormat');
  hookFn('updateValue');
  hookFn('onValueChanged');

  var DEFAULT_BACKEND_PORT = 8001;
  function backendOrigins(){
    var list = [];
    try{
      // Determine page context (handles blob: documents)
      var ref = (typeof document !== 'undefined' && document.referrer) ? document.referrer : '';
      var refUrl = null;
      try{ if(ref) refUrl = new URL(ref); }catch(e){}
      var locProto = (typeof location !== 'undefined' ? location.protocol : '');
      var isHttpLike = /^https?:$/.test(locProto);
      var isHttps = (locProto === 'https:') || (refUrl && refUrl.protocol === 'https:');

      // 1) Meta override (explicit)
      var m = document.querySelector('meta[name="somic-backend-origin"]');
      var c = m && m.getAttribute('content');
      if(c){
        try{
          var mu = new URL(c);
          if(mu.hostname && mu.hostname !== '0.0.0.0'){
            if(!(isHttps && mu.protocol === 'http:')){
              var mo = mu.origin; if(list.indexOf(mo) === -1) list.push(mo);
            }
          }
        }catch(e){}
      }

      // 2) Referrer origin (parent page that created blob)
      if(refUrl && /^https?:$/.test(refUrl.protocol)){
        var ro = refUrl.origin; if(list.indexOf(ro) === -1) list.push(ro);
      }

      // 3) Same document origin (only if http(s))
      if(isHttpLike && location.origin){ if(list.indexOf(location.origin) === -1) list.push(location.origin); }

      // 4) Dev fallback to localhost:8001 only when parent or self are localhost
      try{
        var host = (refUrl && refUrl.hostname) || (location && location.hostname) || '';
        var isLocal = (host === 'localhost' || host === '127.0.0.1' || host === '::1');
        if(isLocal){
          var useProto = isHttps ? 'https:' : ((locProto && /^https?:$/.test(locProto)) ? locProto : 'http:');
          var devOrigin = useProto + '//' + (host || 'localhost') + ':' + DEFAULT_BACKEND_PORT;
          if(list.indexOf(devOrigin) === -1) list.push(devOrigin);
        }
      }catch(e){}
    }catch(e){}
    return list;
  }

  function connectWs(){
    var origins = backendOrigins();
    var idx = 0;
    var connectedOnce = false;
    function tryNext(){
      if(idx >= origins.length){ wsState='error'; updateLegend(); setTimeout(connectWs, 2000); return; }
      var origin = origins[idx++];
      var u;
      try{ u = new URL(origin); }catch(e){ return tryNext(); }
      // Force wss when page/referrer is https to avoid mixed content
      var pageHttps = false;
      try{
        if(location && location.protocol === 'https:') pageHttps = true;
        else if(document && document.referrer){ var r = new URL(document.referrer); if(r.protocol==='https:') pageHttps = true; }
      }catch(e){}
      var proto = pageHttps ? 'wss' : ((u.protocol==='https:') ? 'wss' : 'ws');
      var wsUrl = proto + '://' + u.host + '/ws/opc-ua';
      var ws;
      try{ ws = new WebSocket(wsUrl); }catch(e){ return tryNext(); }
      var opened = false;
      ws.onopen = function(){ opened = true; connectedOnce = true; wsState='connected'; updateLegend(); };
      ws.onmessage = function(ev){
        try{
          var msg = JSON.parse(ev.data);
          if(msg && msg.type==='live_event_ids' && Array.isArray(msg.ids)) handleLiveIds(msg.ids);
          if(msg && msg.type==='assignments_update' && msg.assignments) handleAssignmentsUpdate(msg.assignments);
        }catch(e){}
      };
      ws.onclose = function(){
        if(!opened){ // failed before open -> try next origin immediately
          return tryNext();
        }
        wsState='reconnecting'; updateLegend(); setTimeout(connectWs, 2000);
      };
      ws.onerror = function(){ if(!opened){ try{ ws.close(); }catch(e){} tryNext(); } else { wsState='error'; updateLegend(); try{ ws.close(); }catch(e){} } };
    }
    tryNext();
  }

  // Helper to fetch from backend with absolute URL
  function apiFetch(path){
    var origins = backendOrigins();
    var i = 0;
    var triedRelative = false;
    function attempt(){
      // Try same-origin relative first (works when behind reverse proxy on https)
      if(!triedRelative){
        triedRelative = true;
        try{
          return fetch(path).then(function(r){ if(r && r.ok) return r; return attempt(); }).catch(function(){ return attempt(); });
        }catch(e){ /* fallthrough */ }
      }
      if(i >= origins.length){ return Promise.reject(new Error('No backend origins reachable')); }
      var origin = origins[i++];
      var url = origin.replace(/\/$/,'') + path;
      try{
        return fetch(url).then(function(r){ if(r && r.ok) return r; return attempt(); }).catch(function(){ return attempt(); });
      }catch(e){ return attempt(); }
    }
    return attempt();
  }

  connectWs();
  observeMainTable();
  ensureLegend();
  updateLegend();
  observeForTable();
  try{
    apiFetch('/api/live-event-ids').then(function(r){ return r && r.ok ? r.json() : null; }).then(function(d){ if(d && Array.isArray(d.ids)) handleLiveIds(d.ids); });
    apiFetch('/api/format-assignments').then(function(r){ return r && r.ok ? r.json() : null; }).then(function(d){ if(d && d.assignments) handleAssignmentsUpdate(d.assignments); });
    // Load format data once to build NR->FTL maps and detect current format
    apiFetch('/api/format-data').then(function(r){ return r && r.ok ? r.json() : null; }).then(function(d){ if(d && d.data){ buildFormatMaps(d.data); debouncedRebuild(); } });
  }catch(e){}
})();
