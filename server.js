/* LOS BUGS DELIVERY - servidor (Express + MySQL)
   Configuración por variables de entorno (para publicarlo en internet):
     PORT                 puerto (lo pone el hosting solo)
     DATABASE_URL         mysql://usuario:clave@host:puerto/base   (opción más fácil)
     o bien DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME
     DB_SSL=true          si tu MySQL en la nube exige SSL (TiDB, Aiven, PlanetScale...)
   Si no pones nada, usa tu MySQL local como antes (root / mysql123 / fastbite_db). */
const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ---------- Archivos de la PWA ----------
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders(res, filePath) {
        if (filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');            // el service worker siempre se revisa
            res.setHeader('Service-Worker-Allowed', '/');
        } else if (filePath.endsWith('manifest.json')) {
            res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache');
        } else if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

// ---------- Conexión a MySQL ----------
function buildConfig() {
    const url = process.env.DATABASE_URL || process.env.MYSQL_URL;
    const cfg = { waitForConnections: true, connectionLimit: 10, charset: 'utf8mb4', decimalNumbers: true, dateStrings: false };
    let wantsSsl = process.env.DB_SSL === 'true';
    if (url) {
        const u = new URL(url);
        cfg.host = u.hostname;
        cfg.port = Number(u.port) || 3306;
        cfg.user = decodeURIComponent(u.username);
        cfg.password = decodeURIComponent(u.password);
        cfg.database = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'fastbite_db';
        const q = u.searchParams;
        if (q.get('ssl') === 'true' || /required|verify/i.test(q.get('ssl-mode') || '')) wantsSsl = true;
    } else {
        cfg.host = process.env.DB_HOST || 'localhost';
        cfg.port = Number(process.env.DB_PORT) || 3306;
        cfg.user = process.env.DB_USER || 'root';
        cfg.password = process.env.DB_PASSWORD !== undefined ? process.env.DB_PASSWORD : 'mysql123';
        cfg.database = process.env.DB_NAME || 'fastbite_db';
    }
    if (wantsSsl) cfg.ssl = { rejectUnauthorized: process.env.DB_SSL_STRICT === 'true' };
    return cfg;
}

const config = buildConfig();
const pool = mysql.createPool(config);
const db = pool.promise();
let dbReady = false;

const SCHEMA = [
`CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    rol ENUM('cliente', 'admin', 'repartidor') NOT NULL DEFAULT 'cliente',
    telefono VARCHAR(20),
    vehiculo VARCHAR(50) NULL,
    estado_repartidor ENUM('disponible', 'ocupado', 'desconectado') DEFAULT 'disponible',
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`,
`CREATE TABLE IF NOT EXISTS restaurantes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    categoria VARCHAR(50) NOT NULL,
    zona VARCHAR(100) NOT NULL,
    latitud DECIMAL(10, 8) NOT NULL,
    longitud DECIMAL(11, 8) NOT NULL,
    tiempo_entrega VARCHAR(30) DEFAULT '20-35 min',
    calificacion DECIMAL(2,1) DEFAULT 4.8,
    imagen_url VARCHAR(255)
)`,
`CREATE TABLE IF NOT EXISTS productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    precio DECIMAL(10, 2) NOT NULL,
    imagen_url VARCHAR(255),
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE
)`,
`CREATE TABLE IF NOT EXISTS favoritos (
    usuario_id INT NOT NULL,
    producto_id INT NOT NULL,
    PRIMARY KEY (usuario_id, producto_id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
)`,
`CREATE TABLE IF NOT EXISTS pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id INT NOT NULL,
    repartidor_id INT NULL,
    direccion_entrega VARCHAR(255) NOT NULL,
    lat_entrega DECIMAL(10, 8),
    lng_entrega DECIMAL(11, 8),
    total DECIMAL(10, 2) NOT NULL,
    metodo_pago VARCHAR(50) DEFAULT 'Efectivo',
    estado ENUM('pendiente', 'preparando', 'en_camino', 'entregado') DEFAULT 'pendiente',
    ref VARCHAR(40) NULL UNIQUE,
    pago_estado VARCHAR(20) NOT NULL DEFAULT 'contra_entrega',
    mp_payment_id VARCHAR(40) NULL,
    correo_enviado TINYINT NOT NULL DEFAULT 0,
    fecha_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES usuarios(id),
    FOREIGN KEY (repartidor_id) REFERENCES usuarios(id)
)`,
`CREATE TABLE IF NOT EXISTS detalle_pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_id INT NOT NULL,
    producto_id INT NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id)
)`
];

async function initDatabase() {
    // En local, crea la base si no existe (en la nube la base ya viene creada)
    if (!process.env.DATABASE_URL && !process.env.MYSQL_URL) {
        const { database, ...noDb } = config;
        const tmp = mysql.createConnection(noDb).promise();
        await tmp.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
        await tmp.end();
    }
    for (const sql of SCHEMA) await db.query(sql);

    // Bases creadas con la versión anterior: agrega la columna "ref" (anti-pedidos duplicados)
    const [refCol] = await db.query("SHOW COLUMNS FROM pedidos LIKE 'ref'");
    if (refCol.length === 0) {
        await db.query('ALTER TABLE pedidos ADD COLUMN ref VARCHAR(40) NULL');
        await db.query('ALTER TABLE pedidos ADD UNIQUE INDEX uq_pedidos_ref (ref)');
    }
    // Pagos con Mercado Pago y correos: columnas nuevas (los pedidos viejos quedan como "contra_entrega")
    for (const [col, ddl] of [
        ['pago_estado', "VARCHAR(20) NOT NULL DEFAULT 'contra_entrega'"],
        ['mp_payment_id', 'VARCHAR(40) NULL'],
        ['correo_enviado', 'TINYINT NOT NULL DEFAULT 0']
    ]) {
        const [existe] = await db.query(`SHOW COLUMNS FROM pedidos LIKE '${col}'`);
        if (existe.length === 0) await db.query(`ALTER TABLE pedidos ADD COLUMN ${col} ${ddl}`);
    }

    const [[{ n: nUsers }]] = await db.query('SELECT COUNT(*) AS n FROM usuarios');
    if (nUsers === 0) {
        await db.query(`INSERT INTO usuarios (nombre, email, password, rol, telefono, vehiculo) VALUES
            ('Administrador General', 'admin@fastbite.com', 'admin123', 'admin', '5511223344', NULL),
            ('Carlos Mendoza (Moto)', 'repartidor@fastbite.com', 'repa123', 'repartidor', '5599887766', 'Motocicleta Italika 150cc'),
            ('Sofía Ramírez', 'cliente@fastbite.com', 'cliente123', 'cliente', '5544332211', NULL)`);
    }
    await seedCatalog();
}

// ---------- Catálogo de ejemplo (restaurantes y platillos) ----------
// Se agrega una sola vez (si aún no existe el restaurante "Pollo Crujiente Express").
// Busca los restaurantes por nombre, así que no depende de números de id.
const U = (id, w) => `https://images.unsplash.com/${id}?w=${w}`;
const CATALOGO = [
  { nombre: 'Burger Kingz Grill', categoria: 'Hamburguesas', zona: 'Zona Centro', lat: 19.635, lng: -99.310, t: '20-30 min', c: 4.9, img: U('photo-1568901346375-23c9450c58cd', 500), productos: [
    ['Doble Queso Tocino XL', 'Doble carne res a la parrilla, queso cheddar fundido, tocino crujiente y papas.', 145, U('photo-1553979459-d2229ba7433b', 400)],
    ['Combo Crispy Chicken', 'Pechuga empanizada extra crujiente, aderezo chipotle y refresco 600ml.', 125, U('photo-1626082927389-6cd097cdc6ec', 400)],
    ['Hamburguesa Clásica', 'Carne de res, lechuga, jitomate, cebolla y aderezo de la casa.', 99, '/img/burger.svg'],
    ['Papas Gajo con Queso', 'Papas gajo doradas con salsa de queso cheddar.', 55, '/img/fries.svg'],
    ['Malteada de Vainilla', 'Malteada cremosa con crema batida.', 69, '/img/drink.svg'] ] },
  { nombre: 'Tacos El Patrón', categoria: 'Mexicana', zona: 'Zona Norte', lat: 19.640, lng: -99.305, t: '15-25 min', c: 4.8, img: U('photo-1565299585323-38d6b0865b47', 500), productos: [
    ['Orden 5 Tacos al Pastor', 'Con piña, cilantro, cebolla, salsa verde cruda y limones.', 85, U('photo-1551504734-5ee1c4a1479b', 400)],
    ['Gringa de Pastor', 'Tortilla de harina con queso y pastor, con piña.', 75, '/img/tacos.svg'],
    ['Burrito de Asada', 'Tortilla grande con arroz, frijoles, carne asada y queso.', 95, '/img/burrito.svg'],
    ['Quesadillas (3 pzas)', 'Quesadillas de maíz con queso Oaxaca.', 70, '/img/cheese.svg'],
    ['Agua de Horchata 1L', 'Agua fresca de horchata con canela.', 35, '/img/drink.svg'] ] },
  { nombre: 'Napoli Express Pizza', categoria: 'Pizzas', zona: 'Zona Centro', lat: 19.632, lng: -99.312, t: '25-40 min', c: 4.7, img: U('photo-1513104890138-7c749659a591', 500), productos: [
    ['Pizza Pepperoni Suprema', 'Pizza grande de 8 rebanadas con doble pepperoni y orilla rellena de queso.', 189, U('photo-1628840042765-356cda07504e', 400)],
    ['Pizza Hawaiana', 'Jamón y piña con mucho queso mozzarella.', 175, '/img/pizza.svg'],
    ['Pizza Margarita', 'Salsa de tomate, mozzarella y albahaca fresca.', 159, '/img/pizza.svg'],
    ['Calzone de Jamón y Queso', 'Pizza cerrada rellena, horneada al momento.', 120, '/img/cheese.svg'],
    ['Pan de Ajo', 'Pan artesanal con mantequilla de ajo y queso.', 59, '/img/bread.svg'] ] },
  { nombre: 'Pollo Crujiente Express', categoria: 'Pollo', zona: 'Zona Centro', lat: 19.634, lng: -99.308, t: '20-30 min', c: 4.6, img: '/img/chicken.svg', productos: [
    ['Alitas BBQ (10 pzas)', 'Alitas bañadas en salsa BBQ con dip de ranch.', 149, '/img/chicken.svg'],
    ['Tiras de Pollo Empanizadas', 'Tiras crujientes con aderezo de miel y mostaza.', 119, '/img/chicken.svg'],
    ['Combo Familiar 6 piezas', '6 piezas de pollo, papas grandes y 4 refrescos.', 259, '/img/chicken.svg'],
    ['Papas Fritas Grandes', 'Papas fritas doradas con sal.', 45, '/img/fries.svg'] ] },
  { nombre: 'Sushi Nori', categoria: 'Sushi', zona: 'Zona Norte', lat: 19.642, lng: -99.307, t: '30-45 min', c: 4.8, img: '/img/sushi.svg', productos: [
    ['Roll California', '8 piezas con surimi, aguacate y pepino.', 129, '/img/sushi.svg'],
    ['Roll Philadelphia', '8 piezas con salmón, queso crema y pepino.', 139, '/img/sushi.svg'],
    ['Nigiri Mixto (8 pzas)', 'Selección de nigiris de salmón, atún y camarón.', 159, '/img/sushi.svg'],
    ['Ensalada Wakame', 'Alga wakame con ajonjolí y aderezo oriental.', 79, '/img/salad.svg'] ] },
  { nombre: 'Hot Dogzilla', categoria: 'Hot Dogs', zona: 'Zona Norte', lat: 19.638, lng: -99.304, t: '15-25 min', c: 4.5, img: '/img/hotdog.svg', productos: [
    ['Hot Dog Jumbo', 'Salchicha jumbo con cebolla, jitomate y aderezos.', 65, '/img/hotdog.svg'],
    ['Hot Dog con Tocino', 'Envuelto en tocino con queso y jalapeño.', 79, '/img/hotdog.svg'],
    ['Papas Locas', 'Papas con queso, tocino y salchicha picada.', 69, '/img/fries.svg'] ] },
  { nombre: 'Dulce Tentación', categoria: 'Postres', zona: 'Zona Centro', lat: 19.633, lng: -99.314, t: '20-35 min', c: 4.9, img: '/img/cake.svg', productos: [
    ['Pastel de Chocolate (rebanada)', 'Pastel húmedo de chocolate con betún.', 69, '/img/cake.svg'],
    ['Cheesecake de Fresa', 'Rebanada de cheesecake con salsa de fresa.', 75, '/img/cake.svg'],
    ['Helado de Vainilla (3 bolas)', 'Tres bolas de helado con galleta.', 59, '/img/icecream.svg'],
    ['Donas Glaseadas (3 pzas)', 'Donas suaves con glaseado de colores.', 55, '/img/donut.svg'],
    ['Crepa de Nutella', 'Crepa con Nutella, plátano y fresas.', 79, '/img/pancakes.svg'] ] },
  { nombre: 'Café & Brunch Bugs', categoria: 'Cafetería', zona: 'Zona Centro', lat: 19.636, lng: -99.311, t: '15-25 min', c: 4.7, img: '/img/coffee.svg', productos: [
    ['Café Americano', 'Café de grano recién molido.', 35, '/img/coffee.svg'],
    ['Capuchino', 'Espresso con leche vaporizada y espuma.', 49, '/img/coffee.svg'],
    ['Sándwich Club', 'Pollo, tocino, lechuga, jitomate y mayonesa en pan tostado.', 89, '/img/sandwich.svg'],
    ['Hot Cakes (3 pzas)', 'Con mantequilla, miel de maple y fruta.', 79, '/img/pancakes.svg'] ] },
  { nombre: 'Pasta Mía', categoria: 'Italiana', zona: 'Zona Norte', lat: 19.641, lng: -99.309, t: '25-40 min', c: 4.6, img: '/img/pasta.svg', productos: [
    ['Spaghetti Boloñesa', 'Spaghetti con salsa de carne y queso parmesano.', 109, '/img/pasta.svg'],
    ['Fettuccine Alfredo', 'Fettuccine en cremosa salsa Alfredo.', 119, '/img/pasta.svg'],
    ['Lasaña de Carne', 'Capas de pasta, carne, bechamel y queso gratinado.', 129, '/img/pasta.svg'],
    ['Ensalada César', 'Lechuga, crotones, parmesano y aderezo César.', 85, '/img/salad.svg'] ] }
];

async function seedCatalog() {
    const marker = 'Pollo Crujiente Express';
    const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM restaurantes WHERE nombre = ?', [marker]);
    if (n > 0) return; // ya se agregó: no vuelve a meter platillos que el admin haya borrado
    for (const r of CATALOGO) {
        let [rows] = await db.query('SELECT id FROM restaurantes WHERE nombre = ? LIMIT 1', [r.nombre]);
        let rid;
        if (rows.length) rid = rows[0].id;
        else {
            const [ins] = await db.query(
                'INSERT INTO restaurantes (nombre, categoria, zona, latitud, longitud, tiempo_entrega, calificacion, imagen_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [r.nombre, r.categoria, r.zona, r.lat, r.lng, r.t, r.c, r.img]);
            rid = ins.insertId;
        }
        for (const [nombre, desc, precio, img] of r.productos) {
            const [ex] = await db.query('SELECT id FROM productos WHERE restaurante_id = ? AND nombre = ? LIMIT 1', [rid, nombre]);
            if (!ex.length) {
                await db.query('INSERT INTO productos (restaurante_id, nombre, descripcion, precio, imagen_url) VALUES (?, ?, ?, ?, ?)',
                    [rid, nombre, desc, precio, img]);
            }
        }
    }
    console.log('🍽️  Catálogo de ejemplo agregado');
}

async function connectWithRetry(attempt = 1) {
    try {
        await initDatabase();
        dbReady = true;
        console.log(`✅ Base de datos lista (${config.host}:${config.port}/${config.database})`);
    } catch (err) {
        dbReady = false;
        console.error(`❌ MySQL (intento ${attempt}):`, err.message);
        setTimeout(() => connectWithRetry(attempt + 1), Math.min(5000 * attempt, 30000));
    }
}

// Envoltorio para rutas async: cualquier error responde JSON en vez de colgar la app
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
    console.error(`${req.method} ${req.originalUrl}:`, err.message);
    res.status(500).json({ error: err.message });
});

