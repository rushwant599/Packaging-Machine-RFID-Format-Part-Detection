(function(){
  function normalizeTag(t){ return (t||'').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g,''); }
  function findFTLIndex(table){
    try{
      var head = table.querySelector('tr.caption[name="TableHead"]');
      var ths = head ? head.querySelectorAll('th') : table.querySelectorAll('thead th');
      for(var i=0;i<ths.length;i++){ var txt=(ths[i].textContent||'').toLowerCase().replace(/\./g,'').trim(); if(txt==='ftl') return i; }
    }catch(e){}
    return 3; // fallback
  }
  function buildMap(){
    var map = new Map();
    // 1) Prefer server-injected cells: any td with data-format-key inside the main table
    document.querySelectorAll('table.main td[data-format-key]').forEach(function(td){
      var key = td.getAttribute('data-format-key');
      if(key){ map.set(key, td); }
    });
    // 2) Fallback: derive and create cells only if missing (legacy case)
    document.querySelectorAll('table.main').forEach(function(table){
      var ftlIdx = findFTLIndex(table);
      table.querySelectorAll('tr').forEach(function(tr){
        try{
          // accept either explicit empty class attribute or missing class attribute
          if(tr.hasAttribute('class')) { if(tr.getAttribute('class')!=="") return; }
          var first = tr.querySelector('td.value.index');
          if(!first) return;
          var tds = tr.querySelectorAll('td');
          if(!tds || tds.length<1) return;
          if(tds[0]!==first) return;
          var nr = (first.textContent||'').trim();
          var ftl = (tds[ftlIdx] && tds[ftlIdx].textContent) ? tds[ftlIdx].textContent.trim() : '';
          if(!nr) return;
          var key = (ftl ? (nr + ' ' + ftl) : nr);
          if(map.has(key)) return; // already mapped from server-injected cell
          var target = tds[2];
          if(!target){
            target = document.createElement('td');
            target.textContent='–';
            target.style.padding='6px 8px';
            target.style.border='1px solid #c5c5c5';
            target.style.fontWeight='700';
            target.style.color='#666';
            if(tds[2]) tds[2].parentNode.insertBefore(target, tds[2]); else tr.appendChild(target);
          }
          target.setAttribute('data-format-key', key);
          map.set(key, target);
        }catch(e){}
      });
    });
    return map;
  }

  var assignments = {};
  var liveSet = new Set();
  var map = buildMap();

  function updateAll(){
    map.forEach(function(td, key){
      var assign = assignments[key];
      var tag = assign || null;
      var norm = tag ? normalizeTag(tag) : null;
      var seen = norm ? liveSet.has(norm) : false;
      var symbol = !tag ? '–' : (seen ? '✔' : '✖');
      td.textContent = symbol;
      td.title = !tag ? ('Kein RFID zugeordnet | Key=' + key) : (seen ? ('Tag ' + tag + ' erkannt | Key=' + key + ' | Norm=' + norm) : ('Tag ' + tag + ' nicht erkannt | Key=' + key + ' | Norm=' + norm));
      td.style.color = tag ? (seen ? '#0a7a15' : '#b30000') : '#666';
    });
  }

  function handleAssignmentsUpdate(obj){ assignments = obj || {}; updateAll(); }
  function handleLiveIds(ids){ liveSet = new Set((ids||[]).map(function(t){ return normalizeTag(t); }).filter(Boolean)); updateAll(); }

  function connectWs(){
    try{
      var proto = location.protocol==='https:'?'wss':'ws';
      var ws = new WebSocket(proto + '://' + location.host + '/ws/opc-ua');
      ws.onopen = function(){};
      ws.onmessage = function(ev){ try{ var msg = JSON.parse(ev.data); if(msg && msg.type==='live_event_ids' && Array.isArray(msg.ids)) handleLiveIds(msg.ids); if(msg && msg.type==='assignments_update' && msg.assignments) handleAssignmentsUpdate(msg.assignments); }catch(e){} };
      ws.onclose = function(){ setTimeout(connectWs,2000); };
      ws.onerror = function(){ try{ ws.close(); }catch(e){} };
    }catch(e){ setTimeout(connectWs,2000); }
  }

  connectWs();
  // initial fetch for snapshot
  try{ fetch('/api/live-event-ids').then(r=>r.ok?r.json():null).then(d=>{ if(d && Array.isArray(d.ids)) handleLiveIds(d.ids); }); fetch('/api/format-assignments').then(r=>r.ok?r.json():null).then(d=>{ if(d && d.assignments) handleAssignmentsUpdate(d.assignments); }); }catch(e){}
})();
