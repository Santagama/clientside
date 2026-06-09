// ═══════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════

// Ukuran asli SVG peta Indonesia
var MAP_W = 792.54596;
var MAP_H = 316.66394;

// Mode transportasi: warna garis, kecepatan (km/h), biaya per km
var TRANSPORT = {
    train:    { label: 'Train',    color: '#33E339', speed: 120, cost: 500  },
    bus:      { label: 'Bus',      color: '#A83BE8', speed: 80,  cost: 100  },
    airplane: { label: 'Airplane', color: '#000000', speed: 800, cost: 1000 }
};


// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════

// Data pin dan koneksi — disimpan di localStorage agar tidak hilang saat refresh
var pins  = JSON.parse(localStorage.getItem('lks_pins')  || '{}');
var conns = JSON.parse(localStorage.getItem('lks_conns') || '[]');

// Pan & zoom
var scale      = 1;
var panX       = 0;
var panY       = 0;
var panning    = false;
var panStartX, panStartY, panOriginX, panOriginY;

// Interaksi
var connectingId = null;   // id pin yang sedang mode "pilih tujuan koneksi"
var selectedConn = null;   // id koneksi yang sedang dipilih (bisa dihapus)
var sortMode     = 'fastest';


// ═══════════════════════════════════════
//  DOM REFERENCES
// ═══════════════════════════════════════

function $(id) { return document.getElementById(id); }

var viewport     = $('viewport');
var mapTransform = $('map-transform');
var connLayer    = $('connections-layer');
var pinLayer     = $('pins-layer');
var popupLayer   = $('popups-layer');
var fromInput    = $('from-input');
var toInput      = $('to-input');
var searchBtn    = $('search-btn');
var routeDiv     = $('route-results');
var btnFastest   = $('sort-fastest');
var btnCheapest  = $('sort-cheapest');


// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════

// Simpan data ke localStorage
function save() {
    localStorage.setItem('lks_pins',  JSON.stringify(pins));
    localStorage.setItem('lks_conns', JSON.stringify(conns));
}

// Buat ID unik untuk pin / koneksi baru
function makeId() {
    return 'p' + Date.now() + Math.random().toString(36).slice(2, 6);
}

// Shortcut createElement — bisa set attrs dan teks sekaligus
function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs) e[k] = attrs[k];
    if (text) e.textContent = text;
    return e;
}

// Shortcut createElement untuk SVG (butuh namespace berbeda)
function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
}

// Terapkan posisi pan dan level zoom ke map-transform
function applyTransform() {
    mapTransform.style.transform =
        'translate(' + panX + 'px,' + panY + 'px) scale(' + scale + ')';
}

// Sesuaikan skala awal agar peta mengisi viewport
function fitMap() {
    var r = viewport.getBoundingClientRect();
    scale = Math.max(r.width / MAP_W, r.height / MAP_H);
    panX  = (r.width  - MAP_W * scale) / 2;
    panY  = (r.height - MAP_H * scale) / 2;
    applyTransform();
}

// Konversi koordinat layar → koordinat di dalam peta (mempertimbangkan pan & zoom)
function toMapCoord(cx, cy) {
    var r = viewport.getBoundingClientRect();
    return {
        x: (cx - r.left - panX) / scale,
        y: (cy - r.top  - panY) / scale
    };
}

// Zoom masuk/keluar berpusat di titik (cx, cy) layar
function zoomAt(cx, cy, dir) {
    var r    = viewport.getBoundingClientRect();
    var mx   = cx - r.left;
    var my   = cy - r.top;
    var mapX = (mx - panX) / scale;
    var mapY = (my - panY) / scale;
    scale = Math.min(12, Math.max(0.3, scale * (dir > 0 ? 1.15 : 1 / 1.15)));
    panX  = mx - mapX * scale;
    panY  = my - mapY * scale;
    applyTransform();
}

// Cari pin berdasarkan nama (case-insensitive)
function getPinByName(name) {
    var n = name.trim().toLowerCase();
    for (var id in pins) {
        if (pins[id].name.trim().toLowerCase() === n) return pins[id];
    }
    return null;
}

// Aktifkan tombol Search hanya jika From dan To valid dan berbeda
function validateSearch() {
    var a = getPinByName(fromInput.value);
    var b = getPinByName(toInput.value);
    searchBtn.disabled = !(a && b && a.id !== b.id);
}

// Hapus semua popup dari layar
function closePopups() {
    popupLayer.innerHTML = '';
}

// Format durasi menjadi "2h 30m" atau "45m"
function fmtHours(h) {
    if (h < 1) return Math.round(h * 60) + 'm';
    var f = Math.floor(h);
    var m = Math.round((h - f) * 60);
    return f + 'h' + (m > 0 ? ' ' + m + 'm' : '');
}