app.get('/api/health', (req, res) => res.json({ ok: true, db: dbReady }));

// --- RUTAS DE AUTENTICACIÓN ---
app.post('/api/login', wrap(async (req, res) => {
    const { email, password } = req.body;
    const [rows] = await db.query(
        'SELECT id, nombre, email, rol, telefono, vehiculo FROM usuarios WHERE email = ? AND password = ?',
        [String(email || '').trim(), password]);
    if (rows.length === 0) return res.status(401).json({ error: 'Credenciales incorrectas' });
    res.json({ user: rows[0] });
}));

app.post('/api/register', wrap(async (req, res) => {
    const { nombre, email, password, telefono } = req.body;
    try {
        const [r] = await db.query(
            'INSERT INTO usuarios (nombre, email, password, rol, telefono) VALUES (?, ?, ?, "cliente", ?)',
            [nombre, String(email).trim(), password, telefono]);
        res.json({ id: r.insertId, nombre, email, rol: 'cliente' });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El correo ya está registrado' });
        throw e;
    }
}));

// --- RUTAS DE PRODUCTOS Y RESTAURANTES ---
app.get('/api/productos', wrap(async (req, res) => {
    const [rows] = await db.query(`
        SELECT p.*, r.nombre AS restaurante_nombre, r.zona, r.latitud, r.longitud, r.tiempo_entrega, r.calificacion
        FROM productos p JOIN restaurantes r ON p.restaurante_id = r.id`);
    res.json(rows);
}));

