import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import 'api.dart';
import 'tema.dart';
import 'main.dart' show irAInicio;

class LineaCarrito {
  final Map<String, dynamic> producto;
  int cantidad;
  LineaCarrito(this.producto, this.cantidad);
}

/// Carrito compartido por todas las pantallas del cliente.
class Carrito extends ChangeNotifier {
  final Map<int, LineaCarrito> lineas = {};
  int get cuenta => lineas.values.fold(0, (s, l) => s + l.cantidad);
  double get total => lineas.values.fold(0.0, (s, l) => s + numero(l.producto['precio']) * l.cantidad);
  void agregar(Map<String, dynamic> p) {
    final id = numero(p['id']).toInt();
    lineas.update(id, (l) => l..cantidad += 1, ifAbsent: () => LineaCarrito(p, 1));
    notifyListeners();
  }
  void quitar(int id) {
    final l = lineas[id];
    if (l == null) return;
    if (l.cantidad <= 1) { lineas.remove(id); } else { l.cantidad -= 1; }
    notifyListeners();
  }
  void vaciar() { lineas.clear(); notifyListeners(); }
}

class ClientePantalla extends StatefulWidget {
  const ClientePantalla({super.key});
  @override
  State<ClientePantalla> createState() => _EstadoCliente();
}

class _EstadoCliente extends State<ClientePantalla> {
  final carrito = Carrito();
  int _tab = 0;
  List<Map<String, dynamic>> productos = [];
  Set<int> favs = {};
  bool cargando = true;
  String? error;
  bool soloFavs = false;

  @override
  void initState() {
    super.initState();
    carrito.addListener(() => setState(() {}));
    _cargar();
  }

  Future<void> _cargar() async {
    setState(() { cargando = true; error = null; });
    try {
      final r = await Future.wait([Api.productos(), Api.favoritos()]);
      productos = r[0] as List<Map<String, dynamic>>;
      favs = r[1] as Set<int>;
    } catch (e) {
      error = '$e';
    }
    if (mounted) setState(() => cargando = false);
  }

  Future<void> _toggleFav(int id) async {
    final on = !favs.contains(id);
    setState(() => on ? favs.add(id) : favs.remove(id));
    try { await Api.setFavorito(id, on); } catch (e) { if (mounted) aviso(context, '$e'); }
  }

  @override
  Widget build(BuildContext context) {
    final paginas = <Widget>[
      InicioVista(productos: productos, favs: favs, cargando: cargando, error: error, soloFavs: soloFavs,
          alRefrescar: _cargar, alFav: _toggleFav, carrito: carrito),
      CarritoVista(carrito: carrito, alTerminar: () => setState(() => _tab = 2), alExplorar: () => setState(() => _tab = 0)),
      PedidosVista(activa: _tab == 2),
      PerfilVista(favoritos: favs.length),
    ];
    return Scaffold(
      appBar: AppBar(
        titleSpacing: 14,
        title: Row(children: [
          Image.asset('assets/logo.png', width: 38, height: 38),
          const SizedBox(width: 10),
          const Text('LOS BUGS', style: TextStyle(fontWeight: FontWeight.w300, letterSpacing: 1.5, color: C.vino)),
        ]),
      ),
      body: Column(children: [const BannerConexion(), Expanded(child: IndexedStack(index: _tab, children: paginas))]),
      bottomNavigationBar: PildoraNav(
        actual: _tab == 0 && soloFavs ? 1 : (_tab == 0 ? 0 : _tab + 1),
        items: [
          (icono: Icons.home_outlined, texto: 'Inicio', insignia: 0),
          (icono: Icons.favorite_border, texto: 'Favoritos', insignia: favs.length),
          (icono: Icons.shopping_cart_outlined, texto: 'Carrito', insignia: carrito.cuenta),
          (icono: Icons.inventory_2_outlined, texto: 'Pedidos', insignia: 0),
          (icono: Icons.person_outline, texto: 'Perfil', insignia: 0),
        ],
        alElegir: (i) => setState(() {
          if (i == 0) { _tab = 0; soloFavs = false; }
          else if (i == 1) { soloFavs = _tab != 0 ? true : !soloFavs; _tab = 0; }
          else { _tab = i - 1; }
        }),
      ),
    );
  }
}

