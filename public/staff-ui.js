/* LOS BUGS · pantallas de Administrador y Repartidor
   No toca app.js: usa sus funciones (cambiarEstadoPedido, eliminarProducto, eliminarUsuario)
   y se actualiza sola cada pocos segundos. */
(function () {
    'use strict';
    const $ = (id) => document.getElementById(id);
    const API = '/api';
    const body = document.body;
    const isAdmin = body.classList.contains('page-admin');
    const isDriver = body.classList.contains('page-repartidor');
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const money0 = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { maximumFractionDigits: 0 });
    const ESTADO = { pendiente: 'Recibido', preparando: 'Preparando', en_camino: 'En camino', entregado: 'Entregado' };
    const PASOS = ['pendiente', 'preparando', 'en_camino', 'entregado'];
    const me = () => { try { return JSON.parse(localStorage.getItem('fb_user')) || {}; } catch { return {}; } };

    async function getJSON(url) {
        const r = await fetch(API + url);
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
    }
    function hace(f) {
        if (!f) return '';
        const m = Math.round((Date.now() - new Date(f).getTime()) / 60000);
        if (m < 1) return 'justo ahora';
        if (m < 60) return 'hace ' + m + ' min';
        const h = Math.round(m / 60);
        return h < 24 ? 'hace ' + h + ' h' : new Date(f).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
    }
    function toast(msg) {
        let el = $('lbToast');
        if (!el) { el = document.createElement('div'); el.id = 'lbToast'; el.className = 'pwa-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
        el.textContent = msg; el.classList.add('show');
        try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch { /* sin vibración */ }
        clearTimeout(toast._t); toast._t = setTimeout(() => el.classList.remove('show'), 4200);
    }
    const iniciales = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((s) => s[0].toUpperCase()).join('');

    // ------------------------------------------------------------
    // Pantallas (menú inferior)
    // ------------------------------------------------------------
    const VIEWS = isAdmin
        ? { pedidos: 'secPedidos', productos: 'secProductos', repartidores: 'secRepartidores', usuarios: 'secUsuarios' }
        : { pedidos: 'secPedidos', mapa: 'secMapa' };
    let current = 'pedidos';
    function setView(name, opts) {
        opts = opts || {};
        if (!VIEWS[name]) name = 'pedidos';
        current = name;
        Object.keys(VIEWS).forEach((k) => { const el = $(VIEWS[k]); if (el) el.hidden = (k !== name); });
        body.className = body.className.replace(/\bview-\w+/g, '').trim() + ' view-' + name;
        document.querySelectorAll('#bottomNav .bn-item[data-view]').forEach((i) => {
            const on = i.dataset.view === name;
            i.classList.toggle('active', on);
            if (on) i.setAttribute('aria-current', 'page'); else i.removeAttribute('aria-current');
        });
        window.scrollTo(0, 0);
        if (name === 'mapa') setTimeout(() => { try { driverMap.invalidateSize(); if (routeBounds) driverMap.fitBounds(routeBounds, { padding: [40, 40] }); } catch { /* sin mapa */ } }, 150);
        if (!opts.fromHash && location.hash !== '#' + name) location.hash = '#' + name;
    }
    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('[data-view]');
        if (t) setView(t.dataset.view);
    });
    window.addEventListener('hashchange', () => { const n = location.hash.replace('#', ''); if (VIEWS[n] && n !== current) setView(n, { fromHash: true }); });

    // ------------------------------------------------------------
    // Datos compartidos
    // ------------------------------------------------------------
    let pedidos = [], productos = [], usuarios = [];
    let filtro = isAdmin ? 'todos' : 'disp';
    let vistos = null;           // ids de pedidos ya conocidos (para avisar de los nuevos)
    let estadoPrev = null;       // para avisar cambios de estado

    function restsOf(p) {
        const out = new Map();
        (p.items || []).forEach((it) => {
            const pr = productos.find((x) => x.nombre === it.nombre);
            if (pr && pr.restaurante_nombre && !out.has(pr.restaurante_nombre)) {
                out.set(pr.restaurante_nombre, { nombre: pr.restaurante_nombre, zona: pr.zona, lat: Number(pr.latitud) || 0, lng: Number(pr.longitud) || 0 });
            }
        });
        return [...out.values()];
    }
    const nItems = (p) => (p.items || []).reduce((a, i) => a + Number(i.cantidad || 0), 0);
    const itemsTxt = (p) => (p.items || []).map((i) => `${esc(i.cantidad)}× ${esc(i.nombre)}`).join(' · ');
    const tarjetaOk = (p) => p.metodo_pago === 'Tarjeta' && p.pago_estado === 'aprobado';
    const payChip = (p) => tarjetaOk(p)
        ? '<span class="pay-chip ok">✅ Pagado con tarjeta</span>'
        : `<span class="pay-chip cash">💵 Cobrar ${money(p.total)} en efectivo</span>`;
    const stepper = (p) => {
        const idx = Math.max(0, PASOS.indexOf(p.estado));
        return `<div class="steps">${PASOS.map((s, i) => `<div class="step ${i <= idx ? 'done' : ''} ${i === idx ? 'current' : ''}">${ESTADO[s]}</div>`).join('')}</div>`;
    };
    function rutaHtml(p) {
        const rs = restsOf(p);
        const stops = (rs.length ? rs : [{ nombre: 'Restaurante', zona: '' }]).map((r) =>
            `<div class="rl-stop"><span class="dot">🏪</span><div><b>Recoger en ${esc(r.nombre)}</b><small>${esc(r.zona)}</small></div></div><div class="rl-link"></div>`).join('');
        return `<div class="route-line">${stops}
            <div class="rl-stop"><span class="dot cli">📍</span><div><b>Entregar a ${esc(p.cliente_nombre)}</b><small>${esc(p.direccion_entrega)}</small></div></div></div>`;
    }
    function setFiltroUI() {
        document.querySelectorAll('#filtros .chip').forEach((c) => c.classList.toggle('active', c.dataset.f === filtro));
    }
    $('filtros').addEventListener('click', (e) => {
        const b = e.target.closest('.chip'); if (!b) return;
        filtro = b.dataset.f; setFiltroUI(); renderOrders();
    });

    function detectarCambios() {
        const ids = new Set(pedidos.map((p) => p.id));
        const mapa = {}; pedidos.forEach((p) => { mapa[p.id] = p.estado; });
        if (vistos) {
            const nuevos = pedidos.filter((p) => !vistos.has(p.id));
            if (nuevos.length) toast(isAdmin ? '🔔 Nuevo pedido #' + nuevos[0].id + ' de ' + nuevos[0].cliente_nombre : '🔔 Nuevo pedido disponible #' + nuevos[0].id);
            if (isAdmin && estadoPrev) {
                pedidos.forEach((p) => {
                    if (estadoPrev[p.id] && estadoPrev[p.id] !== p.estado && p.estado === 'entregado') toast('✅ Pedido #' + p.id + ' entregado a ' + p.cliente_nombre);
                });
            }
        }
        vistos = ids; estadoPrev = mapa;
        window.__nuevos = vistos;
    }

    // ============================================================
    // REPARTIDOR
    // ============================================================
    let selId = null, routeLayer = null, routeBounds = null;
    const geoCache = (() => { try { return JSON.parse(localStorage.getItem('fb_geo')) || {}; } catch { return {}; } })();

    function fetchT(url, ms) {
        const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
        return fetch(url, { signal: c.signal }).finally(() => clearTimeout(t));
    }
    async function geocode(q) {
        const k = String(q || '').trim().toLowerCase();
        if (!k) return null;
        if (geoCache[k]) return geoCache[k];
        if (!navigator.onLine) return null;
        try {
            const r = await fetchT('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=mx&q=' + encodeURIComponent(q), 6000);
            const d = await r.json();
            if (d && d[0]) {
                const v = { lat: Number(d[0].lat), lng: Number(d[0].lon) };
                geoCache[k] = v; try { localStorage.setItem('fb_geo', JSON.stringify(geoCache)); } catch { /* lleno */ }
                return v;
            }
        } catch { /* sin servicio */ }
        return null;
    }
    function posChofer() {
        return new Promise((ok) => {
            if (!navigator.geolocation) return ok(null);
            navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lng: p.coords.longitude }), () => ok(null), { timeout: 5000, maximumAge: 60000 });
        });
    }
    function distKm(a, b) {
        const R = 6371, rad = (x) => x * Math.PI / 180;
        const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    }
    async function osrm(pts) {
        if (!navigator.onLine) return null;
        try {
            const u = 'https://router.project-osrm.org/route/v1/driving/' + pts.map((p) => p.lng + ',' + p.lat).join(';') + '?overview=full&geometries=geojson';
            const r = await fetchT(u, 7000);
            const d = await r.json();
            if (d && d.routes && d.routes[0]) {
                const rt = d.routes[0];
                return { coords: rt.geometry.coordinates.map((c) => [c[1], c[0]]), legs: rt.legs.map((l) => ({ km: l.distance / 1000, min: l.duration / 60 })) };
            }
        } catch { /* sin servicio de rutas */ }
        return null;
    }
    const fmtKm = (k) => (k < 10 ? k.toFixed(1) : Math.round(k)) + ' km';
    const fmtMin = (m) => (m < 1 ? '1 min' : m >= 60 ? Math.floor(m / 60) + ' h ' + Math.round(m % 60) + ' min' : Math.round(m) + ' min');
    const pinIcon = (cls, emoji) => L.divIcon({ className: '', html: `<div class="pin ${cls}">${emoji}</div>`, iconSize: [38, 38], iconAnchor: [19, 19] });

    async function showRoute(id) {
        selId = id;
        setView('mapa');
        const p = pedidos.find((x) => x.id === id);
        if (!p) return;
        if (typeof L === 'undefined' || typeof driverMap === 'undefined' || !driverMap) {
            $('routeEmpty').hidden = true; $('routeInfo').hidden = false;
            $('routeInfo').innerHTML = `<div class="rc-head"><h3>Pedido #${esc(p.id)}</h3><small>${esc(p.direccion_entrega)}</small></div><div class="warn">El mapa necesita internet la primera vez. Puedes abrir la navegación igual.</div><div class="rc-actions">${navBtn(p, restsOf(p), null)}${accionBtn(p)}</div>`;
            return;
        }
        $('routeEmpty').hidden = true; $('routeInfo').hidden = false;
        $('routeInfo').innerHTML = '<p class="empty-inline">🧭 Calculando la mejor ruta…</p>';
        $('mapChip').textContent = '🧭 Pedido #' + p.id;

        let rs = restsOf(p).filter((r) => r.lat && r.lng);
        let dest = await geocode(p.direccion_entrega), aprox = false;
        if (!dest && Number(p.lat_entrega) && Number(p.lng_entrega)) { dest = { lat: Number(p.lat_entrega), lng: Number(p.lng_entrega) }; aprox = true; }
        const yo = await posChofer();
        if (yo && rs.length > 1) rs = rs.slice().sort((a, b) => distKm(yo, a) - distKm(yo, b));

        const pts = [];
        if (yo) pts.push({ t: 'yo', ...yo, nombre: 'Tu ubicación' });
        rs.forEach((r) => pts.push({ t: 'rest', lat: r.lat, lng: r.lng, nombre: r.nombre }));
        if (dest) pts.push({ t: 'cli', ...dest, nombre: p.cliente_nombre });

        if (pts.length < 2) {
            $('routeInfo').innerHTML = `<div class="rc-head"><h3>Pedido #${esc(p.id)}</h3><small>${esc(p.direccion_entrega)}</small></div>
                <div class="warn">No pude ubicar el restaurante o la dirección en el mapa. Abre la navegación para llegar.</div>
                <div class="rc-actions">${navBtn(p, rs, dest)}${accionBtn(p)}</div>`;
            return;
        }
        const ruta = await osrm(pts);
        if (routeLayer) { routeLayer.remove(); routeLayer = null; }
        routeLayer = L.layerGroup().addTo(driverMap);
        const linea = ruta ? ruta.coords : pts.map((x) => [x.lat, x.lng]);
        L.polyline(linea, { color: '#fff', weight: 10, opacity: .95 }).addTo(routeLayer);
        L.polyline(linea, { color: '#7B2857', weight: 5, opacity: 1, dashArray: ruta ? null : '8 10' }).addTo(routeLayer);
        pts.forEach((x) => L.marker([x.lat, x.lng], { icon: pinIcon('pin-' + x.t, x.t === 'rest' ? '🏪' : x.t === 'cli' ? '📍' : '🛵') }).addTo(routeLayer).bindPopup(esc(x.nombre)));
        routeBounds = L.latLngBounds(linea);
        try { driverMap.invalidateSize(); driverMap.fitBounds(routeBounds, { padding: [40, 40] }); } catch { /* sin mapa */ }

        const legs = [];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i], b = pts[i + 1];
            const km = ruta ? ruta.legs[i].km : distKm(a, b) * 1.3;
            const min = ruta ? ruta.legs[i].min : km / 25 * 60;
            legs.push({ de: a, a: b, km, min });
        }
        const totKm = legs.reduce((s, l) => s + l.km, 0), totMin = legs.reduce((s, l) => s + l.min, 0);
        $('mapChip').textContent = '🛵 ' + fmtMin(totMin) + ' · ' + fmtKm(totKm);
        const nombreLeg = (x) => x.t === 'yo' ? 'Tú' : x.t === 'cli' ? esc(p.cliente_nombre) : esc(x.nombre);
        const iconoLeg = (x) => x.t === 'yo' ? '🛵' : x.t === 'cli' ? '📍' : '🏪';
        $('routeInfo').innerHTML = `
            <div class="rc-head"><h3>Pedido #${esc(p.id)} · ${esc(p.cliente_nombre)}</h3><small>${esc(p.direccion_entrega)}</small></div>
            <div class="rc-total"><strong>${fmtMin(totMin)}</strong><span>${fmtKm(totKm)} en total</span></div>
            ${legs.map((l) => `<div class="leg"><span class="dot">${iconoLeg(l.a)}</span><div><b>${l.a.t === 'rest' ? 'Ir a recoger' : 'Entregar'}: ${nombreLeg(l.a)}</b><small>desde ${nombreLeg(l.de)}</small></div><div class="km">${fmtKm(l.km)}<small>${fmtMin(l.min)}</small></div></div>`).join('')}
            ${ruta ? '' : '<div class="warn">📴 Sin conexión al servicio de rutas: se muestra una línea aproximada.</div>'}
            ${aprox ? '<div class="warn">⚠️ No encontré la calle exacta; el punto del cliente es aproximado. Confirma por teléfono.</div>' : ''}
            ${!yo ? '<div class="warn">Activa tu ubicación para ver también el tramo desde donde estás.</div>' : ''}
            <div class="oc-meta" style="margin-top:12px">${payChip(p)}<span class="oc-total">${money(p.total)}</span></div>
            <div class="rc-actions">${navBtn(p, rs, dest, aprox)}${p.cliente_telefono ? `<a class="btn btn-soft" href="tel:${esc(p.cliente_telefono)}">📞 Llamar</a>` : ''}${accionBtn(p)}</div>`;
    }
    function navBtn(p, rs, dest, aprox) {
        const way = rs.filter((r) => r.lat && r.lng).map((r) => r.lat + ',' + r.lng).join('|');
        const d = dest && !aprox ? dest.lat + ',' + dest.lng : encodeURIComponent(p.direccion_entrega || '');
        const url = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + d + (way ? '&waypoints=' + encodeURIComponent(way) : '');
        return `<a class="btn btn-go" href="${url}" target="_blank" rel="noopener">🧭 Navegar</a>`;
    }
    function accionBtn(p) {
        if (p.estado === 'pendiente' || p.estado === 'preparando') return `<button type="button" class="btn btn-go pink" data-act="tomar" data-id="${p.id}">🛵 Aceptar entrega</button>`;
        if (p.estado === 'en_camino') return `<button type="button" class="btn btn-go pink" data-act="entregar" data-id="${p.id}">✅ Marcar entregado</button>`;
        return '';
    }

    function renderDriver() {
        const yo = Number(me().id);
        const disp = pedidos.filter((p) => p.estado === 'pendiente' || p.estado === 'preparando');
        const ruta = pedidos.filter((p) => p.estado === 'en_camino' && (!p.repartidor_id || Number(p.repartidor_id) === yo));
        const hechos = pedidos.filter((p) => p.estado === 'entregado' && Number(p.repartidor_id) === yo);
        $('stDisp').textContent = disp.length; $('stRuta').textContent = ruta.length; $('stHechos').textContent = hechos.length;
        const bn = $('bnBadge'); if (bn) { bn.textContent = disp.length; bn.hidden = disp.length === 0; }
        const f = document.querySelectorAll('#filtros .chip');
        f.forEach((c) => {
            const n = c.dataset.f === 'disp' ? disp.length : c.dataset.f === 'ruta' ? ruta.length : hechos.length;
            c.innerHTML = c.textContent.replace(/\d+$/, '').trim() + `<span class="n">${n}</span>`;
        });
        const lista = (filtro === 'disp' ? disp : filtro === 'ruta' ? ruta : hechos.slice(0, 20));
        $('ordersEmpty').hidden = lista.length > 0;
        $('ordersList').innerHTML = lista.map((p) => `
            <article class="order-card ${vistos && window.__recien && window.__recien.has(p.id) ? 'is-new' : ''}">
                <div class="oc-top"><div><h3>Pedido #${esc(p.id)}</h3><small>${hace(p.fecha_pedido)} · ${nItems(p)} platillo${nItems(p) === 1 ? '' : 's'}</small></div>
                    <span class="status-pill status-${esc(p.estado)}">${esc(ESTADO[p.estado] || p.estado)}</span></div>
                ${rutaHtml(p)}
                <div class="oc-meta">${payChip(p)}<span class="oc-total">${money(p.total)}</span></div>
                <div class="oc-items">${itemsTxt(p)}</div>
                <div class="oc-actions">
                    ${p.estado !== 'entregado' ? `<button type="button" class="btn btn-soft" data-act="ruta" data-id="${p.id}">🗺️ Ver ruta</button>` : ''}
                    ${p.cliente_telefono && p.estado !== 'entregado' ? `<a class="btn btn-soft" href="tel:${esc(p.cliente_telefono)}">📞</a>` : ''}
                    ${accionBtn(p)}
                </div>
            </article>`).join('');
        // si la ruta abierta ya se entregó, lo indicamos
        const s = pedidos.find((x) => x.id === selId);
        if (s && s.estado === 'entregado' && current === 'mapa') { $('routeInfo').innerHTML = '<div class="empty-inline"><div class="empty-emoji">✅</div><p><b>¡Pedido entregado!</b> Buen trabajo.</p></div>'; }
    }

    async function accion(act, id) {
        try {
            if (act === 'ruta') return showRoute(id);
            if (act === 'tomar') {
                await cambiarEstadoPedido(id, 'en_camino');
                toast('🛵 Pedido #' + id + ' aceptado. ¡En camino!');
                await cargar();
                return showRoute(id);
            }
            if (act === 'entregar') {
                await cambiarEstadoPedido(id, 'entregado');
                toast('✅ Pedido #' + id + ' entregado. El cliente ya lo ve.');
                await cargar();
                if (current === 'mapa') { if (routeLayer) { routeLayer.remove(); routeLayer = null; } routeBounds = null; selId = null; $('routeInfo').hidden = true; $('routeEmpty').hidden = false; $('mapChip').textContent = '🗺️ Elige un pedido para ver la ruta'; setView('pedidos'); }
            }
        } catch (e) { toast('No se pudo completar. Intenta de nuevo.'); }
    }
    document.addEventListener('click', (e) => {
        const b = e.target.closest && e.target.closest('[data-act]');
        if (b) accion(b.dataset.act, Number(b.dataset.id));
    });

    // ============================================================
    // ADMINISTRADOR
    // ============================================================
    const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    function renderDash() {
        const act = pedidos.filter((p) => p.estado !== 'entregado');
        const ventas = pedidos.reduce((a, p) => a + Number(p.total || 0), 0);
        const clientes = usuarios.filter((u) => u.rol === 'cliente').length;
        $('stPedidos').textContent = pedidos.length; $('stActivos').textContent = act.length;
        $('stVentas').textContent = money0(ventas); $('stClientes').textContent = clientes;

        // ventas últimos 7 días
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const dias = [];
        for (let i = 6; i >= 0; i--) { const d = new Date(hoy); d.setDate(hoy.getDate() - i); dias.push({ d, total: 0, n: 0 }); }
        pedidos.forEach((p) => {
            const f = new Date(p.fecha_pedido); f.setHours(0, 0, 0, 0);
            const x = dias.find((y) => y.d.getTime() === f.getTime());
            if (x) { x.total += Number(p.total || 0); x.n++; }
        });
        const max = Math.max(1, ...dias.map((x) => x.total));
        // top platillos y restaurantes
        const top = new Map(), porRest = new Map();
        pedidos.forEach((p) => (p.items || []).forEach((it) => {
            const imp = Number(it.cantidad || 0) * Number(it.precio_unitario || 0);
            top.set(it.nombre, (top.get(it.nombre) || 0) + Number(it.cantidad || 0));
            const pr = productos.find((x) => x.nombre === it.nombre);
            const rn = pr ? pr.restaurante_nombre : 'Otros';
            porRest.set(rn, (porRest.get(rn) || 0) + imp);
        }));
        const topL = [...top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        const restL = [...porRest.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
        const efe = pedidos.filter((p) => !tarjetaOk(p)).reduce((a, p) => a + Number(p.total || 0), 0);
        const tar = ventas - efe;
        const pe = ventas ? Math.round(efe / ventas * 100) : 0;
        const tk = pedidos.length ? ventas / pedidos.length : 0;
        const ent = pedidos.filter((p) => p.estado === 'entregado').length;

        const rank = (arr, fmt, m) => arr.length ? `<div class="rank">${arr.map(([n, v]) => `<div class="rank-row"><b>${esc(n)}</b><span>${fmt(v)}</span><div class="meter"><i style="width:${Math.max(4, Math.round(v / m * 100))}%"></i></div></div>`).join('')}</div>` : '<p class="sub">Aún sin ventas.</p>';
        $('dash').innerHTML = `
            <div class="dash-card wide"><h3>Ventas de los últimos 7 días</h3><div class="sub">Total vendido por día</div>
                <div class="bars">${dias.map((x, i) => `<div class="bar ${i === 6 ? 'hoy' : ''}"><em>${x.total ? money0(x.total) : ''}</em><i style="height:${Math.round(x.total / max * 100)}%"></i><span>${i === 6 ? 'Hoy' : DIAS[x.d.getDay()]}</span></div>`).join('')}</div></div>
            <div class="dash-card"><h3>Resumen</h3><div class="sub">Todo lo vendido hasta hoy</div>
                <div class="kpis"><div><strong>${money0(ventas)}</strong><span>Ventas totales</span></div><div><strong>${money0(tk)}</strong><span>Ticket promedio</span></div><div><strong>${ent}</strong><span>Entregados</span></div><div><strong>${act.length}</strong><span>En proceso</span></div></div></div>
            <div class="dash-card"><h3>Cómo pagan</h3><div class="sub">Efectivo vs. tarjeta (Mercado Pago)</div>
                <div class="split"><i class="c1" style="width:${pe}%"></i><i class="c2" style="width:${ventas ? 100 - pe : 0}%"></i></div>
                <div class="legend"><span style="--c:#7B2857">💵 Efectivo ${money0(efe)}</span><span style="--c:#D95B96">💳 Tarjeta ${money0(tar)}</span></div></div>
            <div class="dash-card"><h3>Platillos más vendidos</h3><div class="sub">Por cantidad</div>${rank(topL, (v) => v + ' pzas', topL.length ? topL[0][1] : 1)}</div>
            <div class="dash-card"><h3>Ventas por restaurante</h3><div class="sub">Importe vendido</div>${rank(restL, money0, restL.length ? restL[0][1] : 1)}</div>`;
    }

    function renderAdminOrders() {
        const lista = pedidos.filter((p) => filtro === 'todos' || (filtro === 'pendiente' ? (p.estado === 'pendiente' || p.estado === 'preparando') : p.estado === filtro));
        document.querySelectorAll('#filtros .chip').forEach((c) => {
            const f = c.dataset.f;
            const n = pedidos.filter((p) => f === 'todos' || (f === 'pendiente' ? (p.estado === 'pendiente' || p.estado === 'preparando') : p.estado === f)).length;
            c.innerHTML = c.textContent.replace(/\d+$/, '').trim() + `<span class="n">${n}</span>`;
        });
        $('ordersEmpty').hidden = lista.length > 0;
        $('ordersList').innerHTML = lista.map((p) => `
            <article class="order-card">
                <div class="oc-top"><div><h3>Pedido #${esc(p.id)}</h3><small>${hace(p.fecha_pedido)} · ${new Date(p.fecha_pedido).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</small></div>
                    <span class="status-pill status-${esc(p.estado)}">${esc(ESTADO[p.estado] || p.estado)}</span></div>
                ${rutaHtml(p)}
                <div class="oc-people">👤 <b>${esc(p.cliente_nombre)}</b>${p.cliente_telefono ? ' · 📞 ' + esc(p.cliente_telefono) : ''}${p.repartidor_nombre ? '<br>🛵 Lo lleva <b>' + esc(p.repartidor_nombre) + '</b>' : '<br>🛵 Sin repartidor asignado'}</div>
                ${stepper(p)}
                <div class="oc-meta">${tarjetaOk(p) ? '<span class="pay-chip ok">✅ Pagado con tarjeta</span>' : '<span class="pay-chip cash">💵 Efectivo</span>'}<span class="oc-total">${money(p.total)}</span></div>
                <div class="oc-items">${itemsTxt(p)}</div>
            </article>`).join('');
    }

    let busca = '';
    function renderProductosAdmin() {
        const q = busca.trim().toLowerCase();
        const lista = productos.filter((p) => !q || (p.nombre + ' ' + p.restaurante_nombre).toLowerCase().includes(q));
        $('prodGrid').innerHTML = lista.map((p) => `
            <article class="prod-card">
                <div class="prod-img">🍽️${p.imagen_url ? `<img src="${esc(p.imagen_url)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
                <div class="prod-body"><b>${esc(p.nombre)}</b><small>🏪 ${esc(p.restaurante_nombre)} · ${esc(p.zona)}</small>
                    <div class="prod-foot"><strong>${money(p.precio)}</strong><button type="button" class="btn-del" data-del-prod="${p.id}">Eliminar</button></div></div>
            </article>`).join('') || '<div class="empty-state"><div class="empty-emoji">🍽️</div><h3>Sin resultados</h3></div>';
    }
    function persona(u, extra) {
        return `<article class="person-card"><div class="avatar">${esc(iniciales(u.nombre))}</div>
            <div class="info"><b>${esc(u.nombre)}</b><small>${esc(u.email)}</small><small>${esc(u.telefono || '')}${u.vehiculo ? ' · 🛵 ' + esc(u.vehiculo) : ''}</small>${extra || ''}<span class="role ${esc(u.rol)}">${esc(String(u.rol).toUpperCase())}</span></div>
            ${u.rol !== 'admin' ? `<button type="button" class="btn-del" data-del-user="${u.id}">Eliminar</button>` : ''}</article>`;
    }
    function renderPersonas() {
        const reps = usuarios.filter((u) => u.rol === 'repartidor');
        $('repGrid').innerHTML = reps.map((u) => {
            const n = pedidos.filter((p) => Number(p.repartidor_id) === Number(u.id) && p.estado === 'entregado').length;
            return persona(u, `<small>📦 ${n} entrega${n === 1 ? '' : 's'}</small>`);
        }).join('') || '<div class="empty-state"><div class="empty-emoji">🛵</div><h3>Aún no hay repartidores</h3><p>Da de alta el primero con el formulario.</p></div>';
        $('userGrid').innerHTML = usuarios.map((u) => persona(u)).join('');
    }
    document.addEventListener('click', (e) => {
        const p = e.target.closest && e.target.closest('[data-del-prod]');
        if (p) { eliminarProducto(Number(p.dataset.delProd)); setTimeout(cargar, 700); return; }
        const u = e.target.closest && e.target.closest('[data-del-user]');
        if (u) { eliminarUsuario(Number(u.dataset.delUser)); setTimeout(cargar, 700); }
    });
    if ($('adminBuscar')) $('adminBuscar').addEventListener('input', (e) => { busca = e.target.value; renderProductosAdmin(); });

    // ------------------------------------------------------------
    // Carga y actualización automática
    // ------------------------------------------------------------
    function renderOrders() { return isAdmin ? renderAdminOrders() : renderDriver(); }
    function renderAll() {
        renderOrders();
        if (isAdmin) { renderDash(); renderProductosAdmin(); renderPersonas(); }
    }
    let cargando = false;
    async function cargar() {
        if (cargando) return;
        cargando = true;
        try {
            const reqs = [getJSON('/pedidos'), getJSON('/productos')];
            if (isAdmin) reqs.push(getJSON('/usuarios'));
            const r = await Promise.all(reqs);
            if (Array.isArray(r[0])) {
                const antes = vistos;
                pedidos = r[0];
                window.__recien = antes ? new Set(pedidos.filter((p) => !antes.has(p.id)).map((p) => p.id)) : new Set();
                detectarCambios();
            }
            if (Array.isArray(r[1])) productos = r[1];
            if (isAdmin && Array.isArray(r[2])) usuarios = r[2];
            renderAll();
        } catch { /* sin conexión: se queda lo que ya se ve */ }
        cargando = false;
    }
    // Cuando app.js recarga sus tablas ocultas (tras agregar/eliminar), nos actualizamos
    ['driverPedidosTable', 'adminProductosTable', 'adminUsuariosTable'].forEach((id) => {
        const t = $(id); if (!t) return;
        let h; new MutationObserver(() => { clearTimeout(h); h = setTimeout(cargar, 250); }).observe(t, { childList: true });
    });
    setInterval(() => { if (!document.hidden && navigator.onLine) cargar(); }, isAdmin ? 10000 : 7000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) cargar(); });
    window.addEventListener('online', cargar);

    // Inicio
    (function () {
        const u = me();
        if ($('heroName') && u.nombre) $('heroName').textContent = String(u.nombre).split(/\s+/)[0];
        setFiltroUI();
        const n = location.hash.replace('#', '');
        setView(VIEWS[n] ? n : 'pedidos', { fromHash: true });
        cargar();
    })();
})();
