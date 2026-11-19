# LOS BUGS DELIVERY — PWA

## Qué trae
- `public/manifest.json` + `public/sw.js` + `public/pwa.js` (instalar, offline, cola de pedidos)
- Logo LOS BUGS en `public/icons/` (192, 512, maskable, apple-touch, favicon)
- Paleta guinda (#2B0710 → #FCE3E8) + rosa del logo; barra de navegación inferior tipo píldora
- `public/app.js` **sin ningún cambio** (la capa PWA se monta encima desde `pwa.js`)
- `server.js`: crea las tablas y datos de ejemplo solos; favoritos, pedidos y usuarios se guardan en MySQL

## Probar en tu computadora
```
npm install
npm start          # http://localhost:3000
```
Usa tu MySQL local igual que antes (root / mysql123 / fastbite_db).

## Conseguir la URL para instalar (HTTPS obligatorio)
Una PWA solo se instala desde una URL https. Necesitas 2 cosas gratis:

**1) Base de datos MySQL en la nube** (cualquiera): TiDB Cloud (Starter), Aiven, Railway…
Copia su cadena de conexión con este formato:
`mysql://USUARIO:CLAVE@HOST:PUERTO/NOMBRE_BD`

**2) Hosting Node** (ej. Render.com → New → Web Service, conectado a tu repo de GitHub)
- Build Command: `npm install`
- Start Command: `npm start`
- Environment (variables):
  - `DATABASE_URL` = la cadena de arriba
  - `DB_SSL` = `true`

Render te da una URL tipo `https://los-bugs-delivery.onrender.com`. Esa es tu URL app.

> Subir a GitHub desde el celular: crea el repo, sube los archivos de la raíz; luego crea
> la carpeta `public` (Add file → Create new file → escribe `public/x` y guarda), entra a ella y
> sube ahí los archivos; repite para `public/icons`. **No subas `node_modules`.**

> El plan gratis de Render "duerme" la app sin uso: la primera carga puede tardar ~1 min,
> pero ya instalada la app abre al instante desde el caché.

## Instalar en el teléfono
Abre la URL en Chrome (Android) → aparece el botón **Instalar app** en la pantalla de login
(o menú ⋮ → *Instalar app*). En iPhone: Compartir → *Agregar a pantalla de inicio*.

## Cómo funciona sin internet
- Abre la app al menos **una vez con internet** (así se guarda todo).
- Sin internet: abre, navega, ve el catálogo y tus pedidos guardados, agrega al carrito.
- Pedidos, favoritos y cambios hechos sin internet se guardan en el teléfono y se mandan a MySQL **solos** al volver la conexión (el pedido no se duplica).
- Entrar sin internet funciona en cuentas con las que ya iniciaste sesión en ese teléfono.
- El mapa necesita internet la primera vez; después muestra lo ya visto.

## Cuentas de ejemplo
admin@fastbite.com / admin123 · repartidor@fastbite.com / repa123 · cliente@fastbite.com / cliente123

## Si cambias archivos
Sube el número de `CACHE_VERSION` en `public/sw.js` (v1 → v2) para que los teléfonos se actualicen.