app.post('/api/productos', wrap(async (req, res) => {
    const { restaurante_id, nombre, descripcion, precio, imagen_url } = req.body;
    const [r] = await db.query(
        'INSERT INTO productos (restaurante_id, nombre, descripcion, precio, imagen_url) VALUES (?, ?, ?, ?, ?)',
        [restaurante_id || 1, nombre, descripcion, precio, imagen_url]);
    res.json({ id: r.insertId, message: 'Producto agregado' });
}));

app.delete('/api/productos/:id', wrap(async (req, res) => {
    await db.query('DELETE FROM productos WHERE id = ?', [req.params.id]);
    res.json({ message: 'Producto eliminado' });
}));

app.get('/api/restaurantes', wrap(async (req, res) => {
    const [rows] = await db.query('SELECT id, nombre, zona FROM restaurantes ORDER BY nombre');
    res.json(rows);
}));

// --- FAVORITOS (me gusta) guardados en la base de datos ---
app.get('/api/favoritos/:usuario_id', wrap(async (req, res) => {
    const [rows] = await db.query('SELECT producto_id FROM favoritos WHERE usuario_id = ?', [req.params.usuario_id]);
    res.json(rows.map(r => r.producto_id));
}));

app.post('/api/favoritos', wrap(async (req, res) => {
    const { usuario_id, producto_id, activo } = req.body;
    if (!usuario_id || !producto_id) return res.status(400).json({ error: 'Datos incompletos' });
    if (activo) await db.query('INSERT IGNORE INTO favoritos (usuario_id, producto_id) VALUES (?, ?)', [usuario_id, producto_id]);
    else await db.query('DELETE FROM favoritos WHERE usuario_id = ? AND producto_id = ?', [usuario_id, producto_id]);
    res.json({ ok: true });
}));

