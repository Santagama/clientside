// ==============================================
// LKS 2026 - Client Side Module
// Interactive Map of Indonesia
// ==============================================

var MAP_W = 792.54596;
var MAP_H = 316.66394;

// Transport modes sesuai kisi-kisi
var TRANSPORT = {
    train:    { label: 'Train',    color: '#33E339', speed: 120, cost: 500  },
    bus:      { label: 'Bus',      color: '#A83BE8', speed: 80,  cost: 100  },
    airplane: { label: 'Airplane', color: '#000000', speed: 800, cost: 1000 }
};

// Data persistent dari localStorage
var pins  = JSON.parse(localStorage.getItem('lks_pins')  || '{}');
var conns = JSON.parse(localStorage.getItem('lks_conns') || '[]');

// State peta
var scale = 1, panX = 0, panY = 0;
var panning = false, panStartX, panStartY, panOriginX, panOriginY;
var connectingId = null;
var selectedConn = null;
var sortMode = 'fastest';

// DOM
var viewport     = document.getElementById('viewport');
var mapTransform = document.getElementById('map-transform');
var connLayer    = document.getElementById('connections-layer');
var pinLayer     = document.getElementById('pins-layer');
var popupLayer   = document.getElementById('popups-layer');
var fromInput    = document.getElementById('from-input');
var toInput      = document.getElementById('to-input');
var searchBtn    = document.getElementById('search-btn');
var routeDiv     = document.getElementById('route-results');
var btnFastest   = document.getElementById('sort-fastest');
var btnCheapest  = document.getElementById('sort-cheapest');

// ---- Helpers ----

function save() {
    localStorage.setItem('lks_pins',  JSON.stringify(pins));
    localStorage.setItem('lks_conns', JSON.stringify(conns));
}

function makeId() {
    return 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
}

function applyTransform() {
    mapTransform.style.transform =
        'translate(' + panX + 'px,' + panY + 'px) scale(' + scale + ')';
}

function fitMap() {
    var r = viewport.getBoundingClientRect();
    scale = Math.max(r.width / MAP_W, r.height / MAP_H);
    panX = (r.width  - MAP_W * scale) / 2;
    panY = (r.height - MAP_H * scale) / 2;
    applyTransform();
}

function toMapCoord(cx, cy) {
    var r = viewport.getBoundingClientRect();
    return {
        x: (cx - r.left - panX) / scale,
        y: (cy - r.top  - panY) / scale
    };
}

function zoomAt(cx, cy, dir) {
    var r  = viewport.getBoundingClientRect();
    var mx = cx - r.left, my = cy - r.top;
    var mapX = (mx - panX) / scale;
    var mapY = (my - panY) / scale;
    scale = Math.min(12, Math.max(0.3, scale * (dir > 0 ? 1.15 : 1 / 1.15)));
    panX = mx - mapX * scale;
    panY = my - mapY * scale;
    applyTransform();
}

function getPinByName(name) {
    var n = name.trim().toLowerCase();
    for (var id in pins) {
        if (pins[id].name.trim().toLowerCase() === n) return pins[id];
    }
    return null;
}

function validateSearch() {
    var a = getPinByName(fromInput.value);
    var b = getPinByName(toInput.value);
    searchBtn.disabled = !(a && b && a.id !== b.id);
}

function closePopups() {
    popupLayer.innerHTML = '';
}

function hasClass(el, cls) {
    var c = el.className;
    var s = (typeof c === 'string') ? c : (c && c.baseVal ? c.baseVal : '');
    return s.indexOf(cls) !== -1;
}

// ---- Load SVG Map ----

function loadMap() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'assets/indonesia.svg', true);
    xhr.onload = function() {
        var text = xhr.responseText
            .replace(/<\?xml[^?]*\?>/g, '')
            .replace(/<!--[\s\S]*?-->/g, '');
        document.getElementById('map-layer').innerHTML = text;
    };
    xhr.onerror = function() {
        document.getElementById('map-layer').innerHTML =
            '<img src="assets/indonesia.svg" style="width:100%;height:100%;">';
    };
    xhr.send();
}

// ---- Render Connections ----