// Format biaya dalam Rupiah
function fmtCost(n) {
    return 'Rp' + n.toLocaleString('id-ID');
}


// ═══════════════════════════════════════
//  LOAD PETA SVG
// ═══════════════════════════════════════

function loadMap() {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', 'assets/indonesia.svg', true);
    xhr.onload = function () {
        // Bersihkan deklarasi XML sebelum dimasukkan ke innerHTML
        $('map-layer').innerHTML = xhr.responseText
            .replace(/<\?xml[^?]*\?>/g, '')
            .replace(/<!--[\s\S]*?-->/g, '');
    };
    xhr.send();
}


// ═══════════════════════════════════════
//  RENDER KONEKSI
// ═══════════════════════════════════════

function renderConns() {
    connLayer.innerHTML = '';

    // Hitung jumlah koneksi per pasangan pin (untuk offset garis paralel)
    var pairCount = {};
    var pairIdx   = {};
    for (var i = 0; i < conns.length; i++) {
        var k = [conns[i].from, conns[i].to].sort().join('|');
        pairCount[k] = (pairCount[k] || 0) + 1;
    }

    for (var j = 0; j < conns.length; j++) {
        var c = conns[j];
        var a = pins[c.from];
        var b = pins[c.to];
        if (!a || !b || !TRANSPORT[c.mode]) continue;

        // Offset agar garis paralel tidak tumpang tindih
        var key = [c.from, c.to].sort().join('|');
        var idx = pairIdx[key] || 0;
        pairIdx[key] = idx + 1;
        var off = (idx - (pairCount[key] - 1) / 2) * 8;
        var dx  = b.x - a.x;
        var dy  = b.y - a.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var ox  = (-dy / len) * off;
        var oy  = ( dx / len) * off;

        var x1 = a.x + ox;
        var y1 = a.y + oy;
        var x2 = b.x + ox;
        var y2 = b.y + oy;
        var mx = (x1 + x2) / 2;
        var my = (y1 + y2) / 2;

        // Gambar garis
        var line = svgEl('line', {
            x1: x1, y1: y1, x2: x2, y2: y2,
            stroke: TRANSPORT[c.mode].color,
            'stroke-width': selectedConn === c.id ? '5' : '3',
            class: 'conn-line' + (selectedConn === c.id ? ' selected' : ''),
            'data-id': c.id
        });
        line.addEventListener('click', function (e) {
            e.stopPropagation();
            selectedConn = this.getAttribute('data-id');
            renderConns();
        });
        connLayer.appendChild(line);

        // Label jarak di tengah garis
        var tw = String(c.distance).length * 7 + 10;
        connLayer.appendChild(svgEl('rect', {
            x: mx - tw / 2, y: my - 7,
            width: tw, height: 14,
            fill: '#333', rx: 2
        }));
        var txt = svgEl('text', { x: mx, y: my, class: 'dist-label' });
        txt.textContent = c.distance;
        connLayer.appendChild(txt);
    }
}


// ═══════════════════════════════════════
//  RENDER PIN
// ═══════════════════════════════════════

// Event delegation — satu listener untuk semua pin, tidak perlu listener per-pin
pinLayer.addEventListener('click', function (e) {
    var wrap = e.target.closest('.pin-wrapper');
    if (!wrap) return;
    var pid = wrap.dataset.id;

    if (e.target.classList.contains('btn-conn')) {
        // Toggle mode connecting
        e.stopPropagation();
        connectingId = (connectingId === pid) ? null : pid;
        closePopups();
        renderPins();

    } else if (e.target.classList.contains('btn-del')) {
        // Hapus pin beserta semua koneksinya
        e.stopPropagation();
        delete pins[pid];
        conns = conns.filter(function (c) { return c.from !== pid && c.to !== pid; });
        if (connectingId === pid) connectingId = null;
        save();
        renderConns();
        renderPins();
        validateSearch();

    } else if (connectingId && connectingId !== pid) {
        // Klik pin lain saat mode connecting → buka popup koneksi
        e.stopPropagation();
        showConnectPopup(connectingId, pid);
    }
});