// --- RUTAS DE ADMINISTRACIÓN (USUARIOS Y REPARTIDORES) ---
app.get('/api/usuarios', wrap(async (req, res) => {
    const [rows] = await db.query('SELECT id, nombre, email, rol, telefono, vehiculo, fecha_registro FROM usuarios');
    res.json(rows);
}));

app.post('/api/repartidores', wrap(async (req, res) => {
    const { nombre, email, password, telefono, vehiculo } = req.body;
    try {
        const [r] = await db.query(
            'INSERT INTO usuarios (nombre, email, password, rol, telefono, vehiculo) VALUES (?, ?, ?, "repartidor", ?, ?)',
            [nombre, email, password, telefono, vehiculo]);
        res.json({ id: r.insertId, message: 'Repartidor registrado' });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El correo ya está registrado' });
        throw e;
    }
}));

app.delete('/api/usuarios/:id', wrap(async (req, res) => {
    await db.query('DELETE FROM usuarios WHERE id = ? AND rol != "admin"', [req.params.id]);
    res.json({ message: 'Usuario eliminado' });
}));

// --- RUTAS DE PEDIDOS ---
app.post('/api/pedidos', wrap(async (req, res) => {
    const { cliente_id, direccion_entrega, lat_entrega, lng_entrega, metodo_pago, items, ref } = req.body;
    if (!cliente_id || !direccion_entrega || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Pedido incompleto' });
    }
    const conn = await db.getConnection();
    try {
        // Reintentos desde el modo offline: si ya existe ese pedido, no se duplica
        if (ref) {
            const [ex] = await conn.query('SELECT id FROM pedidos WHERE ref = ?', [ref]);
            if (ex.length) return res.json({ pedidoId: ex[0].id, message: 'Pedido ya registrado', duplicate: true });
        }
        // El precio se toma de la base de datos, no del teléfono
        const ids = items.map(i => Number(i.id));
        const [prods] = await conn.query('SELECT id, precio FROM productos WHERE id IN (?)', [ids]);
        const precios = new Map(prods.map(p => [p.id, Number(p.precio)]));
        let total = 0;
        const lineas = [];
        for (const it of items) {
            const precio = precios.get(Number(it.id));
            const cant = parseInt(it.cantidad, 10);
            if (precio === undefined || !(cant > 0)) return res.status(400).json({ error: 'Producto no disponible' });
            total += precio * cant;
            lineas.push([null, Number(it.id), cant, precio]);
        }
        total = Math.round(total * 100) / 100;
        const metodo = metodo_pago === 'Tarjeta' ? 'Tarjeta' : 'Efectivo';

        await conn.beginTransaction();
        const [r] = await conn.query(
            'INSERT INTO pedidos (cliente_id, direccion_entrega, lat_entrega, lng_entrega, total, metodo_pago, pago_estado, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [cliente_id, direccion_entrega, lat_entrega, lng_entrega, total, metodo,
             metodo === 'Tarjeta' ? 'pendiente' : 'contra_entrega', ref || null]);
        lineas.forEach(l => { l[0] = r.insertId; });
        await conn.query('INSERT INTO detalle_pedidos (pedido_id, producto_id, cantidad, precio_unitario) VALUES ?', [lineas]);
        await conn.commit();
        pagos.pedidoCreado(r.insertId, metodo, req); // efectivo: correo de confirmación al instante
        res.json({ pedidoId: r.insertId, total, metodo_pago: metodo, message: 'Pedido realizado con éxito' });
    } catch (e) {
        try { await conn.rollback(); } catch {}
        if (e.code === 'ER_DUP_ENTRY' && ref) {
            const [ex] = await db.query('SELECT id FROM pedidos WHERE ref = ?', [ref]);
            if (ex.length) return res.json({ pedidoId: ex[0].id, message: 'Pedido ya registrado', duplicate: true });
        }
        throw e;
    } finally {
        conn.release();
    }
}));

