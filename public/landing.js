/* LOS BUGS · portada animada: comida flotando, letras que entran, palabra que cambia, tarjeta que se inclina */
(function () {
    'use strict';
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // 1. Comida flotando
    var box = document.getElementById('floaters');
    if (box && !reduce) {
        var comida = ['🍔', '🍕', '🌮', '🍣', '🍩', '🥤', '🍟', '🌯', '🍦', '🥗', '🍰', '🍜'];
        var n = window.innerWidth < 600 ? 9 : 16;
        for (var i = 0; i < n; i++) {
            var s = document.createElement('span');
            s.textContent = comida[i % comida.length];
            s.style.setProperty('--x', (Math.random() * 96) + 'vw');
            s.style.setProperty('--s', (22 + Math.random() * 34) + 'px');
            s.style.setProperty('--t', (14 + Math.random() * 14) + 's');
            s.style.setProperty('--d', (-Math.random() * 24) + 's');
            s.style.setProperty('--w', (Math.random() * 60 - 30) + 'px');
            s.style.setProperty('--r', (Math.random() * 120 - 60) + 'deg');
            box.appendChild(s);
        }
    }

    // 2. Título letra por letra
    var h1 = document.querySelector('.hero h1');
    if (h1 && !reduce) {
        var txt = h1.textContent;
        h1.setAttribute('aria-label', txt);
        h1.textContent = '';
        txt.split('').forEach(function (c, i) {
            var sp = document.createElement('span');
            sp.className = 'ch'; sp.setAttribute('aria-hidden', 'true');
            sp.style.setProperty('--i', i);
            sp.textContent = c === ' ' ? ' ' : c;
            h1.appendChild(sp);
        });
    }

    // 3. Palabra que se escribe sola (lado de marca)
    var w = document.getElementById('bsWord');
    if (w && !reduce) {
        var palabras = ['pizza', 'tacos', 'sushi', 'hamburguesa', 'pasta', 'postres'], p = 0, k = 0, borrando = false;
        (function paso() {
            var actual = palabras[p];
            w.textContent = actual.slice(0, k);
            var espera = borrando ? 55 : 110;
            if (!borrando && k === actual.length) { borrando = true; espera = 1500; }
            else if (borrando && k === 0) { borrando = false; p = (p + 1) % palabras.length; espera = 350; }
            else k += borrando ? -1 : 1;
            setTimeout(paso, espera);
        })();
    }

    // 4. Tarjeta que se inclina con el mouse (solo escritorio)
    var card = document.getElementById('tiltCard');
    if (card && !reduce && window.matchMedia('(hover: hover) and (min-width: 940px)').matches) {
        document.addEventListener('mousemove', function (e) {
            var x = (e.clientX / window.innerWidth - .5), y = (e.clientY / window.innerHeight - .5);
            card.style.transform = 'perspective(1000px) rotateY(' + (x * 7) + 'deg) rotateX(' + (-y * 6) + 'deg)';
        });
        document.addEventListener('mouseleave', function () { card.style.transform = ''; });
    }
})();