function renderConns() {
    connLayer.innerHTML = '';

    // Hitung jumlah koneksi per pasangan pin (untuk parallel offset)
    var pairCount = {}, pairIdx = {};
    for (var i = 0; i < conns.length; i++) {
        var k = [conns[i].from, conns[i].to].sort().join('|');
        pairCount[k] = (pairCount[k] || 0) + 1;
    }

    for (var j = 0; j < conns.length; j++) {
        var c = conns[j];
        var a = pins[c.from], b = pins[c.to];
        if (!a || !b) continue;

        var k2  = [c.from, c.to].sort().join('|');
        var idx = pairIdx[k2] || 0;
        pairIdx[k2] = idx + 1;
        var total   = pairCount[k2];
        var spacing = 8;
        var offset  = (idx - (total - 1) / 2) * spacing;
        var dx = b.x - a.x, dy = b.y - a.y;
        var len = Math.sqrt(dx*dx + dy*dy) || 1;
        var ox = (-dy / len) * offset, oy = (dx / len) * offset;

        var x1 = a.x + ox, y1 = a.y + oy;
        var x2 = b.x + ox, y2 = b.y + oy;
        var spec = TRANSPORT[c.mode];
        if (!spec) continue;

        // Garis koneksi
        var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1); line.setAttribute('y1', y1);
        line.setAttribute('x2', x2); line.setAttribute('y2', y2);
        line.setAttribute('stroke', spec.color);
        line.setAttribute('stroke-width', selectedConn === c.id ? '5' : '3');
        line.setAttribute('class', 'conn-line' + (selectedConn === c.id ? ' selected' : ''));
        line.dataset.id = c.id;
        line.addEventListener('click', function(e) {
            e.stopPropagation();
            selectedConn = this.dataset.id;
            if (document.activeElement && document.activeElement !== document.body) {
                document.activeElement.blur();
            }
            renderConns();
        });
        connLayer.appendChild(line);

        // Label jarak di tengah garis
        var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        var tw = String(c.distance).length * 7 + 10;

        var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bg.setAttribute('x', mx - tw/2); bg.setAttribute('y', my - 7);
        bg.setAttribute('width', tw);    bg.setAttribute('height', 14);
        bg.setAttribute('fill', '#333'); bg.setAttribute('rx', 2);
        connLayer.appendChild(bg);

        var txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        txt.setAttribute('x', mx); txt.setAttribute('y', my);
        txt.setAttribute('class', 'dist-label');
        txt.textContent = c.distance;
        connLayer.appendChild(txt);
    }
}

// ---- Render Pins ----

function makePinSVG() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 36');
    svg.setAttribute('class', 'pin-icon');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('fill', '#e53935');
    path.setAttribute('d', 'M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24S24 21 24 12C24 5.4 18.6 0 12 0zm0 17c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5z');
    svg.appendChild(path);
    return svg;
}

function renderPins() {
    pinLayer.innerHTML = '';

    for (var id in pins) {
        var pin = pins[id];

        var wrap = document.createElement('div');
        wrap.className = 'pin-wrapper' + (connectingId === pin.id ? ' connecting' : '');
        wrap.style.left = pin.x + 'px';
        wrap.style.top  = pin.y + 'px';

        // Label: nama + tombol connect + tombol delete
        var label = document.createElement('div');
        label.className = 'pin-label';

        var nameSpan = document.createElement('span');
        nameSpan.textContent = pin.name;
        label.appendChild(nameSpan);

        // Tombol Connect (⇆)
        var btnConn = document.createElement('button');
        btnConn.className = 'pin-btn';
        btnConn.title = 'Connect';
        btnConn.innerHTML = '&#8646;'; // ⇆
        ;(function(pid) {
            btnConn.addEventListener('click', function(e) {
                e.stopPropagation();
                connectingId = (connectingId === pid) ? null : pid;
                closePopups();
                renderPins();
            });
        })(pin.id);
        label.appendChild(btnConn);

        // Tombol Delete (trash icon)
        var btnDel = document.createElement('button');
        btnDel.className = 'pin-btn';
        btnDel.title = 'Delete';
        btnDel.innerHTML = '&#128465;'; // 🗑
        ;(function(pid) {
            btnDel.addEventListener('click', function(e) {
                e.stopPropagation();
                delete pins[pid];
                conns = conns.filter(function(c) {
                    return c.from !== pid && c.to !== pid;
                });
                if (connectingId === pid) connectingId = null;
                save();
                renderAll();
                validateSearch();
            });
        })(pin.id);
        label.appendChild(btnDel);

        // Klik label → connect ke pin ini
        ;(function(pid) {
            label.addEventListener('click', function(e) {
                if (e.target.tagName === 'BUTTON') return;
                e.stopPropagation();
                if (connectingId && connectingId !== pid) {
                    showConnectPopup(connectingId, pid);
                }
            });
        })(pin.id);

        // Icon pin merah
        var icon = makePinSVG();
        ;(function(pid) {
            icon.addEventListener('click', function(e) {
                e.stopPropagation();
                if (connectingId && connectingId !== pid) {
                    showConnectPopup(connectingId, pid);
                }
            });
        })(pin.id);

        wrap.appendChild(label);
        wrap.appendChild(icon);
        pinLayer.appendChild(wrap);
    }
}

function renderAll() {
    renderConns();
    renderPins();
}

// ---- Popups ----