function renderPins() {
    pinLayer.innerHTML = '';

    for (var id in pins) {
        var pin  = pins[id];
        var wrap = el('div', {
            className: 'pin-wrapper' + (connectingId === pin.id ? ' connecting' : '')
        });
        wrap.style.left = pin.x + 'px';
        wrap.style.top  = pin.y + 'px';
        wrap.dataset.id = pin.id;

        // Label: nama + tombol Connect dan Delete
        var label = el('div', { className: 'pin-label' });
        label.innerHTML =
            '<span>' + pin.name + '</span>' +
            '<button class="pin-btn btn-conn" title="Connect">&#8646;</button>' +
            '<button class="pin-btn btn-del"  title="Delete">&#128465;</button>';

        // Icon pin merah (SVG inline)
        var icon = svgEl('svg', { viewBox: '0 0 24 36', class: 'pin-icon' });
        icon.innerHTML = '<path fill="#e53935" d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24S24 21 24 12C24 5.4 18.6 0 12 0zm0 17c-2.8 0-5-2.2-5-5s2.2-5 5-5 5 2.2 5 5-2.2 5-5 5z"/>';

        wrap.appendChild(label);
        wrap.appendChild(icon);
        pinLayer.appendChild(wrap);
    }
}


// ═══════════════════════════════════════
//  POPUP
// ═══════════════════════════════════════

// Buat kerangka popup dengan judul dan tombol ×
function makePopup(title, x, y) {
    var p    = el('div', { className: 'map-popup' });
    p.style.left = x + 'px';
    p.style.top  = y + 'px';
    p.innerHTML  =
        '<div class="popup-header">' +
            '<h3>' + title + '</h3>' +
            '<button class="popup-close">&#215;</button>' +
        '</div>';
    p.querySelector('.popup-close').addEventListener('click', function (e) {
        e.stopPropagation();
        closePopups();
        connectingId = null;
        renderPins();
    });
    return p;
}

// Popup tambah pin baru (muncul saat double-click di peta)
function showAddPinPopup(x, y) {
    closePopups();
    connectingId = null;

    var p   = makePopup('Add pinpoint', x, y);
    var inp = el('input', { type: 'text', placeholder: 'Enter location name' });
    var btn = el('button', { className: 'popup-submit' }, 'Save');

    function doSave(e) {
        e.stopPropagation();
        var name = inp.value.trim();
        if (!name) return;
        var id = makeId();
        pins[id] = { id: id, name: name, x: x, y: y };
        save();
        closePopups();
        renderConns();
        renderPins();
        validateSearch();
    }

    btn.addEventListener('click', doSave);
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSave(e); });

    p.appendChild(inp);
    p.appendChild(btn);
    popupLayer.appendChild(p);
    setTimeout(function () { inp.focus(); }, 0);
}

// Popup koneksi dua pin (muncul setelah klik pin tujuan saat mode connecting)
function showConnectPopup(fromId, toId) {
    var a = pins[fromId];
    var b = pins[toId];
    if (!a || !b) return;

    closePopups();
    connectingId = null;
    renderPins();

    var p   = makePopup('Connect', (a.x + b.x) / 2, (a.y + b.y) / 2);
    var inp = el('input', { type: 'number', min: '1', placeholder: 'Distance (km)' });
    var sel = el('select', {});
    sel.innerHTML = '<option value="" disabled selected>Choose mode</option>';
    for (var m in TRANSPORT) {
        sel.innerHTML += '<option value="' + m + '">' + TRANSPORT[m].label + '</option>';
    }
    var btn = el('button', { className: 'popup-submit' }, 'Submit');

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var dist = parseFloat(inp.value);
        if (!dist || dist <= 0 || !sel.value) return;
        conns.push({ id: makeId(), from: fromId, to: toId, distance: dist, mode: sel.value });
        save();
        closePopups();
        renderConns();
        renderPins();
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') btn.click(); });

    p.appendChild(inp);
    p.appendChild(sel);
    p.appendChild(btn);
    popupLayer.appendChild(p);
    inp.focus();
}


// ═══════════════════════════════════════
//  PENCARIAN RUTE (DFS)
// ═══════════════════════════════════════