// ---------------------------------------------------------------- INICIO
class InicioVista extends StatefulWidget {
  final List<Map<String, dynamic>> productos;
  final Set<int> favs;
  final bool cargando, soloFavs;
  final String? error;
  final Future<void> Function() alRefrescar;
  final void Function(int) alFav;
  final Carrito carrito;
  const InicioVista({super.key, required this.productos, required this.favs, required this.cargando, required this.error,
      required this.soloFavs, required this.alRefrescar, required this.alFav, required this.carrito});
  @override
  State<InicioVista> createState() => _EstadoInicio();
}

class _EstadoInicio extends State<InicioVista> {
  String busqueda = '';
  String? restaurante;

  @override
  Widget build(BuildContext context) {
    if (widget.cargando) return const Center(child: CircularProgressIndicator(color: C.vino));
    if (widget.error != null) {
      return Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        Text(widget.error!, textAlign: TextAlign.center),
        const SizedBox(height: 12),
        FilledButton(onPressed: widget.alRefrescar, child: const Text('Reintentar')),
      ])));
    }
    final nombres = widget.productos.map((p) => '${p['restaurante_nombre']}').toSet().toList()..sort();
    final lista = widget.productos.where((p) {
      final q = busqueda.toLowerCase();
      final okQ = q.isEmpty || '${p['nombre']} ${p['restaurante_nombre']} ${p['descripcion']}'.toLowerCase().contains(q);
      final okR = restaurante == null || p['restaurante_nombre'] == restaurante;
      final okF = !widget.soloFavs || widget.favs.contains(numero(p['id']).toInt());
      return okQ && okR && okF;
    }).toList();

    return RefreshIndicator(
      color: C.vino,
      onRefresh: widget.alRefrescar,
      child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(26),
            gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [C.vino, C.ciruela]),
          ),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('Hola, ${Api.usuario!.nombre.split(' ').first} 👋', style: const TextStyle(color: C.rosaClaro, fontSize: 15)),
            const SizedBox(height: 4),
            const Text('¿Qué se te antoja hoy?', style: TextStyle(color: Colors.white, fontSize: 26, fontWeight: FontWeight.w800)),
            const SizedBox(height: 12),
            const Wrap(spacing: 8, runSpacing: 8, children: [
              _Perk('🛵 Entrega rápida'), _Perk('💳 Pago seguro'),
            ]),
          ]),
        ),
        const SizedBox(height: 16),
        MapaRestaurantes(productos: widget.productos, alElegir: (n) => setState(() => restaurante = n)),
        const SizedBox(height: 16),
        TextField(
          onChanged: (v) => setState(() => busqueda = v),
          decoration: const InputDecoration(hintText: 'Busca un platillo o restaurante', prefixIcon: Icon(Icons.search)),
        ),
        const SizedBox(height: 12),
        SizedBox(height: 40, child: ListView(scrollDirection: Axis.horizontal, children: [
          _Chip('Todos', restaurante == null, () => setState(() => restaurante = null)),
          for (final n in nombres) _Chip(n, restaurante == n, () => setState(() => restaurante = n)),
        ])),
        const SizedBox(height: 16),
        Text(widget.soloFavs ? '❤️ Tus favoritos' : '🍔 Restaurantes y platillos',
            style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800, color: C.ciruela)),
        const SizedBox(height: 10),
        if (lista.isEmpty)
          const Padding(padding: EdgeInsets.all(24), child: Center(child: Text('No encontramos platillos con ese filtro.', style: TextStyle(color: C.suave)))),
        for (var i = 0; i < lista.length; i++)
          Entrada(indice: i, child: TarjetaPlatillo(p: lista[i], esFav: widget.favs.contains(numero(lista[i]['id']).toInt()), alFav: widget.alFav, carrito: widget.carrito)),
      ]),
    );
  }
}

class _Perk extends StatelessWidget {
  final String t;
  const _Perk(this.t);
  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(color: Colors.white.withOpacity(.14), borderRadius: BorderRadius.circular(999)),
        child: Text(t, style: const TextStyle(color: Colors.white, fontSize: 12.5)),
      );
}

class _Chip extends StatelessWidget {
  final String t;
  final bool on;
  final VoidCallback tap;
  const _Chip(this.t, this.on, this.tap);
  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(right: 8),
        child: GestureDetector(
          onTap: tap,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: on ? C.vino : Colors.white, borderRadius: BorderRadius.circular(999),
              border: Border.all(color: on ? C.vino : C.rosaClaro),
            ),
            child: Text(t, style: TextStyle(color: on ? Colors.white : C.ciruela, fontWeight: FontWeight.w600)),
          ),
        ),
      );
}

