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

    const [[{ n: nUsers }]] = await db.query('SELECT COUNT(*) AS n FROM usuarios');
    if (nUsers === 0) {
        await db.query(`INSERT INTO usuarios (nombre, email, password, rol, telefono, vehiculo) VALUES
            ('Administrador General', 'admin@fastbite.com', 'admin123', 'admin', '5511223344', NULL),
            ('Carlos Mendoza (Moto)', 'repartidor@fastbite.com', 'repa123', 'repartidor', '5599887766', 'Motocicleta Italika 150cc'),
            ('Sofía Ramírez', 'cliente@fastbite.com', 'cliente123', 'cliente', '5544332211', NULL)`);
    }
    const [[{ n: nRest }]] = await db.query('SELECT COUNT(*) AS n FROM restaurantes');
    if (nRest === 0) {
        await db.query(`INSERT INTO restaurantes (nombre, categoria, zona, latitud, longitud, tiempo_entrega, calificacion, imagen_url) VALUES
            ('Burger Kingz Grill', 'Hamburguesas', 'Zona Centro', 19.635000, -99.310000, '20-30 min', 4.9, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500'),
            ('Tacos El Patrón', 'Mexicana', 'Zona Norte', 19.640000, -99.305000, '15-25 min', 4.8, 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=500'),
            ('Napoli Express Pizza', 'Pizzas', 'Zona Centro', 19.632000, -99.312000, '25-40 min', 4.7, 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500')`);
        await db.query(`INSERT INTO productos (restaurante_id, nombre, descripcion, precio, imagen_url) VALUES
            (1, 'Doble Queso Tocino XL', 'Doble carne res a la parrilla, queso cheddar fundido, tocino crujiente y papas.', 145.00, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400'),
            (1, 'Combo Crispy Chicken', 'Pechuga empanizada extra crujiente, aderezo chipotle y refresco 600ml.', 125.00, 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=400'),
            (2, 'Orden 5 Tacos al Pastor', 'Con piña, cilantro, cebolla, salsa verde cruda y limones.', 85.00, 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=400'),
            (3, 'Pizza Pepperoni Suprema', 'Pizza grande de 8 rebanadas con doble pepperoni y orilla rellena de queso.', 189.00, 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400')`);
    }
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

        await conn.beginTransaction();
        const [r] = await conn.query(
            'INSERT INTO pedidos (cliente_id, direccion_entrega, lat_entrega, lng_entrega, total, metodo_pago, ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [cliente_id, direccion_entrega, lat_entrega, lng_entrega, total, metodo_pago || 'Efectivo', ref || null]);
        lineas.forEach(l => { l[0] = r.insertId; });
        await conn.query('INSERT INTO detalle_pedidos (pedido_id, producto_id, cantidad, precio_unitario) VALUES ?', [lineas]);
        await conn.commit();
        res.json({ pedidoId: r.insertId, total, message: 'Pedido realizado con éxito' });
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
    const [rows] = await db.query(`
        SELECT p.*, u.nombre AS cliente_nombre, u.telefono AS cliente_telefono, r.nombre AS repartidor_nombre
        FROM pedidos p
        JOIN usuarios u ON p.cliente_id = u.id
        LEFT JOIN usuarios r ON p.repartidor_id = r.id
        ORDER BY p.fecha_pedido DESC`);
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

// Cualquier ruta /api desconocida responde JSON (no HTML)
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 LOS BUGS DELIVERY en http://localhost:${PORT}`);
    connectWithRetry();
});
