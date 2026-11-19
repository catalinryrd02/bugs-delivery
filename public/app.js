const API_URL = '/api';

// Datos iniciales de respaldo por si aún no se enciende server.js
const DEFAULT_PRODUCTS = [
    { id: 1, restaurante_nombre: 'Burger Kingz Grill', zona: 'Zona Centro', latitud: 19.635, longitud: -99.310, nombre: 'Doble Queso Tocino XL', descripcion: 'Doble carne res a la parrilla, cheddar y papas.', precio: 145.00, imagen_url: 'https://images.unsplash.com/photo-1553979459-d2229ba7433b?w=400' },
    { id: 2, restaurante_nombre: 'Tacos El Patrón', zona: 'Zona Norte', latitud: 19.640, longitud: -99.305, nombre: 'Orden 5 Tacos al Pastor', descripcion: 'Con piña, cilantro, cebolla y salsa verde.', precio: 85.00, imagen_url: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?w=400' },
    { id: 3, restaurante_nombre: 'Napoli Express Pizza', zona: 'Zona Centro', latitud: 19.632, longitud: -99.312, nombre: 'Pizza Pepperoni Suprema', descripcion: '8 rebanadas con doble pepperoni y queso.', precio: 189.00, imagen_url: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400' }
];

let productosGlobal = [];
let carrito = JSON.parse(localStorage.getItem('fb_cart')) || [];
let favoritos = JSON.parse(localStorage.getItem('fb_favs')) || [];
let soloFavoritos = false;
let userCoords = { lat: 19.635, lng: -99.310 };
let clientMap, driverMap;

// ==========================================
// 1. AUTENTICACIÓN Y SESIÓN
// ==========================================
function switchAuthTab(tab) {
    document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
    document.getElementById('tabRegister').classList.toggle('active', tab === 'register');
    document.getElementById('loginForm').style.display = tab === 'login' ? 'block' : 'none';
    document.getElementById('registerForm').style.display = tab === 'register' ? 'block' : 'none';
}

const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        try {
            const res = await fetch(`${API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (!res.ok) return alert(data.error);
            iniciarSesionExito(data.user);
        } catch (err) {
            // Respaldo demo si Node.js no está iniciado
            if (email === 'admin@fastbite.com' && password === 'admin123') {
                iniciarSesionExito({ id: 1, nombre: 'Administrador General', email, rol: 'admin' });
            } else if (email === 'repartidor@fastbite.com' && password === 'repa123') {
                iniciarSesionExito({ id: 2, nombre: 'Carlos Mendoza', email, rol: 'repartidor' });
            } else if (email === 'cliente@fastbite.com' && password === 'cliente123') {
                iniciarSesionExito({ id: 3, nombre: 'Sofía Ramírez', email, rol: 'cliente' });
            } else {
                alert('Credenciales inválidas o servidor Node.js apagado.');
            }
        }
    });
}

const registerForm = document.getElementById('registerForm');
if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            nombre: document.getElementById('regNombre').value,
            telefono: document.getElementById('regTelefono').value,
            email: document.getElementById('regEmail').value,
            password: document.getElementById('regPassword').value
        };
        try {
            const res = await fetch(`${API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (!res.ok) return alert(data.error);
            alert('¡Cuenta creada con éxito!');
            iniciarSesionExito(data);
        } catch (err) {
            alert('Enciende el servidor Node.js (node server.js) para registrar en MySQL.');
        }
    });
}

function iniciarSesionExito(user) {
    localStorage.setItem('fb_user', JSON.stringify(user));
    if (user.rol === 'admin') window.location.href = 'admin.html';
    else if (user.rol === 'repartidor') window.location.href = 'repartidor.html';
    else window.location.href = 'cliente.html';
}

function verificarSesion(rolRequerido) {
    const user = JSON.parse(localStorage.getItem('fb_user'));
    if (!user || user.rol !== rolRequerido) {
        window.location.href = 'index.html';
        return null;
    }
    const welcomeEl = document.getElementById('welcomeUser');
    if (welcomeEl) welcomeEl.textContent = `👋 Bienvenido, ${user.nombre}`;
    return user;
}

function logout() {
    localStorage.removeItem('fb_user');
    window.location.href = 'index.html';
}

// ==========================================
// 2. VISTA DEL CLIENTE (UBICACIÓN, LIKES, CARRITO)
// ==========================================
async function initCliente() {
    verificarSesion('cliente');
    await cargarProductos();
    actualizarUIcarrito();
    detectarUbicacionGPS();
    cargarPedidosCliente();
}

async function cargarProductos() {
    try {
        const res = await fetch(`${API_URL}/productos`);
        productosGlobal = await res.json();
    } catch {
        productosGlobal = DEFAULT_PRODUCTS;
    }
    renderProductos(productosGlobal);
}

function detectarUbicacionGPS() {
    const zoneText = document.getElementById('currentZoneText');
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                // Determinar zona según latitud aproximada
                const zonaDetectada = userCoords.lat > 19.638 ? 'Zona Norte' : 'Zona Centro';
                zoneText.textContent = `${zonaDetectada} (${userCoords.lat.toFixed(4)}, ${userCoords.lng.toFixed(4)})`;
                document.getElementById('zoneSelector').value = zonaDetectada;
                filtrarPorZona(zonaDetectada);
                if (clientMap) clientMap.setView([userCoords.lat, userCoords.lng], 14);
            },
            () => {
                zoneText.textContent = 'Zona Centro (Ubicación por defecto)';
            }
        );
    }
}

