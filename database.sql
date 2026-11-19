CREATE DATABASE IF NOT EXISTS fastbite_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fastbite_db;

-- NOTA: server.js crea todo esto solo al iniciar; este archivo es de referencia.
-- 1. Tabla de Usuarios (Roles: 'cliente', 'admin', 'repartidor')
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    rol ENUM('cliente', 'admin', 'repartidor') NOT NULL DEFAULT 'cliente',
    telefono VARCHAR(20),
    vehiculo VARCHAR(50) NULL, -- Solo para repartidores
    estado_repartidor ENUM('disponible', 'ocupado', 'desconectado') DEFAULT 'disponible',
    fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tabla de Restaurantes / Locales con Coordenadas para Geolocalización
CREATE TABLE IF NOT EXISTS restaurantes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    categoria VARCHAR(50) NOT NULL,
    zona VARCHAR(100) NOT NULL,
    latitud DECIMAL(10, 8) NOT NULL,
    longitud DECIMAL(11, 8) NOT NULL,
    tiempo_entrega VARCHAR(30) DEFAULT '20-35 min',
    calificacion DECIMAL(2,1) DEFAULT 4.8,
    imagen_url VARCHAR(255)
);

-- 3. Tabla de Productos
CREATE TABLE IF NOT EXISTS productos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    restaurante_id INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    precio DECIMAL(10, 2) NOT NULL,
    imagen_url VARCHAR(255),
    FOREIGN KEY (restaurante_id) REFERENCES restaurantes(id) ON DELETE CASCADE
);

-- 4. Tabla de "Me Gusta" (Favoritos por usuario)
CREATE TABLE IF NOT EXISTS favoritos (
    usuario_id INT NOT NULL,
    producto_id INT NOT NULL,
    PRIMARY KEY (usuario_id, producto_id),
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
);

-- 5. Tabla de Pedidos
CREATE TABLE IF NOT EXISTS pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cliente_id INT NOT NULL,
    repartidor_id INT NULL,
    direccion_entrega VARCHAR(255) NOT NULL,
    lat_entrega DECIMAL(10, 8),
    lng_entrega DECIMAL(11, 8),
    total DECIMAL(10, 2) NOT NULL,
    metodo_pago VARCHAR(50) DEFAULT 'Efectivo',
    estado ENUM('pendiente', 'preparando', 'en_camino', 'entregado') DEFAULT 'pendiente',
    ref VARCHAR(40) NULL UNIQUE, -- evita pedidos duplicados al reenviar desde el modo offline
    fecha_pedido TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cliente_id) REFERENCES usuarios(id),
    FOREIGN KEY (repartidor_id) REFERENCES usuarios(id)
);

-- 6. Detalle de los productos en cada pedido
CREATE TABLE IF NOT EXISTS detalle_pedidos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_id INT NOT NULL,
    producto_id INT NOT NULL,
    cantidad INT NOT NULL,
    precio_unitario DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE,
    FOREIGN KEY (producto_id) REFERENCES productos(id)
);

-- =========================================================
-- DATOS INICIALES (CUENTAS LISTAS PARA USAR)
-- =========================================================

-- Cuentas de acceso:
-- ADMIN:      admin@fastbite.com      / admin123
-- REPARTIDOR: repartidor@fastbite.com / repa123
-- CLIENTE:    cliente@fastbite.com    / cliente123

INSERT INTO usuarios (nombre, email, password, rol, telefono, vehiculo) VALUES
('Administrador General', 'admin@fastbite.com', 'admin123', 'admin', '5511223344', NULL),
('Carlos Mendoza (Moto)', 'repartidor@fastbite.com', 'repa123', 'repartidor', '5599887766', 'Motocicleta Italika 150cc'),
('Sofía Ramírez', 'cliente@fastbite.com', 'cliente123', 'cliente', '5544332211', NULL);

-- Restaurantes de ejemplo (Coordenadas zona centro/norte Estado de México / CDMX)
INSERT INTO restaurantes (nombre, categoria, zona, latitud, longitud, tiempo_entrega, calificacion, imagen_url) VALUES
('Burger Kingz Grill', 'Hamburguesas', 'Zona Centro', 19.635000, -99.310000, '20-30 min', 4.9, 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=500'),
('Tacos El Patrón', 'Mexicana', 'Zona Norte', 19.640000, -99.305000, '15-25 min', 4.8, 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=500'),
('Napoli Express Pizza', 'Pizzas', 'Zona Centro', 19.632000, -99.312000, '25-40 min', 4.7, 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=500');

-- Productos iniciales
INSERT INTO productos (restaurante_id, nombre, descripcion, precio, imagen_url) VALUES
(1, 'Doble Queso Tocino XL', 'Doble carne res a la parrilla, queso cheddar fundido, tocino crujiente y papas.', 145.00, 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400'),
(1, 'Combo Crispy Chicken', 'Pechuga empanizada extra crujiente, aderezo chipotle y refresco 600ml.', 125.00, 'https://images.unsplash.com/photo-1626082927389-6cd097cdc6ec?w=400'),
(2, 'Orden 5 Tacos al Pastor', 'Con piña, cilantro, cebolla, salsa verde cruda y limones.', 85.00, 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=400'),
(3, 'Pizza Pepperoni Suprema', 'Pizza grande de 8 rebanadas con doble pepperoni y orilla rellena de queso.', 189.00, 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400');