class MapaRestaurantes extends StatelessWidget {
  final List<Map<String, dynamic>> productos;
  final void Function(String) alElegir;
  const MapaRestaurantes({super.key, required this.productos, required this.alElegir});

  @override
  Widget build(BuildContext context) {
    final vistos = <String>{};
    final marcas = <Marker>[];
    for (final p in productos) {
      final n = '${p['restaurante_nombre']}';
      final lat = numero(p['latitud']).toDouble(), lng = numero(p['longitud']).toDouble();
      if (lat == 0 || lng == 0 || !vistos.add(n)) continue;
      marcas.add(Marker(
        point: LatLng(lat, lng), width: 44, height: 44,
        child: GestureDetector(
          onTap: () { alElegir(n); aviso(context, '🍽️ $n'); },
          child: Container(
            decoration: BoxDecoration(
              shape: BoxShape.circle, color: C.vino, border: Border.all(color: Colors.white, width: 3),
              boxShadow: [BoxShadow(color: C.vino.withOpacity(.4), blurRadius: 8)],
            ),
            child: const Icon(Icons.restaurant, color: Colors.white, size: 20),
          ),
        ),
      ));
    }
    final centro = marcas.isEmpty ? const LatLng(19.4326, -99.1332) : marcas.first.point;
    return ClipRRect(
      borderRadius: BorderRadius.circular(26),
      child: SizedBox(
        height: 240,
        child: Stack(children: [
          FlutterMap(
            options: MapOptions(initialCenter: centro, initialZoom: 12.5, backgroundColor: C.tinte),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.losbugs.delivery',
                errorTileCallback: (_, __, ___) {}, // sin internet: se ve el fondo rosado con los marcadores
                // Tinte rosado del mapa en la paleta de la marca
                tileBuilder: (context, tile, _) => ColorFiltered(
                  colorFilter: ColorFilter.mode(C.rosa.withOpacity(.28), BlendMode.softLight),
                  child: tile,
                ),
              ),
              MarkerLayer(markers: marcas),
            ],
          ),
          Positioned(top: 12, left: 12, child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 7),
            decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(999)),
            child: Text('🍽️ ${marcas.length} restaurantes cerca de ti', style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 12.5)),
          )),
        ]),
      ),
    );
  }
}

class TarjetaPlatillo extends StatelessWidget {
  final Map<String, dynamic> p;
  final bool esFav;
  final void Function(int) alFav;
  final Carrito carrito;
  const TarjetaPlatillo({super.key, required this.p, required this.esFav, required this.alFav, required this.carrito});

