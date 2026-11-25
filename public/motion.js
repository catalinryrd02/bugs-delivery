/* LOS BUGS · animaciones: aparición escalonada, ondas, vuelo al carrito, números que cuentan, confeti, esqueletos */
(function () {
    'use strict';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var $ = function (id) { return document.getElementById(id); };

    // ---------- 1. Aparición escalonada ----------
    var SEL = '.card, .order-card, .dash-card, .prod-card, .person-card, .form-card, .info-card, .stats > div, .cart-item, .loc-card, .map-wrap, .route-card';
    var io = ('IntersectionObserver' in window && !reduce) ? new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('lb-in'); io.unobserve(e.target); } });
    }, { threshold: .08, rootMargin: '0px 0px -30px 0px' }) : null;
    function revelar(root) {
        if (!io) return;
        var i = 0;
        (root || document).querySelectorAll(SEL).forEach(function (el) {
            if (el.dataset.lbRev) return;
            el.dataset.lbRev = '1';
            if (el.closest('.cart-drawer') && !el.closest('.cart-drawer.open')) { /* el carrito entra con su pantalla */ }
            el.classList.add('lb-rev');
            el.style.setProperty('--d', Math.min(i++ % 8, 7) * 55 + 'ms');
            io.observe(el);
        });
    }
    function iniciarObservador() {
        revelar(document);
        if (!('MutationObserver' in window) || reduce) return;
        var t;
        new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () { revelar(document); }, 40); })
            .observe(document.body, { childList: true, subtree: true });
    }

    // ---------- 2. Ondas en botones ----------
    document.addEventListener('pointerdown', function (e) {
        if (reduce) return;
        var b = e.target.closest && e.target.closest('.btn, .chip');
        if (!b) return;
        var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
        var d = document.createElement('span');
        d.className = 'lb-ripple';
        d.style.cssText = 'width:' + s + 'px;height:' + s + 'px;left:' + (e.clientX - r.left - s / 2) + 'px;top:' + (e.clientY - r.top - s / 2) + 'px';
        b.appendChild(d);
        setTimeout(function () { d.remove(); }, 650);
    }, { passive: true });

    // ---------- 3. El platillo vuela al carrito ----------
    document.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button[onclick*="agregarAlCarrito"]');
        if (!b || reduce) return;
        var dest = document.querySelector('#bottomNav [data-view="cart"]');
        if (!dest) return;
        var a = b.getBoundingClientRect(), z = dest.getBoundingClientRect();
        var dot = document.createElement('div');
        dot.className = 'lb-fly';
        dot.style.left = (a.left + a.width / 2 - 13) + 'px'; dot.style.top = (a.top + a.height / 2 - 13) + 'px';
        document.body.appendChild(dot);
        var dx = (z.left + z.width / 2) - (a.left + a.width / 2), dy = (z.top + z.height / 2) - (a.top + a.height / 2);
        var anim = dot.animate([
            { transform: 'translate(0,0) scale(1)', opacity: 1 },
            { transform: 'translate(' + dx * .55 + 'px,' + (dy * .55 - 90) + 'px) scale(1.15)', opacity: 1, offset: .5 },
            { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.3)', opacity: .6 }
        ], { duration: 700, easing: 'cubic-bezier(.5,0,.3,1)' });
        anim.onfinish = function () {
            dot.remove();
            dest.classList.remove('lb-bump'); void dest.offsetWidth; dest.classList.add('lb-bump');
        };
    }, true);

    // ---------- 4. Números que cuentan ----------
    var NUM = ['stDisp', 'stRuta', 'stHechos', 'stPedidos', 'stActivos', 'stVentas', 'stClientes', 'statPedidos', 'statEntregados', 'statFavs'];
    function contar(el) {
        if (reduce || el._lbBusy) return;
        var txt = el.textContent, m = txt.match(/^(\D*)([\d.,]+)(\D*)$/);
        if (!m) return;
        var fin = parseFloat(m[2].replace(/,/g, ''));
        var antes = el._lbPrev == null ? 0 : el._lbPrev;
        el._lbPrev = fin;
        if (!isFinite(fin) || fin === antes) return;
        el._lbBusy = true;
        var t0 = performance.now(), dur = 800;
        (function paso(t) {
            var k = Math.min(1, (t - t0) / dur), v = antes + (fin - antes) * (1 - Math.pow(1 - k, 3));
            el.textContent = m[1] + Math.round(v).toLocaleString('es-MX') + m[3];
            if (k < 1) requestAnimationFrame(paso); else { el.textContent = m[1] + (fin).toLocaleString('es-MX') + m[3]; el._lbBusy = false; }
        })(t0);
    }
    function vigilarNumeros() {
        NUM.forEach(function (id) {
            var el = $(id); if (!el) return;
            new MutationObserver(function () { contar(el); }).observe(el, { childList: true, characterData: true, subtree: true });
            contar(el);
        });
    }

    // ---------- 5. Confeti ----------
    window.lbConfetti = function (n) {
        if (reduce) return;
        var cols = ['#7B2857', '#D95B96', '#F3ADC9', '#FBE0EC', '#270D20', '#FFD166'];
        for (var i = 0; i < (n || 70); i++) {
            var c = document.createElement('i');
            c.className = 'lb-confetti';
            c.style.left = Math.random() * 100 + 'vw';
            c.style.background = cols[i % cols.length];
            c.style.setProperty('--x', (Math.random() * 160 - 80) + 'px');
            c.style.setProperty('--r', (Math.random() * 900 - 300) + 'deg');
            c.style.setProperty('--t', (2 + Math.random() * 1.6) + 's');
            c.style.animationDelay = Math.random() * .5 + 's';
            document.body.appendChild(c);
            setTimeout((function (x) { return function () { x.remove(); }; })(c), 4200);
        }
    };
    // Si aparece el aviso de "entregado", ¡confeti!
    new MutationObserver(function () {
        var t = $('lbToast');
        if (t && t.classList.contains('show') && /entregado/i.test(t.textContent) && !t._lbC) { t._lbC = 1; window.lbConfetti(); }
        if (t && !t.classList.contains('show')) t._lbC = 0;
    }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['class'] });

    // ---------- 6. Esqueletos mientras carga el menú ----------
    function esqueletos() {
        var g = $('productosGrid');
        if (!g || g.children.length) return;
        g.innerHTML = '<div class="lb-skel"></div><div class="lb-skel"></div><div class="lb-skel"></div>';
        var mo = new MutationObserver(function () {
            if (!g.querySelector('.lb-skel') || g.querySelector('.card') || g.textContent.trim()) { /* ya hay contenido real */ }
        });
        mo.observe(g, { childList: true });
    }

    // ---------- 7. Marcadores del mapa con latido ----------
    function latido() {
        document.querySelectorAll('.leaflet-overlay-pane path.leaflet-interactive').forEach(function (p) { p.classList.add('lb-beat'); });
    }
    setInterval(latido, 2500);

    // ---------- Inicio ----------
    function listo() {
        esqueletos(); iniciarObservador(); vigilarNumeros();
        var logo = document.querySelector('.hero-logo, .lbrand img, .auth-logo, .lcard img');
        if (logo) logo.classList.add('lb-float');
        document.querySelectorAll('.lbtns, .lactions, .auth-actions').forEach(function (x) { x.classList.add('lb-stagger'); });
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', listo); else listo();
})();