function showAddPinPopup(x, y) {
    closePopups();
    var popup = makePopup('Add pinpoint', x, y);

    var input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Enter location name';
    popup.body.appendChild(input);

    var btn = document.createElement('button');
    btn.className = 'popup-submit';
    btn.textContent = 'Save';
    popup.body.appendChild(btn);

    function doSave(e) {
        e.stopPropagation();
        var name = input.value.trim();
        if (!name) return;
        var id = makeId();
        pins[id] = { id: id, name: name, x: x, y: y };
        save();
        closePopups();
        renderAll();
        validateSearch();
    }

    btn.addEventListener('click', doSave);
    input.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.stopPropagation(); doSave(e); }
    });

    popupLayer.appendChild(popup.el);
    setTimeout(function() { input.focus(); }, 0);
}

function showConnectPopup(fromId, toId) {
    var a = pins[fromId], b = pins[toId];
    if (!a || !b) return;
    closePopups();
    connectingId = null;
    renderPins();

    var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    var popup = makePopup('Connect', mx, my);

    var distInput = document.createElement('input');
    distInput.type = 'number';
    distInput.min = '1';
    distInput.placeholder = 'Distance (km)';
    popup.body.appendChild(distInput);

    var sel = document.createElement('select');
    sel.innerHTML = '<option value="" disabled selected>Choose mode</option>';
    for (var m in TRANSPORT) {
        var opt = document.createElement('option');
        opt.value = m;
        opt.textContent = TRANSPORT[m].label;
        sel.appendChild(opt);
    }
    popup.body.appendChild(sel);

    var btn = document.createElement('button');
    btn.className = 'popup-submit';
    btn.textContent = 'Submit';
    btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var dist = parseFloat(distInput.value);
        if (!dist || dist <= 0 || !sel.value) return;
        conns.push({ id: makeId(), from: fromId, to: toId, distance: dist, mode: sel.value });
        save();
        closePopups();
        renderAll();
    });
    popup.body.appendChild(btn);

    distInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') btn.click();
    });

    popupLayer.appendChild(popup.el);
    distInput.focus();
}

function makePopup(title, x, y) {
    var el = document.createElement('div');
    el.className = 'map-popup';
    el.style.left = x + 'px';
    el.style.top  = y + 'px';

    var header = document.createElement('div');
    header.className = 'popup-header';

    var h3 = document.createElement('h3');
    h3.textContent = title;
    header.appendChild(h3);

    var closeBtn = document.createElement('button');
    closeBtn.className = 'popup-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        closePopups();
        connectingId = null;
        renderPins();
    });
    header.appendChild(closeBtn);
    el.appendChild(header);

    var body = document.createElement('div');
    body.style.display = 'flex';
    body.style.flexDirection = 'column';
    body.style.gap = '6px';
    el.appendChild(body);

    return { el: el, body: body };
}

// ---- Route Finding ----

// DFS cari semua rute dari startId ke endId
function findRoutes(startId, endId) {
    var results = [];
    function dfs(cur, path, visited) {
        if (cur === endId) { results.push(path.slice()); return; }
        visited[cur] = true;
        for (var i = 0; i < conns.length; i++) {
            var c = conns[i];
            var next = null;
            if (c.from === cur) next = c.to;
            else if (c.to === cur) next = c.from;
            if (!next || visited[next]) continue;
            path.push(c);
            dfs(next, path, visited);
            path.pop();
        }
        delete visited[cur];
    }
    dfs(startId, [], {});
    return results;
}

function calcRoute(segs) {
    var cost = 0, hours = 0;
    for (var i = 0; i < segs.length; i++) {
        var t = TRANSPORT[segs[i].mode];
        if (!t) continue;
        cost  += segs[i].distance * t.cost;
        hours += segs[i].distance / t.speed;
    }
    return { cost: cost, hours: hours };
}

function buildSteps(segs, startId) {
    var steps = [], cur = startId;
    for (var i = 0; i < segs.length; i++) {
        var next = (segs[i].from === cur) ? segs[i].to : segs[i].from;
        steps.push(
            (i + 1) + '. ' + pins[cur].name + ' \u2192 ' + pins[next].name +
            ' (' + TRANSPORT[segs[i].mode].label + ', ' + segs[i].distance + ' km)'
        );
        cur = next;
    }
    return steps;
}

function buildName(segs, startId) {
    var names = [pins[startId].name], cur = startId;
    for (var i = 0; i < segs.length; i++) {
        cur = (segs[i].from === cur) ? segs[i].to : segs[i].from;
        names.push(pins[cur].name);
    }
    return names.join(' - ');
}

function fmtHours(h) {
    if (h < 1) return Math.round(h * 60) + 'm';
    var full = Math.floor(h);
    var mins = Math.round((h - full) * 60);
    return full + 'h' + (mins > 0 ? ' ' + mins + 'm' : '');
}

function fmtCost(n) {
    return 'Rp' + n.toLocaleString('id-ID');
}