  @override
  Widget build(BuildContext context) {
    final id = numero(p['id']).toInt();
    final img = '${p['imagen_url'] ?? ''}';
    String url = img;
    if (img.startsWith('/')) url = '$baseUrl$img';
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Stack(children: [
            SizedBox(
              height: 150, width: double.infinity,
              child: url.isEmpty
                  ? Container(color: C.tinte, child: const Center(child: Text('🍽️', style: TextStyle(fontSize: 44))))
                  : Image.network(url, fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => Container(color: C.tinte, child: const Center(child: Text('🍽️', style: TextStyle(fontSize: 44))))),
            ),
            Positioned(top: 10, right: 10, child: GestureDetector(
              onTap: () => alFav(id),
              child: CircleAvatar(backgroundColor: Colors.white, radius: 19,
                  child: Icon(esFav ? Icons.favorite : Icons.favorite_border, color: C.rosa, size: 22)),
            )),
          ]),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('🏪 ${p['restaurante_nombre']} • 📍 ${p['zona']}', style: const TextStyle(color: C.suave, fontSize: 12)),
              const SizedBox(height: 4),
              Text('${p['nombre']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: C.ciruela)),
              if ('${p['descripcion'] ?? ''}'.isNotEmpty)
                Padding(padding: const EdgeInsets.only(top: 4), child: Text('${p['descripcion']}', style: const TextStyle(color: C.suave, fontSize: 13))),
              const SizedBox(height: 10),
              Row(children: [
                Text(dinero(p['precio']), style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: C.vino)),
                const Spacer(),
                FilledButton(
                  style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10)),
                  onPressed: () { carrito.agregar(p); aviso(context, '${p['nombre']} agregado al carrito'); },
                  child: const Text('+ Agregar'),
                ),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

// ---------------------------------------------------------------- CARRITO
class CarritoVista extends StatefulWidget {
  final Carrito carrito;
  final VoidCallback alTerminar, alExplorar;
  const CarritoVista({super.key, required this.carrito, required this.alTerminar, required this.alExplorar});
  @override
  State<CarritoVista> createState() => _EstadoCarrito();
}

class _EstadoCarrito extends State<CarritoVista> {
  final dir = TextEditingController();
  String metodo = 'Efectivo';
  bool enviando = false;

  Future<void> _pedir() async {
    final c = widget.carrito;
    if (c.lineas.isEmpty) return;
    if (dir.text.trim().length < 5) { aviso(context, 'Escribe tu dirección de entrega'); return; }
    setState(() => enviando = true);
    try {
      final items = [for (final l in c.lineas.values) {
        'id': numero(l.producto['id']).toInt(), 'cantidad': l.cantidad,
        'nombre': l.producto['nombre'], 'precio': numero(l.producto['precio']),
      }];
      final id = await Api.crearPedido(dir.text.trim(), metodo, items);
      c.vaciar();
      dir.clear();
      if (id == 0) {
        if (mounted) aviso(context, '📴 Sin internet: tu pedido quedó guardado y se enviará solo al reconectar.');
      } else if (metodo == 'Tarjeta') {
        try {
          final link = await Api.linkMercadoPago(id);
          await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
          if (mounted) aviso(context, 'Termina el pago en Mercado Pago. Luego revisa tu pedido aquí.');
        } catch (e) {
          if (mounted) aviso(context, 'Pedido creado, pero no se abrió el pago: $e. Puedes pagarlo desde Pedidos.');
        }
      } else if (mounted) {
        aviso(context, '¡Pedido confirmado! Te enviamos un correo con el detalle.');
      }
      widget.alTerminar();
    } catch (e) {
      if (mounted) aviso(context, '$e');
    } finally {
      if (mounted) setState(() => enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: widget.carrito,
      builder: (context, _) {
        final c = widget.carrito;
        if (c.lineas.isEmpty) {
          return Center(child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Text('🛒', style: TextStyle(fontSize: 56)),
            const Text('Tu carrito está vacío', style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
            const SizedBox(height: 6),
            const Text('Agrega tus platillos favoritos y vuelve aquí.', style: TextStyle(color: C.suave)),
            const SizedBox(height: 14),
            FilledButton(onPressed: widget.alExplorar, child: const Text('Ver el menú')),
          ]));
        }
        return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
          const Text('Tu carrito', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: C.ciruela)),
          const Text('Revisa tu pedido antes de pagar', style: TextStyle(color: C.suave)),
          const SizedBox(height: 12),
          for (final l in c.lineas.values)
            Padding(padding: const EdgeInsets.only(bottom: 10), child: Card(child: ListTile(
              title: Text('${l.producto['nombre']}', style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${dinero(l.producto['precio'])} · ${l.producto['restaurante_nombre']}'),
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                IconButton(onPressed: () => c.quitar(numero(l.producto['id']).toInt()), icon: const Icon(Icons.remove_circle_outline, color: C.vino)),
                Text('${l.cantidad}', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
                IconButton(onPressed: () => c.agregar(l.producto), icon: const Icon(Icons.add_circle, color: C.vino)),
              ]),
            ))),
          const SizedBox(height: 8),
          TextField(controller: dir, decoration: const InputDecoration(labelText: '📍 Dirección exacta de entrega', hintText: 'Calle, número, colonia...')),
          const SizedBox(height: 16),
          const Text('Método de pago', style: TextStyle(fontWeight: FontWeight.w800, color: C.ciruela)),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: _Pago('💵', 'Efectivo', 'Pagas al recibir', metodo == 'Efectivo', () => setState(() => metodo = 'Efectivo'))),
            const SizedBox(width: 10),
            Expanded(child: _Pago('💳', 'Tarjeta', 'Con Mercado Pago', metodo == 'Tarjeta', () => setState(() => metodo = 'Tarjeta'))),
          ]),
          const SizedBox(height: 8),
          Text(metodo == 'Tarjeta'
              ? 'Te llevamos a Mercado Pago para pagar. Al aprobarse, te llega la confirmación a tu correo.'
              : 'Pagas en efectivo cuando llegue tu pedido. Te enviamos la confirmación a tu correo.',
              style: const TextStyle(color: C.suave, fontSize: 12.5)),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(color: C.ciruela, borderRadius: BorderRadius.circular(20)),
            child: Row(children: [
              const Text('Total a pagar', style: TextStyle(color: Colors.white70)),
              const Spacer(),
              Text('${dinero(c.total)} MXN', style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
            ]),
          ),
          const SizedBox(height: 14),
          FilledButton(
            onPressed: enviando ? null : _pedir,
            child: enviando
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Text(metodo == 'Tarjeta' ? 'Pagar con Mercado Pago' : 'Confirmar y pedir ahora'),
          ),
        ]);
      },
    );
  }
}