function filtrarPorZona(zona) {
    let filtrados = productosGlobal;
    if (zona !== 'Todas') {
        filtrados = filtrados.filter(p => p.zona === zona);
    }
    if (soloFavoritos) {
        filtrados = filtrados.filter(p => favoritos.includes(p.id));
    }
    renderProductos(filtrados);
}

function toggleFavoritosFilter() {
    soloFavoritos = !soloFavoritos;
    filtrarPorZona(document.getElementById('zoneSelector').value);
}

function toggleLike(id) {
    if (favoritos.includes(id)) {
        favoritos = favoritos.filter(f => f !== id);
    } else {
        favoritos.push(id);
    }
    localStorage.setItem('fb_favs', JSON.stringify(favoritos));
    document.getElementById('favCount').textContent = favoritos.length;
    filtrarPorZona(document.getElementById('zoneSelector').value);
}

function renderProductos(lista) {
    document.getElementById('favCount').textContent = favoritos.length;
    const grid = document.getElementById('productosGrid');
    if (lista.length === 0) {
        grid.innerHTML = '<p>No hay platillos disponibles en esta zona o filtro.</p>';
        return;
    }
    grid.innerHTML = lista.map(p => {
        const isLiked = favoritos.includes(p.id);
        return `
        <div class="card">
            <img src="${p.imagen_url}" class="card-img" alt="${p.nombre}">
            <button class="like-btn ${isLiked ? 'liked' : ''}" onclick="toggleLike(${p.id})">
                ${isLiked ? '❤️' : '🤍'}
            </button>
            <div class="card-body">
                <span class="badge">🏪 ${p.restaurante_nombre} • 📍 ${p.zona}</span>
                <h3 class="card-title">${p.nombre}</h3>
                <p class="card-desc">${p.descripcion}</p>
                <div class="card-footer">
                    <span class="price">$${Number(p.precio).toFixed(2)}</span>
                    <button class="btn btn-primary" onclick="agregarAlCarrito(${p.id})">+ Agregar</button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function agregarAlCarrito(id) {
    const prod = productosGlobal.find(p => p.id === id);
    const existe = carrito.find(item => item.id === id);
    if (existe) existe.cantidad++;
    else carrito.push({ ...prod, cantidad: 1 });
    
    localStorage.setItem('fb_cart', JSON.stringify(carrito));
    actualizarUIcarrito();
}

function actualizarUIcarrito() {
    const count = carrito.reduce((acc, item) => acc + item.cantidad, 0);
    const total = carrito.reduce((acc, item) => acc + (item.precio * item.cantidad), 0);
    document.getElementById('cartCount').textContent = count;
    document.getElementById('cartTotal').textContent = total.toFixed(2);

    const list = document.getElementById('cartItemsList');
    list.innerHTML = carrito.map((item, idx) => `
        <div class="cart-item">
            <div>
                <strong>${item.nombre}</strong><br>
                <small>$${item.precio} x ${item.cantidad}</small>
            </div>
            <div>
                <button class="btn btn-outline" onclick="cambiarCantidad(${idx}, -1)">-</button>
                <button class="btn btn-outline" onclick="cambiarCantidad(${idx}, 1)">+</button>
            </div>
        </div>
    `).join('');
}

function cambiarCantidad(idx, delta) {
    carrito[idx].cantidad += delta;
    if (carrito[idx].cantidad <= 0) carrito.splice(idx, 1);
    localStorage.setItem('fb_cart', JSON.stringify(carrito));
    actualizarUIcarrito();
}

function toggleCart() {
    document.getElementById('cartDrawer').classList.toggle('open');
}

async function realizarPedido() {
    if (carrito.length === 0) return alert('Tu carrito está vacío');
    const direccion = document.getElementById('deliveryAddress').value;
    if (!direccion) return alert('Ingresa tu dirección de entrega');

    const user = JSON.parse(localStorage.getItem('fb_user'));
    const total = carrito.reduce((acc, item) => acc + (item.precio * item.cantidad), 0);

    const payload = {
        cliente_id: user.id,
        direccion_entrega: direccion,
        lat_entrega: userCoords.lat,
        lng_entrega: userCoords.lng,
        total,
        metodo_pago: document.getElementById('paymentMethod').value,
        items: carrito
    };

    try {
        await fetch(`${API_URL}/pedidos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        alert('🎉 ¡Pedido confirmado! Un repartidor lo tomará en breve.');
        carrito = [];
        localStorage.setItem('fb_cart', '[]');
        actualizarUIcarrito();
        toggleCart();
        cargarPedidosCliente();
    } catch {
        alert('Enciende server.js para guardar el pedido en MySQL.');
    }
}

async function cargarPedidosCliente() {
    const user = JSON.parse(localStorage.getItem('fb_user'));
    try {
        const res = await fetch(`${API_URL}/pedidos`);
        const pedidos = await res.json();
        const mios = pedidos.filter(p => p.cliente_id === user.id);
        document.getElementById('misPedidosTable').innerHTML = mios.map(p => `
            <tr>
                <td>#${p.id}</td>
                <td>${p.direccion_entrega}</td>
                <td>$${Number(p.total).toFixed(2)}</td>
                <td>${p.repartidor_nombre || 'Asignando...'}</td>
                <td><span class="status-pill status-${p.estado}">${p.estado.replace('_', ' ')}</span></td>
            </tr>
        `).join('');
    } catch {}
}

// ==========================================
// 3. PANEL DE ADMINISTRACIÓN
// ==========================================
async function initAdmin() {
    verificarSesion('admin');
    cargarTablaAdminProductos();
    cargarTablaAdminUsuarios();
}

async function cargarTablaAdminProductos() {
    const res = await fetch(`${API_URL}/productos`);
    const productos = await res.json();
    document.getElementById('adminProductosTable').innerHTML = productos.map(p => `
        <tr>
            <td>${p.id}</td>
            <td>${p.nombre}</td>
            <td>${p.restaurante_nombre} (${p.zona})</td>
            <td>$${Number(p.precio).toFixed(2)}</td>
            <td><button class="btn btn-danger" onclick="eliminarProducto(${p.id})">Eliminar</button></td>
        </tr>
    `).join('');
}

const addProdForm = document.getElementById('addProductForm');
if (addProdForm) {
    addProdForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            restaurante_id: document.getElementById('prodRestaurante').value,
            nombre: document.getElementById('prodNombre').value,
            descripcion: document.getElementById('prodDesc').value,
            precio: document.getElementById('prodPrecio').value,
            imagen_url: document.getElementById('prodImg').value
        };
        await fetch(`${API_URL}/productos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        addProdForm.reset();
        cargarTablaAdminProductos();
    });
}

async function eliminarProducto(id) {
    if (!confirm('¿Eliminar este producto del menú?')) return;
    await fetch(`${API_URL}/productos/${id}`, { method: 'DELETE' });
    cargarTablaAdminProductos();
}

async function cargarTablaAdminUsuarios() {
    const res = await fetch(`${API_URL}/usuarios`);
    const usuarios = await res.json();
    document.getElementById('adminUsuariosTable').innerHTML = usuarios.map(u => `
        <tr>
            <td>${u.id}</td>
            <td>${u.nombre}</td>
            <td>${u.email}</td>
            <td><strong>${u.rol.toUpperCase()}</strong></td>
            <td>${u.telefono || ''} ${u.vehiculo ? '• 🛵 ' + u.vehiculo : ''}</td>
            <td>
                ${u.rol !== 'admin' ? `<button class="btn btn-danger" onclick="eliminarUsuario(${u.id})">Eliminar</button>` : 'Protegido'}
            </td>
        </tr>
    `).join('');
}

const addRepForm = document.getElementById('addRepartidorForm');
if (addRepForm) {
    addRepForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const payload = {
            nombre: document.getElementById('repNombre').value,
            email: document.getElementById('repEmail').value,
            password: document.getElementById('repPass').value,
            telefono: document.getElementById('repTel').value,
            vehiculo: document.getElementById('repVehiculo').value
        };
        await fetch(`${API_URL}/repartidores`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        addRepForm.reset();
        cargarTablaAdminUsuarios();
    });
}

async function eliminarUsuario(id) {
    if (!confirm('¿Eliminar este usuario/repartidor?')) return;
    await fetch(`${API_URL}/usuarios/${id}`, { method: 'DELETE' });
    cargarTablaAdminUsuarios();
}

// ==========================================
// 4. PANEL DE REPARTIDOR
// ==========================================
async function initRepartidor() {
    verificarSesion('repartidor');
    cargarPedidosRepartidor();
}

async function cargarPedidosRepartidor() {
    const res = await fetch(`${API_URL}/pedidos`);
    const pedidos = await res.json();
    document.getElementById('driverPedidosTable').innerHTML = pedidos.map(p => `
        <tr>
            <td>#${p.id}</td>
            <td>${p.cliente_nombre}<br><small>📞 ${p.cliente_telefono || 'Sin tel'}</small></td>
            <td>${p.direccion_entrega}</td>
            <td>$${Number(p.total).toFixed(2)} (${p.metodo_pago})</td>
            <td><span class="status-pill status-${p.estado}">${p.estado.replace('_', ' ')}</span></td>
            <td>
                <button class="btn btn-outline" onclick="verEnMapa(${p.lat_entrega || 19.635}, ${p.lng_entrega || -99.310}, '${p.direccion_entrega}')">📍 Ver Mapa</button>
                ${p.estado === 'pendiente' ? `<button class="btn btn-primary" onclick="cambiarEstadoPedido(${p.id}, 'en_camino')">🛵 Aceptar Entrega</button>` : ''}
                ${p.estado === 'en_camino' ? `<button class="btn btn-dark" onclick="cambiarEstadoPedido(${p.id}, 'entregado')">✅ Marcar Entregado</button>` : ''}
            </td>
        </tr>
    `).join('');
}

async function cambiarEstadoPedido(pedidoId, nuevoEstado) {
    const driver = JSON.parse(localStorage.getItem('fb_user'));
    await fetch(`${API_URL}/pedidos/${pedidoId}/estado`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: nuevoEstado, repartidor_id: driver.id })
    });
    cargarPedidosRepartidor();
}

// ==========================================
// 5. MAPA INTERACTIVO (LEAFLET / OPENSTREETMAP)
// ==========================================
function initMapCliente() {
    const el = document.getElementById('clientMap');
    if (!el || typeof L === 'undefined') return;

    clientMap = L.map('clientMap').setView([userCoords.lat, userCoords.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(clientMap);

    L.marker([userCoords.lat, userCoords.lng]).addTo(clientMap)
        .bindPopup('📍 Tu ubicación actual').openPopup();
}

function initMapDriver() {
    const el = document.getElementById('driverMap');
    if (!el || typeof L === 'undefined') return;

    driverMap = L.map('driverMap').setView([userCoords.lat, userCoords.lng], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(driverMap);
}

function verEnMapa(lat, lng, direccion) {
    if (driverMap) {
        driverMap.setView([Number(lat), Number(lng)], 16);
        L.marker([Number(lat), Number(lng)]).addTo(driverMap)
            .bindPopup(`📦 Entregar en: ${direccion}`).openPopup();
    }
}

// Iniciar los mapas automáticamente al cargar la página
window.addEventListener('DOMContentLoaded', () => {
    initMapCliente();
    initMapDriver();
});