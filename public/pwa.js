/* LOS BUGS DELIVERY - capa PWA
   Se carga DESPUÉS de app.js y NO modifica su código:
   - registra sw.js e instalación (botón "Instalar app")
   - modo offline: cola de cambios que se envía sola al volver el internet
   - guarda favoritos en la base de datos
   - barra de navegación inferior (estado activo e insignias) */
(function () {
    'use strict';

    // ------------------------------------------------------------
    // Utilidades
    // ------------------------------------------------------------
    const QUEUE_KEY = 'fb_queue';
    const OFFLINE_USERS_KEY = 'fb_offline_users';
    const API = (typeof API_URL !== 'undefined' ? API_URL : '/api');

    function readJSON(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    }
    function writeJSON(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin espacio */ }
    }
    function currentUser() { return readJSON('fb_user', null); }
    function newRef() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    }
    function jsonResponse(obj, status) {
        return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
    }

    // Aviso flotante
    function toast(msg) {
        let el = document.getElementById('pwaToast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'pwaToast';
            el.className = 'pwa-toast';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.textContent = msg;
        el.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => el.classList.remove('show'), 3800);
    }

    // ------------------------------------------------------------
    // 1. Service Worker
    // ------------------------------------------------------------
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').then((reg) => {
                reg.addEventListener('updatefound', () => {
                    const nw = reg.installing;
                    if (!nw) return;
                    nw.addEventListener('statechange', () => {
                        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
                            toast('Hay una versión nueva. Cierra y abre la app para actualizar.');
                        }
                    });
                });
                // Precalienta datos para que funcionen sin internet
                if (navigator.onLine) fetch(`${API}/productos`).catch(() => {});
            }).catch((err) => console.warn('SW no registrado:', err));
        });
    }

    // ------------------------------------------------------------
    // 2. Instalación de la PWA
    // ------------------------------------------------------------
    let deferredPrompt = null;
    const isStandalone = () =>
        window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

    function installHelp() {
        if (isIOS) return 'En iPhone: toca Compartir y luego "Agregar a pantalla de inicio".';
        return 'Para instalar: abre el menú ⋮ del navegador y elige "Instalar app" o "Agregar a pantalla principal".';
    }
    function setInstallUI() {
        const box = document.getElementById('installBox');
        if (!box) return;
        box.hidden = isStandalone();   // ya instalada: se oculta el botón
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        setInstallUI();
    });
    window.addEventListener('appinstalled', () => {
        deferredPrompt = null;
        setInstallUI();
        toast('¡LOS BUGS instalada! Búscala en tu pantalla de inicio.');
    });
    document.addEventListener('click', async (e) => {
        if (!e.target.closest || !e.target.closest('#installBtn')) return;
        if (!deferredPrompt) {   // el navegador no ofrece instalación directa: mostrar cómo hacerlo
            const tip = document.getElementById('installTip');
            if (tip) { tip.textContent = installHelp(); tip.hidden = false; }
            return;
        }
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch { /* ignorar */ }
        deferredPrompt = null;
        setInstallUI();
    });
    document.addEventListener('DOMContentLoaded', setInstallUI);

    // Si ya hay sesión y se abre la app instalada, entra directo a su panel
    document.addEventListener('DOMContentLoaded', () => {
        const isLogin = document.getElementById('loginForm');
        const u = currentUser();
        if (isLogin && u && u.rol) {
            const dest = u.rol === 'admin' ? 'admin.html' : u.rol === 'repartidor' ? 'repartidor.html' : 'cliente.html';
            window.location.replace(dest);
        }
    });

    // ------------------------------------------------------------
    // 3. Offline: cola de cambios + login sin internet
    // ------------------------------------------------------------
    const nativeFetch = window.fetch.bind(window);

    function getQueue() { return readJSON(QUEUE_KEY, []); }
    function setQueue(q) { writeJSON(QUEUE_KEY, q); updateOfflineBar(); }

    async function sha256(text) {
        if (!(window.crypto && crypto.subtle)) return null;
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function isMutation(method) { return ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method); }
    function isApi(url) {
        try { const u = new URL(url, location.origin); return u.origin === location.origin && u.pathname.startsWith('/api/'); }
        catch { return false; }
    }

    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : input.url;
        const method = ((init && init.method) || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();

        if (!isApi(url) || !isMutation(method)) return nativeFetch(input, init);

        const path = new URL(url, location.origin).pathname;
        const isAuth = path === '/api/login' || path === '/api/register';

        // --- Login: guarda un acceso local para poder entrar sin internet ---
        if (path === '/api/login') {
            try {
                const res = await nativeFetch(input, init);
                if (res.ok) {
                    try {
                        const body = JSON.parse(init.body);
                        const data = await res.clone().json();
                        const hash = await sha256(`${String(body.email).trim().toLowerCase()}:${body.password}`);
                        if (hash && data.user) {
                            const map = readJSON(OFFLINE_USERS_KEY, {});
                            map[hash] = data.user;
                            writeJSON(OFFLINE_USERS_KEY, map);
                        }
                    } catch { /* no bloquea el login */ }
                }
                return res;
            } catch (err) {
                // Sin conexión: intenta con un acceso guardado en este dispositivo
                try {
                    const body = JSON.parse(init.body);
                    const hash = await sha256(`${String(body.email).trim().toLowerCase()}:${body.password}`);
                    const user = hash && readJSON(OFFLINE_USERS_KEY, {})[hash];
                    if (user) return jsonResponse({ user }, 200);
                } catch { /* sigue */ }
                throw err; // app.js usa sus cuentas demo como respaldo
            }
        }

        if (isAuth) return nativeFetch(input, init);

        // --- Cambios (pedidos, estados, productos, favoritos...) ---
        let bodyText = init && typeof init.body === 'string' ? init.body : null;
        if (path === '/api/pedidos' && method === 'POST' && bodyText) {
            try {
                const obj = JSON.parse(bodyText);
                if (!obj.ref) obj.ref = newRef();   // evita pedidos duplicados al reintentar
                bodyText = JSON.stringify(obj);
            } catch { /* se envía igual */ }
        }
        const opts = Object.assign({}, init, bodyText !== null ? { body: bodyText } : {});

        const enqueue = () => {
            const q = getQueue();
            q.push({ url: path, method, body: bodyText, headers: { 'Content-Type': 'application/json' }, t: Date.now() });
            setQueue(q);
            toast('Sin internet: se guardó y se enviará solo cuando vuelva la conexión.');
            return jsonResponse({ queued: true, message: 'Guardado para enviar al reconectar' }, 202);
        };

        // Si ya hay cambios pendientes, respeta el orden y encola también
        if (!navigator.onLine || getQueue().length > 0) {
            if (navigator.onLine) { flushQueue(); }
            return enqueue();
        }
        try {
            return await nativeFetch(input, opts);
        } catch (err) {
            return enqueue();
        }
    };

    let flushing = false;
    async function flushQueue() {
        if (flushing || !navigator.onLine) return;
        let q = getQueue();
        if (!q.length) return;
        flushing = true;
        let sent = 0;
        try {
            while (q.length) {
                const item = q[0];
                let res;
                try {
                    res = await nativeFetch(item.url, { method: item.method, headers: item.headers, body: item.body });
                } catch { break; } // sigue sin red: se reintenta luego
                if (res.status >= 500) break; // servidor/BD con problemas: reintentar luego
                q.shift();                      // OK o error 4xx (no se puede reintentar)
                sent++;
                setQueue(q);
            }
        } finally { flushing = false; }
        if (sent) {
            toast(`Se enviaron ${sent} cambio(s) pendiente(s) a la base de datos.`);
            refreshCurrentView();
        }
    }

    function refreshCurrentView() {
        // Solo refresca la tabla que existe en la pantalla actual
        const call = (name, tableId) => {
            try { if (document.getElementById(tableId) && typeof window[name] === 'function') window[name](); } catch { /* ignorar */ }
        };
        call('cargarPedidosCliente', 'misPedidosTable');
        call('cargarPedidosRepartidor', 'driverPedidosTable');
        call('cargarTablaAdminProductos', 'adminProductosTable');
        call('cargarTablaAdminUsuarios', 'adminUsuariosTable');
    }

    // Barra de estado de conexión
    function updateOfflineBar() {
        let bar = document.getElementById('offlineBar');
        const pending = getQueue().length;
        const offline = !navigator.onLine;
        if (!offline && !pending) { if (bar) bar.classList.remove('show'); return; }
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'offlineBar';
            bar.className = 'offline-bar';
            document.body.appendChild(bar);
        }
        bar.textContent = offline
            ? `Sin conexión · modo offline${pending ? ` · ${pending} pendiente(s)` : ''}`
            : `Sincronizando ${pending} cambio(s)...`;
        bar.classList.add('show');
    }

    window.addEventListener('online', () => { updateOfflineBar(); flushQueue(); });
    window.addEventListener('offline', updateOfflineBar);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
    window.addEventListener('load', () => { updateOfflineBar(); flushQueue(); });

    // ------------------------------------------------------------
    // 4. Favoritos guardados en la base de datos (cliente)
    // ------------------------------------------------------------
    if (typeof window.toggleLike === 'function' && typeof favoritos !== 'undefined') {
        const originalToggleLike = window.toggleLike;
        window.toggleLike = function (id) {
            originalToggleLike(id);
            const u = currentUser();
            if (!u) return;
            fetch(`${API}/favoritos`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ usuario_id: u.id, producto_id: id, activo: favoritos.includes(id) })
            }).catch(() => {});
        };

        window.addEventListener('load', async () => {
            const u = currentUser();
            if (!u || u.rol !== 'cliente' || !navigator.onLine) return;
            try {
                const res = await nativeFetch(`${API}/favoritos/${u.id}`);
                if (!res.ok) return;
                const ids = (await res.json()).map(Number);
                // Une lo guardado en la base de datos con lo de este dispositivo
                const merged = Array.from(new Set([...ids, ...favoritos.map(Number)]));
                favoritos = merged;
                localStorage.setItem('fb_favs', JSON.stringify(merged));
                const fc = document.getElementById('favCount');
                if (fc) fc.textContent = merged.length;
                if (typeof productosGlobal !== 'undefined' && productosGlobal.length) {
                    filtrarPorZona(document.getElementById('zoneSelector').value);
                }
                // sube los que solo estaban en el teléfono
                merged.filter(id => !ids.includes(id)).forEach(id =>
                    fetch(`${API}/favoritos`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ usuario_id: u.id, producto_id: id, activo: true })
                    }).catch(() => {}));
            } catch { /* sin servidor: se queda con lo local */ }
        });
    }

    // ------------------------------------------------------------
    // 5. Barra de navegación inferior (estado activo + insignias)
    // ------------------------------------------------------------
    document.addEventListener('DOMContentLoaded', () => {
        const nav = document.getElementById('bottomNav');
        if (!nav) return;
        const items = Array.from(nav.querySelectorAll('.bn-item'));

        function setActive(el) {
            items.forEach(i => { i.classList.toggle('active', i === el); i.removeAttribute('aria-current'); });
            if (el) el.setAttribute('aria-current', 'page');
        }

        items.forEach((item) => {
            item.addEventListener('click', () => {
                const target = item.dataset.target;
                if (target === 'top') window.scrollTo({ top: 0, behavior: 'smooth' });
                else if (target) {
                    const sec = document.getElementById(target);
                    if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                if (item.dataset.keep !== 'true') setActive(item);
            });
        });

        // Resalta la sección visible al hacer scroll
        const spy = items.filter(i => i.dataset.target && i.dataset.target !== 'top');
        if ('IntersectionObserver' in window && spy.length) {
            const home = items.find(i => i.dataset.target === 'top');
            const obs = new IntersectionObserver((entries) => {
                entries.forEach((en) => {
                    if (en.isIntersecting) {
                        const it = spy.find(i => i.dataset.target === en.target.id);
                        if (it) setActive(it);
                    }
                });
            }, { rootMargin: '-35% 0px -55% 0px' });
            spy.forEach(i => { const s = document.getElementById(i.dataset.target); if (s) obs.observe(s); });
            window.addEventListener('scroll', () => {
                if (home && window.scrollY < 120) setActive(home);
            }, { passive: true });
        }

        // Insignias: copian los contadores que ya mantiene app.js
        function mirror(srcId, badgeId) {
            const src = document.getElementById(srcId), badge = document.getElementById(badgeId);
            if (!src || !badge) return;
            const sync = () => {
                const n = parseInt(src.textContent, 10) || 0;
                badge.textContent = n;
                badge.hidden = n === 0;
            };
            sync();
            new MutationObserver(sync).observe(src, { childList: true, characterData: true, subtree: true });
        }
        mirror('cartCount', 'bnCartBadge');
        mirror('favCount', 'bnFavBadge');

        // Favoritos: activo mientras el filtro de favoritos esté encendido
        const favItem = nav.querySelector('[data-role="fav"]');
        if (favItem) {
            favItem.addEventListener('click', () => {
                setTimeout(() => {
                    const on = typeof soloFavoritos !== 'undefined' && soloFavoritos;
                    favItem.classList.toggle('active', on);
                    if (!on) setActive(items.find(i => i.dataset.target === 'top'));
                    else { items.forEach(i => { if (i !== favItem) i.classList.remove('active'); }); }
                }, 0);
            });
        }
        // Carrito: no queda marcado, solo abre/cierra el panel
        const cartItem = nav.querySelector('[data-role="cart"]');
        if (cartItem) {
            cartItem.addEventListener('click', () => {
                const open = document.getElementById('cartDrawer');
                cartItem.classList.toggle('active', !!(open && open.classList.contains('open')));
            });
        }
    });
})();