class _Pago extends StatelessWidget {
  final String e, t, s;
  final bool on;
  final VoidCallback tap;
  const _Pago(this.e, this.t, this.s, this.on, this.tap);
  @override
  Widget build(BuildContext context) => GestureDetector(
        onTap: tap,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: on ? C.tinte : Colors.white, borderRadius: BorderRadius.circular(18),
            border: Border.all(color: on ? C.vino : C.rosaClaro, width: on ? 2 : 1),
          ),
          child: Column(children: [
            Text(e, style: const TextStyle(fontSize: 26)),
            Text(t, style: const TextStyle(fontWeight: FontWeight.w800)),
            Text(s, style: const TextStyle(color: C.suave, fontSize: 11.5)),
          ]),
        ),
      );
}

// ---------------------------------------------------------------- PEDIDOS
String etiquetaEstado(String e) =>
    {'pendiente': 'Recibido', 'preparando': 'Preparando', 'en_camino': 'En camino', 'entregado': 'Entregado'}[e] ?? e;

class PedidosVista extends StatefulWidget {
  final bool activa;
  const PedidosVista({super.key, required this.activa});
  @override
  State<PedidosVista> createState() => _EstadoPedidos();
}

class _EstadoPedidos extends State<PedidosVista> {
  List<Map<String, dynamic>> pedidos = [];
  bool cargando = true;
  String? error;
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _cargar();
    _t = Timer.periodic(const Duration(seconds: 20), (_) { if (widget.activa) _cargar(silencioso: true); });
  }

  @override
  void didUpdateWidget(covariant PedidosVista old) {
    super.didUpdateWidget(old);
    if (widget.activa && !old.activa) _cargar(silencioso: true);
  }

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _cargar({bool silencioso = false}) async {
    if (!silencioso) setState(() { cargando = true; error = null; });
    try {
      pedidos = await Api.misPedidos();
      error = null;
    } catch (e) {
      if (!silencioso) error = '$e';
    }
    if (mounted) setState(() => cargando = false);
  }

  Future<void> _pagar(int id) async {
    try {
      final link = await Api.linkMercadoPago(id);
      await launchUrl(Uri.parse(link), mode: LaunchMode.externalApplication);
    } catch (e) {
      if (mounted) aviso(context, '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (cargando) return const Center(child: CircularProgressIndicator(color: C.vino));
    if (error != null) return Center(child: Text(error!));
    return RefreshIndicator(
      color: C.vino, onRefresh: _cargar,
      child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
        const Text('📦 Mis pedidos', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: C.ciruela)),
        const Text('Estado en vivo y pagos de tus pedidos', style: TextStyle(color: C.suave)),
        const SizedBox(height: 12),
        if (pedidos.isEmpty)
          const Padding(padding: EdgeInsets.all(40), child: Center(child: Text('Aún no tienes pedidos', style: TextStyle(color: C.suave)))),
        for (var i = 0; i < pedidos.length; i++) Entrada(indice: i, child: _TarjetaPedido(p: pedidos[i], alPagar: _pagar)),
      ]),
    );
  }
}

class _TarjetaPedido extends StatelessWidget {
  final Map<String, dynamic> p;
  final void Function(int) alPagar;
  const _TarjetaPedido({required this.p, required this.alPagar});