app.get('/api/pedidos', wrap(async (req, res) => {
    // Con ?cliente_id= el cliente ve TODOS sus pedidos (incluido "pago pendiente").
    // Admin y repartidor no ven pedidos con tarjeta que aún no se pagan.
    const cid = parseInt(req.query.cliente_id, 10);
    const where = cid ? 'WHERE p.cliente_id = ?' : "WHERE p.pago_estado NOT IN ('pendiente', 'rechazado')";
    const [rows] = await db.query(`
        SELECT p.*, u.nombre AS cliente_nombre, u.telefono AS cliente_telefono, r.nombre AS repartidor_nombre
        FROM pedidos p
        JOIN usuarios u ON p.cliente_id = u.id
        LEFT JOIN usuarios r ON p.repartidor_id = r.id
        ${where}
        ORDER BY p.fecha_pedido DESC`, cid ? [cid] : []);
    if (rows.length) {
        const [det] = await db.query(
            `SELECT d.pedido_id, d.cantidad, d.precio_unitario, pr.nombre
             FROM detalle_pedidos d JOIN productos pr ON pr.id = d.producto_id
             WHERE d.pedido_id IN (?)`, [rows.map(r => r.id)]);
        rows.forEach(r => { r.items = det.filter(d => d.pedido_id === r.id); });
    }
    res.json(rows);
}));

app.put('/api/pedidos/:id/estado', wrap(async (req, res) => {
    const { estado, repartidor_id } = req.body;
    if (!['pendiente', 'preparando', 'en_camino', 'entregado'].includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }
    await db.query('UPDATE pedidos SET estado = ?, repartidor_id = COALESCE(?, repartidor_id) WHERE id = ?',
        [estado, repartidor_id, req.params.id]);
    res.json({ message: 'Estado del pedido actualizado' });
}));

// --- PAGOS (Mercado Pago) Y CORREOS DE CONFIRMACIÓN: ver payments.js ---
const pagos = require('./payments')(app, db, wrap);

// Cualquier ruta /api desconocida responde JSON (no HTML)
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 LOS BUGS DELIVERY en http://localhost:${PORT}`);
    connectWithRetry();
});