function doSearch() {
    var a = getPinByName(fromInput.value);
    var b = getPinByName(toInput.value);
    if (!a || !b) { routeDiv.innerHTML = '<p class="no-routes">Invalid pinpoint name.</p>'; return; }

    var raw = findRoutes(a.id, b.id);
    var routes = raw.map(function(segs) {
        var m = calcRoute(segs);
        return { segs: segs, cost: m.cost, hours: m.hours };
    });

    routes.sort(function(x, y) {
        return sortMode === 'fastest' ? x.hours - y.hours : x.cost - y.cost;
    });
    routes = routes.slice(0, 10);

    routeDiv.innerHTML = '';
    if (!routes.length) {
        routeDiv.innerHTML = '<p class="no-routes">No routes found.</p>';
        return;
    }

    for (var i = 0; i < routes.length; i++) {
        var r = routes[i];
        var card = document.createElement('div');
        card.className = 'route-card';

        var header = document.createElement('div');
        header.className = 'route-card-header';
        var h3 = document.createElement('h3');
        h3.textContent = buildName(r.segs, a.id);
        var dur = document.createElement('span');
        dur.className = 'duration';
        dur.textContent = fmtHours(r.hours);
        header.appendChild(h3);
        header.appendChild(dur);
        card.appendChild(header);

        var steps = buildSteps(r.segs, a.id);
        for (var s = 0; s < steps.length; s++) {
            var step = document.createElement('div');
            step.className = 'route-step';
            step.textContent = steps[s];
            card.appendChild(step);
        }

        var summary = document.createElement('div');
        summary.className = 'route-summary';
        var cost = document.createElement('span');
        cost.className = 'cost';
        cost.textContent = fmtCost(r.cost);
        summary.appendChild(cost);
        card.appendChild(summary);

        routeDiv.appendChild(card);
    }
}

// ---- Event Listeners ----

// Zoom: CTRL + Scroll
viewport.addEventListener('wheel', function(e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// Zoom: CTRL+= / CTRL+- , Delete koneksi terpilih
document.addEventListener('keydown', function(e) {
    if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        var r = viewport.getBoundingClientRect();
        zoomAt(r.left + r.width/2, r.top + r.height/2, 1);
    }
    if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        var r2 = viewport.getBoundingClientRect();
        zoomAt(r2.left + r2.width/2, r2.top + r2.height/2, -1);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConn) {
        var tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        conns = conns.filter(function(c) { return c.id !== selectedConn; });
        selectedConn = null;
        save();
        renderConns();
    }
});

// Pan: drag
viewport.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    if (e.target.closest && (e.target.closest('.pin-wrapper') || e.target.closest('.map-popup'))) return;
    if (hasClass(e.target, 'conn-line')) return;
    panning = true;
    viewport.classList.add('panning');
    panStartX  = e.clientX; panStartY  = e.clientY;
    panOriginX = panX;      panOriginY = panY;
    selectedConn = null;
    renderConns();
});

window.addEventListener('mousemove', function(e) {
    if (!panning) return;
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    applyTransform();
});

window.addEventListener('mouseup', function() {
    panning = false;
    viewport.classList.remove('panning');
});

// Double-click di peta → tambah pinpoint
viewport.addEventListener('dblclick', function(e) {
    if (e.target.closest && (e.target.closest('.pin-wrapper') || e.target.closest('.map-popup'))) return;
    var cls = e.target.className;
    var clsStr = (typeof cls === 'string') ? cls : (cls && cls.baseVal ? cls.baseVal : '');
    if (clsStr.indexOf('conn-line') !== -1) return;
    var pos = toMapCoord(e.clientX, e.clientY);
    if (pos.x < 0 || pos.y < 0 || pos.x > MAP_W || pos.y > MAP_H) return;
    showAddPinPopup(pos.x, pos.y);
});

// Klik area kosong → deselect koneksi
viewport.addEventListener('click', function(e) {
    if (e.target.closest && e.target.closest('.map-popup')) return;
    if (!hasClass(e.target, 'conn-line')) {
        selectedConn = null;
        renderConns();
    }
});

// Sidebar
fromInput.addEventListener('input', validateSearch);
toInput.addEventListener('input', validateSearch);
searchBtn.addEventListener('click', doSearch);

btnFastest.addEventListener('click', function() {
    sortMode = 'fastest';
    btnFastest.classList.add('active');
    btnCheapest.classList.remove('active');
    if (!searchBtn.disabled) doSearch();
});

btnCheapest.addEventListener('click', function() {
    sortMode = 'cheapest';
    btnCheapest.classList.add('active');
    btnFastest.classList.remove('active');
    if (!searchBtn.disabled) doSearch();
});

window.addEventListener('resize', fitMap);

// ---- Init ----
loadMap();
fitMap();
renderAll();
validateSearch();