  @override
  Widget build(BuildContext context) {
    final id = numero(p['id']).toInt();
    final estado = '${p['estado']}';
    final pago = '${p['pago_estado']}';
    final paso = ['pendiente', 'preparando', 'en_camino', 'entregado'].indexOf(estado);
    final items = (p['items'] as List? ?? []).map((i) => '${i['cantidad']}× ${i['nombre']}').join(', ');
    String pagoTxt;
    Color pagoColor;
    switch (pago) {
      case 'aprobado': pagoTxt = '✅ Pagado con Mercado Pago'; pagoColor = const Color(0xFF166534); break;
      case 'pendiente': pagoTxt = '⏳ Pago pendiente'; pagoColor = const Color(0xFF7A4B00); break;
      case 'rechazado': pagoTxt = '❌ Pago rechazado'; pagoColor = const Color(0xFF9B1C1C); break;
      default: pagoTxt = '💵 Efectivo al recibir'; pagoColor = C.suave;
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: Card(child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text(p['local'] == true ? 'Pedido nuevo' : 'Pedido #$id', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17)),
            const Spacer(),
            Text(dinero(p['total']), style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 17, color: C.vino)),
          ]),
          const SizedBox(height: 4),
          Text(items, style: const TextStyle(color: C.suave, fontSize: 13)),
          const SizedBox(height: 4),
          Text('📍 ${p['direccion_entrega']}', style: const TextStyle(fontSize: 13)),
          const SizedBox(height: 10),
          Row(children: [
            for (var i = 0; i < 4; i++) Expanded(child: Container(
              height: 6, margin: const EdgeInsets.only(right: 4),
              decoration: BoxDecoration(color: i <= paso ? C.rosa : C.tinte, borderRadius: BorderRadius.circular(3)),
            )),
          ]),
          const SizedBox(height: 6),
          Text(p['local'] == true ? '📴 Guardado sin internet · se enviará al reconectar' : etiquetaEstado(estado),
              style: const TextStyle(fontWeight: FontWeight.w700, color: C.vino)),
          const SizedBox(height: 6),
          Text(pagoTxt, style: TextStyle(color: pagoColor, fontWeight: FontWeight.w600, fontSize: 13)),
          if (pago == 'pendiente' || pago == 'rechazado') ...[
            const SizedBox(height: 10),
            FilledButton(
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(horizontal: 18, vertical: 10)),
              onPressed: () => alPagar(id),
              child: Text(pago == 'pendiente' ? 'Pagar ahora' : 'Reintentar pago'),
            ),
          ],
        ]),
      )),
    );
  }
}

// ---------------------------------------------------------------- PERFIL
class PerfilVista extends StatelessWidget {
  final int favoritos;
  const PerfilVista({super.key, required this.favoritos});

  @override
  Widget build(BuildContext context) {
    final u = Api.usuario!;
    final ini = u.nombre.trim().split(' ').where((s) => s.isNotEmpty).take(2).map((s) => s[0].toUpperCase()).join();
    return ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 120), children: [
      Container(
        padding: const EdgeInsets.all(22),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(26),
          gradient: const LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [C.vino, C.ciruela]),
        ),
        child: Column(children: [
          CircleAvatar(radius: 38, backgroundColor: C.rosaClaro, child: Text(ini, style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, color: C.ciruela))),
          const SizedBox(height: 10),
          Text(u.nombre, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w800)),
          Text(u.email, style: const TextStyle(color: C.rosaClaro)),
        ]),
      ),
      const SizedBox(height: 14),
      Card(child: Column(children: [
        ListTile(leading: const Icon(Icons.person_outline), title: const Text('Nombre'), trailing: Text(u.nombre)),
        ListTile(leading: const Icon(Icons.mail_outline), title: const Text('Correo'), trailing: Text(u.email)),
        ListTile(leading: const Icon(Icons.phone_outlined), title: const Text('Teléfono'), trailing: Text(u.telefono.isEmpty ? '—' : u.telefono)),
        ListTile(leading: const Icon(Icons.favorite_border), title: const Text('Favoritos'), trailing: Text('$favoritos')),
        const ListTile(leading: Icon(Icons.credit_card), title: Text('Pagos'), trailing: Text('Mercado Pago o efectivo')),
      ])),
      const SizedBox(height: 16),
      OutlinedButton(
        style: OutlinedButton.styleFrom(foregroundColor: C.vino, side: const BorderSide(color: C.vino),
            padding: const EdgeInsets.symmetric(vertical: 14), shape: const StadiumBorder()),
        onPressed: () async { await Api.salir(); if (context.mounted) irAInicio(context); },
        child: const Text('Cerrar sesión', style: TextStyle(fontWeight: FontWeight.w700)),
      ),
    ]);
  }
}