// Cari semua rute dari startId ke endId menggunakan DFS rekursif
function findRoutes(startId, endId) {
    var results = [];

    function dfs(cur, path, visited) {
        if (cur === endId) {
            results.push(path.slice());
            return;
        }
        visited[cur] = true;
        for (var i = 0; i < conns.length; i++) {
            var c    = conns[i];
            var next = c.from === cur ? c.to : c.to === cur ? c.from : null;
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

// Jalankan pencarian dan tampilkan hasil di sidebar
function doSearch() {
    var a = getPinByName(fromInput.value);
    var b = getPinByName(toInput.value);
    if (!a || !b) return;

    var routes = findRoutes(a.id, b.id).map(function (segs) {
        var cost  = 0;
        var hours = 0;
        var cur   = a.id;
        var names = [pins[a.id].name];
        var steps = [];

        for (var i = 0; i < segs.length; i++) {
            var s    = segs[i];
            var t    = TRANSPORT[s.mode];
            var next = s.from === cur ? s.to : s.from;
            cost  += s.distance * t.cost;
            hours += s.distance / t.speed;
            steps.push(
                (i + 1) + '. ' + pins[cur].name + ' \u2192 ' + pins[next].name +
                ' (' + t.label + ', ' + s.distance + ' km)'
            );
            names.push(pins[next].name);
            cur = next;
        }
        return { name: names.join(' - '), steps: steps, cost: cost, hours: hours };
    });

    routes.sort(function (x, y) {
        return sortMode === 'fastest' ? x.hours - y.hours : x.cost - y.cost;
    });

    routeDiv.innerHTML = '';
    if (!routes.length) {
        routeDiv.innerHTML = '<p class="no-routes">No routes found.</p>';
        return;
    }

    routes.slice(0, 10).forEach(function (r, i) {
        var card = el('div', { className: 'route-card' });
        card.innerHTML =
            '<div class="route-card-header">' +
                '<h3>' + (i + 1) + '. ' + r.name + '</h3>' +
                '<span class="duration">' + fmtHours(r.hours) + '</span>' +
            '</div>' +
            r.steps.map(function (s) {
                return '<div class="route-step">' + s + '</div>';
            }).join('') +
            '<div class="route-summary"><span class="cost">' + fmtCost(r.cost) + '</span></div>';
        routeDiv.appendChild(card);
    });
}


// ═══════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════

// Zoom dengan Ctrl + scroll
viewport.addEventListener('wheel', function (e) {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// Ctrl+= zoom in | Ctrl+- zoom out | Delete / Backspace hapus koneksi terpilih
document.addEventListener('keydown', function (e) {
    var r  = viewport.getBoundingClientRect();
    var cx = r.left + r.width  / 2;
    var cy = r.top  + r.height / 2;

    if (e.ctrlKey && (e.key === '+' || e.key === '=')) {
        e.preventDefault();
        zoomAt(cx, cy, 1);
    }
    if (e.ctrlKey && e.key === '-') {
        e.preventDefault();
        zoomAt(cx, cy, -1);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedConn) {
        var tag = document.activeElement ? document.activeElement.tagName : '';
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
        e.preventDefault();
        conns = conns.filter(function (c) { return c.id !== selectedConn; });
        selectedConn = null;
        save();
        renderConns();
    }
});

// Klik tahan di peta → mulai pan
viewport.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('.pin-wrapper') || e.target.closest('.map-popup')) return;
    if (e.target.classList && e.target.classList.contains('conn-line')) return;
    e.preventDefault();
    panning    = true;
    panStartX  = e.clientX;
    panStartY  = e.clientY;
    panOriginX = panX;
    panOriginY = panY;
    viewport.classList.add('panning');
    selectedConn = null;
    renderConns();
});

window.addEventListener('mousemove', function (e) {
    if (!panning) return;
    panX = panOriginX + (e.clientX - panStartX);
    panY = panOriginY + (e.clientY - panStartY);
    applyTransform();
});

window.addEventListener('mouseup', function () {
    panning = false;
    viewport.classList.remove('panning');
});

// Double-click di peta → tambah pin baru
viewport.addEventListener('dblclick', function (e) {
    if (e.target.closest('.pin-wrapper') || e.target.closest('.map-popup')) return;
    var pos = toMapCoord(e.clientX, e.clientY);
    if (pos.x < 0 || pos.y < 0 || pos.x > MAP_W || pos.y > MAP_H) return;
    showAddPinPopup(pos.x, pos.y);
});

// Klik area kosong → deselect koneksi
viewport.addEventListener('click', function (e) {
    if (e.target.closest('.map-popup')) return;
    if (!e.target.classList || !e.target.classList.contains('conn-line')) {
        selectedConn = null;
        renderConns();
    }
});

// Input From / To → validasi tombol Search
fromInput.addEventListener('input', validateSearch);
toInput.addEventListener('input',   validateSearch);
searchBtn.addEventListener('click', doSearch);

// Tombol sort Fastest / Cheapest
[btnFastest, btnCheapest].forEach(function (btn) {
    btn.addEventListener('click', function () {
        sortMode = this === btnFastest ? 'fastest' : 'cheapest';
        btnFastest.classList.toggle('active',  this === btnFastest);
        btnCheapest.classList.toggle('active', this === btnCheapest);
        if (!searchBtn.disabled) doSearch();
    });
});

window.addEventListener('resize', fitMap);


// ═══════════════════════════════════════
//  INISIALISASI
// ═══════════════════════════════════════

loadMap();
fitMap();
renderConns();
renderPins();
validateSearch();
