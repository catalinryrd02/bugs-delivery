/* LOS BUGS DELIVERY - pantallas del cliente (Inicio, Carrito, Pedidos, Perfil)
   Se carga DESPUÉS de app.js y pwa.js. No modifica la lógica de app.js: solo cambia de pantalla,
   dibuja los pedidos/perfil y mejora la vista del carrito y del mapa. */
(function () {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const API = (typeof API_URL !== 'undefined' ? API_URL : '/api');
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const money = (n) => '$' + Number(n || 0).toFixed(2);
    function getUser() { try { return JSON.parse(localStorage.getItem('fb_user')); } catch { return null; } }
    const user = getUser();

    const VIEWS = { home: 'viewHome', pedidos: 'viewPedidos', perfil: 'viewPerfil' };
    let current = 'home';
    let lastView = 'home';

    const drawer = () => $('cartDrawer');
    const drawerOpen = () => drawer().classList.contains('open');
    const favOn = () => (typeof soloFavoritos !== 'undefined') && soloFavoritos;
    const productos = () => (typeof productosGlobal !== 'undefined' ? productosGlobal : []);

    // ------------------------------------------------------------
    // Cambio de pantalla (Inicio / Carrito / Pedidos / Perfil)
    // ------------------------------------------------------------
    function hashFor(name) { return name === 'cart' ? '#carrito' : name === 'home' ? '#inicio' : '#' + name; }
    function nameFromHash() {
        const h = (location.hash || '').replace('#', '');
        return h === 'pedidos' ? 'pedidos' : h === 'perfil' ? 'perfil' : h === 'carrito' ? 'cart' : 'home';
    }

    function syncNav() {
        const fav = favOn();
        document.querySelectorAll('#bottomNav .bn-item').forEach((i) => {
            const v = i.dataset.view;
            const on = current === 'home' ? (fav ? v === 'favs' : v === 'home') : v === current;
            i.classList.toggle('active', on);
            if (on) i.setAttribute('aria-current', 'page'); else i.removeAttribute('aria-current');
        });
        const title = $('secCatalogo');
        if (title) title.textContent = fav ? '❤️ Tus favoritos' : '🍔 Restaurantes y platillos';
    }

    function setView(name, opts) {
        opts = opts || {};
        if (name === 'favs') name = 'home';
        const open = drawerOpen();
        if (name === 'cart') {
            if (!open) toggleCart();
            current = 'cart';
            syncCart();
        } else {
            if (open) toggleCart();
            current = lastView = name;
            Object.keys(VIEWS).forEach((k) => { $(VIEWS[k]).hidden = (k !== name); });
            document.body.classList.remove('view-home', 'view-pedidos', 'view-perfil');
            document.body.classList.add('view-' + name);
            if (!opts.keepScroll) window.scrollTo(0, 0);
            if (name === 'home') setTimeout(() => { try { if (typeof clientMap !== 'undefined' && clientMap) clientMap.invalidateSize(); } catch { /* sin mapa */ } }, 120);
            if (name === 'pedidos' || name === 'perfil') loadOrders();
            if (name === 'perfil') fillProfile();
        }
        syncNav();
        if (!opts.fromHash && location.hash !== hashFor(name)) location.hash = hashFor(name);
    }

    window.addEventListener('hashchange', () => {
        const n = nameFromHash();
        if (n !== current) setView(n, { fromHash: true });
    });

    // Si el carrito se abre/cierra desde app.js (botón ←), el menú se mantiene sincronizado
    new MutationObserver(() => {
        const open = drawerOpen();
        if (open && current !== 'cart') { current = 'cart'; syncNav(); syncCart(); if (location.hash !== '#carrito') location.hash = '#carrito'; }
        else if (!open && current === 'cart') { current = lastView; syncNav(); const h = hashFor(current); if (location.hash !== h) location.hash = h; }
    }).observe(drawer(), { attributes: true, attributeFilter: ['class'] });

    document.addEventListener('click', (e) => {
        const t = e.target.closest && e.target.closest('[data-view]');
        if (!t) return;
        const v = t.dataset.view;
        if (v === 'favs') {
            if (current !== 'home') { setView('home'); if (!favOn()) toggleFavoritosFilter(); }
            else toggleFavoritosFilter();
            syncNav();
            const c = $('secCatalogo'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
        }
        if (v === 'home' && favOn()) toggleFavoritosFilter();   // "Inicio" siempre muestra todo el menú
        setView(v);
    });

    // ------------------------------------------------------------
    // Inicio: saludo, buscador, filtros por restaurante y mapa
    // ------------------------------------------------------------
    let activeChip = '';
    let chipSig = '';

    function buildChips() {
        const names = Array.from(new Set(productos().map((p) => p.restaurante_nombre))).filter(Boolean);
        const sig = names.join('|');
        if (sig === chipSig) return;
        chipSig = sig;
        const box = $('restChips');
        box.innerHTML = '';
        [['Todos', ''], ...names.map((n) => [n, n])].forEach(([label, val]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip' + (activeChip === val ? ' active' : '');
            b.textContent = label;
            b.dataset.val = val;
            box.appendChild(b);
        });
    }

    function applyFilter() {
        const q = ($('searchBox').value || '').trim().toLowerCase();
        const cards = document.querySelectorAll('#productosGrid .card');
        const visibles = new Set();
        let shown = 0;
        cards.forEach((c) => {
            const badge = (c.querySelector('.badge') || {}).textContent || '';
            const ok = (!activeChip || badge.includes(activeChip)) && (!q || c.textContent.toLowerCase().includes(q));
            c.hidden = !ok;
            if (ok) { shown++; visibles.add(badge.replace(/^\s*🏪\s*/, '').split('•')[0].trim()); }
        });
        $('noResults').hidden = !(cards.length && shown === 0);
        const chip = $('mapChip');
        if (chip) chip.textContent = visibles.size ? `🍽️ ${visibles.size} restaurante${visibles.size === 1 ? '' : 's'} cerca de ti` : '🍽️ Restaurantes cerca de ti';
    }

    $('restChips').addEventListener('click', (e) => {
        const b = e.target.closest('.chip');
        if (!b) return;
        activeChip = b.dataset.val;
        document.querySelectorAll('#restChips .chip').forEach((c) => c.classList.toggle('active', c === b));
        applyFilter();
    });
    $('searchBox').addEventListener('input', applyFilter);

    // Marcadores de restaurantes en el mapa (el de tu ubicación lo pone app.js)
    const marcados = new Set();
    function addRestaurantMarkers() {
        if (typeof L === 'undefined' || typeof clientMap === 'undefined' || !clientMap) return;
        const vistos = new Map();
        productos().forEach((p) => { if (p.latitud && p.longitud && !vistos.has(p.restaurante_nombre)) vistos.set(p.restaurante_nombre, p); });
        vistos.forEach((p, name) => {
            if (marcados.has(name)) return;
            marcados.add(name);
            const m = L.circleMarker([Number(p.latitud), Number(p.longitud)], { radius: 10, color: '#ffffff', weight: 3, fillColor: '#7B2857', fillOpacity: 1 }).addTo(clientMap);
            const box = document.createElement('div');
            const t = document.createElement('strong'); t.textContent = name;
            const z = document.createElement('div'); z.textContent = p.zona;
            const b = document.createElement('button'); b.type = 'button'; b.className = 'popup-btn'; b.textContent = 'Ver platillos';
            b.addEventListener('click', () => {
                activeChip = name;
                document.querySelectorAll('#restChips .chip').forEach((c) => c.classList.toggle('active', c.dataset.val === name));
                applyFilter();
                clientMap.closePopup();
                const c = $('secCatalogo'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
            });
            box.append(t, z, b);
            m.bindPopup(box);
        });
    }

    let raf = 0;
    new MutationObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { buildChips(); applyFilter(); addRestaurantMarkers(); });
    }).observe($('productosGrid'), { childList: true });

    // ------------------------------------------------------------
    // Carrito (pantalla completa): vacío, miniaturas y método de pago
    // ------------------------------------------------------------
    function syncCart() {
        const list = $('cartItemsList');
        const empty = list.children.length === 0;
        drawer().classList.toggle('is-empty', empty);
        $('cartEmpty').hidden = !empty;
        list.querySelectorAll('.cart-item').forEach((row) => {
            if (row.querySelector('.ci-img')) return;
            const nombre = (row.querySelector('strong') || {}).textContent;
            const p = productos().find((x) => x.nombre === nombre);
            if (p && p.imagen_url) {
                const img = document.createElement('img');
                img.className = 'ci-img'; img.alt = ''; img.loading = 'lazy'; img.src = p.imagen_url;
                img.onerror = () => img.remove();
                row.prepend(img);
            }
        });
    }
    new MutationObserver(syncCart).observe($('cartItemsList'), { childList: true });

    const NOTAS = {
        Efectivo: 'Pagas en efectivo cuando llegue tu pedido. Te enviamos la confirmación a tu correo.',
        Tarjeta: 'Te llevamos a Mercado Pago para pagar con tu tarjeta de forma segura. Al aprobarse el pago te enviamos la confirmación a tu correo.'
    };
    function setPago(valor) {
        $('paymentMethod').value = valor;
        document.querySelectorAll('.pay-opt').forEach((b) => {
            const on = b.dataset.pay === valor;
            b.classList.toggle('active', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        $('payNote').textContent = NOTAS[valor];
        $('btnPedir').textContent = valor === 'Tarjeta' ? '💳 Pagar con Mercado Pago' : 'Confirmar y pedir ahora';
    }
    document.querySelectorAll('.pay-opt').forEach((b) => b.addEventListener('click', () => setPago(b.dataset.pay)));

    // Recuerda la última dirección de entrega
    try {
        const addr = $('deliveryAddress');
        addr.value = localStorage.getItem('fb_addr') || '';
        addr.addEventListener('input', () => { try { localStorage.setItem('fb_addr', addr.value); } catch { /* sin espacio */ } });
    } catch { /* sin almacenamiento */ }

    // ------------------------------------------------------------
    // Pedidos
    // ------------------------------------------------------------
    let pedidos = [];
    const PASOS = [['pendiente', 'Recibido'], ['preparando', 'Preparando'], ['en_camino', 'En camino'], ['entregado', 'Entregado']];

    // ------------------------------------------------------------
    // Avisos en vivo: "va en camino" / "¡entregado!" sin tener que refrescar
    // ------------------------------------------------------------
    let ultimoEstado = null;
    function notificar(msg) {
        let el = document.getElementById('lbToast');
        if (!el) { el = document.createElement('div'); el.id = 'lbToast'; el.className = 'pwa-toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
        el.textContent = msg; el.classList.add('show');
        try { if (navigator.vibrate) navigator.vibrate([120, 60, 120]); } catch { /* sin vibración */ }
        clearTimeout(notificar._t); notificar._t = setTimeout(() => el.classList.remove('show'), 5200);
    }
    function avisarCambios(nuevos) {
        const mapa = {}; nuevos.forEach((p) => { mapa[p.id] = p.estado; });
        if (ultimoEstado) {
            nuevos.forEach((p) => {
                const antes = ultimoEstado[p.id];
                if (!antes || antes === p.estado) return;
                if (p.estado === 'entregado') notificar('🎉 ¡Tu pedido #' + p.id + ' fue entregado! Buen provecho');
                else if (p.estado === 'en_camino') notificar('🛵 Tu pedido #' + p.id + ' ya va en camino');
                else if (p.estado === 'preparando') notificar('👨‍🍳 Están preparando tu pedido #' + p.id);
            });
        }
        ultimoEstado = mapa;
    }

    async function loadOrders() {
        const u = getUser();
        if (!u) return;
        try {
            const res = await fetch(`${API}/pedidos?cliente_id=${u.id}`);
            if (!res.ok) return;
            const data = await res.json();
            if (!Array.isArray(data)) return;
            avisarCambios(data);
            pedidos = data;
            renderOrders();
            fillStats();
        } catch { /* sin conexión: se queda lo que ya se ve */ }
    }

    function pagoInfo(p) {
        if (p.metodo_pago === 'Tarjeta') {
            if (p.pago_estado === 'aprobado') return { chip: '<span class="pay-chip ok">💳 Pagado con Mercado Pago ✅</span>', pagar: false, esperando: false };
            if (p.pago_estado === 'rechazado') return { chip: '<span class="pay-chip bad">❌ Pago rechazado</span>', pagar: 'Reintentar pago', esperando: true };
            return { chip: '<span class="pay-chip wait">⏳ Pago pendiente</span>', pagar: 'Pagar ahora', esperando: true };
        }
        return { chip: '<span class="pay-chip cash">💵 Pagas en efectivo al recibir</span>', pagar: false, esperando: false };
    }

    function renderOrders() {
        const box = $('pedidosList');
        $('pedidosEmpty').hidden = pedidos.length > 0;
        box.innerHTML = pedidos.map((p) => {
            const pg = pagoInfo(p);
            const idx = Math.max(0, PASOS.findIndex((s) => s[0] === p.estado));
            const pill = pg.esperando
                ? '<span class="status-pill status-pendiente">Esperando pago</span>'
                : `<span class="status-pill status-${esc(p.estado)}">${esc(String(p.estado).replace('_', ' '))}</span>`;
            const steps = pg.esperando ? '' : `<div class="steps">${PASOS.map((s, i) =>
                `<div class="step ${i <= idx ? 'done' : ''} ${i === idx ? 'current' : ''}">${s[1]}</div>`).join('')}</div>`;
            const items = (p.items || []).map((i) => `${esc(i.cantidad)}× ${esc(i.nombre)}`).join(' · ');
            const fecha = p.fecha_pedido ? new Date(p.fecha_pedido).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
            return `
            <article class="order-card">
                <div class="order-top">
                    <div><h3>Pedido #${esc(p.id)}</h3><small>${esc(fecha)}</small></div>
                    ${pill}
                </div>
                ${steps}
                ${items ? `<p class="order-items">${items}</p>` : ''}
                <div class="order-meta">
                    <span>📍 ${esc(p.direccion_entrega)}</span>
                    <span>🛵 ${esc(p.repartidor_nombre || 'Asignando repartidor...')}</span>
                </div>
                <div class="order-bottom">
                    <div><div class="order-total">${money(p.total)}</div>${pg.chip}</div>
                    ${pg.pagar ? `<button type="button" class="pay-now" data-pay-order="${esc(p.id)}">${pg.pagar}</button>` : ''}
                </div>
            </article>`;
        }).join('');
    }

    $('pedidosList').addEventListener('click', async (e) => {
        const b = e.target.closest('[data-pay-order]');
        if (!b) return;
        if (!navigator.onLine) return alert('Necesitas internet para pagar con tarjeta.');
        const label = b.textContent;
        b.disabled = true; b.textContent = 'Abriendo Mercado Pago...';
        try {
            const res = await fetch(`${API}/pagos/mercadopago`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pedido_id: Number(b.dataset.payOrder) })
            });
            const info = await res.json().catch(() => ({}));
            if (res.ok && info.init_point) { window.location.href = info.init_point; return; }
            alert(info.error || 'No se pudo abrir Mercado Pago. Inténtalo de nuevo.');
        } catch { alert('No se pudo conectar. Revisa tu internet e inténtalo de nuevo.'); }
        b.disabled = false; b.textContent = label;
    });

    // Cuando app.js recarga su tabla (después de pedir), actualizamos las tarjetas
    let t1;
    new MutationObserver(() => { clearTimeout(t1); t1 = setTimeout(loadOrders, 400); }).observe($('misPedidosTable'), { childList: true });
    setInterval(() => { if (navigator.onLine && !document.hidden) loadOrders(); }, 8000);   // en vivo: se actualiza solo
    document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) loadOrders(); });
    loadOrders();
    window.addEventListener('online', () => { if (current === 'pedidos' || current === 'perfil') loadOrders(); });


    // ------------------------------------------------------------
    // Corazón fluido: no vuelve a dibujar todo el catálogo (evita el salto y la pausa)
    // ------------------------------------------------------------
    (function () {
        const base = window.toggleLike;
        if (typeof base !== 'function') return;
        window.toggleLike = function (id) {
            const real = window.filtrarPorZona;
            window.filtrarPorZona = function () {};          // evita el re-dibujado completo
            try { base(id); } finally { window.filtrarPorZona = real; }
            const on = Array.isArray(window.favoritos) ? window.favoritos.includes(id) : (typeof favoritos !== 'undefined' && favoritos.includes(id));
            const btn = document.querySelector('.like-btn[onclick="toggleLike(' + id + ')"]');
            if (btn) {
                btn.classList.toggle('liked', on);
                btn.textContent = on ? '❤️' : '🤍';
                btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
            }
            if (!on && favOn() && btn) {
                const card = btn.closest('.card');
                if (card) {
                    card.classList.add('leaving');
                    setTimeout(() => {
                        card.remove();
                        if (!document.querySelector('#productosGrid .card')) {
                            const z = $('zoneSelector');
                            if (typeof real === 'function') real(z ? z.value : 'Todas');   // muestra el mensaje de "sin favoritos"
                        }
                    }, 300);
                }
            }
            syncNav();
        };
    })();

    // ------------------------------------------------------------
    // Perfil
    // ------------------------------------------------------------
    function fillStats() {
        const validos = pedidos.filter((p) => !(p.metodo_pago === 'Tarjeta' && p.pago_estado !== 'aprobado'));
        $('statPedidos').textContent = validos.length;
        $('statEntregados').textContent = validos.filter((p) => p.estado === 'entregado').length;
        $('statFavs').textContent = (typeof favoritos !== 'undefined' ? favoritos.length : 0);
    }
    function fillProfile() {
        const u = getUser() || {};
        const nombre = u.nombre || 'Cliente';
        $('perfilNombre').textContent = nombre;
        $('perfilNombre2').textContent = nombre;
        $('perfilEmail').textContent = u.email || '';
        $('perfilEmail2').textContent = u.email || '—';
        $('perfilTel').textContent = u.telefono || '—';
        $('perfilAvatar').textContent = nombre.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'LB';
        fillStats();
    }

    // ------------------------------------------------------------
    // Arranque
    // ------------------------------------------------------------
    (function init() {
        const u = user || {};
        const primero = String(u.nombre || '').split(/\s+/)[0];
        if (primero) $('heroName').textContent = primero;
        setPago($('paymentMethod').value || 'Efectivo');
        syncCart();
        syncNav();
        const n = nameFromHash();
        if (n !== 'home') setView(n, { fromHash: true, keepScroll: true });
        else if (!location.hash) history.replaceState(null, '', '#inicio');
        buildChips(); applyFilter();
    })();
})();
