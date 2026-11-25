import 'dart:async';
import 'package:flutter/material.dart';
import 'api.dart';
import 'tema.dart';
import 'cliente.dart' show etiquetaEstado;
import 'main.dart' show irAInicio;

Future<void> _cerrar(BuildContext c) async {
  await Api.salir();
  if (c.mounted) irAInicio(c);
}

AppBar _barra(BuildContext c, String titulo) => AppBar(
      titleSpacing: 14,
      title: Row(children: [
        Image.asset('assets/logo.png', width: 36, height: 36),
        const SizedBox(width: 10),
        Text(titulo, style: const TextStyle(fontWeight: FontWeight.w700, color: C.vino)),
      ]),
      actions: [IconButton(tooltip: 'Cerrar sesión', icon: const Icon(Icons.logout, color: C.vino), onPressed: () => _cerrar(c))],
    );

// ---------------------------------------------------------------- Lista de pedidos (repartidor y admin)
class ListaPedidos extends StatefulWidget {
  final bool esRepartidor;
  const ListaPedidos({super.key, required this.esRepartidor});
  @override
  State<ListaPedidos> createState() => _EstadoListaPedidos();
}

class _EstadoListaPedidos extends State<ListaPedidos> {
  List<Map<String, dynamic>> pedidos = [];
  bool cargando = true;
  String? error;
  Timer? _t;

  @override
  void initState() {
    super.initState();
    _cargar();
    _t = Timer.periodic(const Duration(seconds: 15), (_) => _cargar(silencioso: true));
  }

  @override
  void dispose() { _t?.cancel(); super.dispose(); }

  Future<void> _cargar({bool silencioso = false}) async {
    if (!silencioso) setState(() { cargando = true; error = null; });
    try {
      pedidos = await Api.todosPedidos();
      error = null;
    } catch (e) {
      if (!silencioso) error = '$e';
    }
    if (mounted) setState(() => cargando = false);
  }

  Future<void> _estado(int id, String estado) async {
    try {
      final enviado = await Api.cambiarEstado(id, estado, repartidorId: widget.esRepartidor ? Api.usuario!.id : null);
      if (mounted) aviso(context, enviado ? 'Pedido #$id: ${etiquetaEstado(estado)}' : '📴 Pedido #$id: ${etiquetaEstado(estado)} (se enviará al reconectar)');
      _cargar(silencioso: true);
    } catch (e) {
      if (mounted) aviso(context, '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (cargando) return const Center(child: CircularProgressIndicator(color: C.vino));
    if (error != null) return Center(child: Text(error!));
    final yo = Api.usuario!.id;
    var lista = pedidos;
    if (widget.esRepartidor) {
      lista = pedidos.where((p) {
        final e = '${p['estado']}';
        final rep = p['repartidor_id'] == null ? null : numero(p['repartidor_id']).toInt();
        if (e == 'entregado') return false;
        return rep == null || rep == yo;
      }).toList();
    }
    return RefreshIndicator(
      color: C.vino, onRefresh: _cargar,
      child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 24), children: [
        if (lista.isEmpty) const Padding(padding: EdgeInsets.all(40), child: Center(child: Text('No hay pedidos por ahora', style: TextStyle(color: C.suave)))),
        for (var i = 0; i < lista.length; i++) Entrada(indice: i, child: _fila(lista[i])),
      ]),
    );
  }

  Widget _fila(Map<String, dynamic> p) {
    final id = numero(p['id']).toInt();
    final e = '${p['estado']}';
    final items = (p['items'] as List? ?? []).map((i) => '${i['cantidad']}× ${i['nombre']}').join(', ');
    final tarjeta = '${p['pago_estado']}' == 'aprobado';
    final botones = <Widget>[];
    if (e == 'pendiente') botones.add(FilledButton(onPressed: () => _estado(id, 'preparando'), child: const Text('Preparar')));
    if (e == 'pendiente' || e == 'preparando') {
      botones.add(FilledButton(onPressed: () => _estado(id, 'en_camino'), child: Text(widget.esRepartidor ? 'Tomar y salir' : 'En camino')));
    }
    if (e == 'en_camino') botones.add(FilledButton(onPressed: () => _estado(id, 'entregado'), child: const Text('Marcar entregado')));
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            Text('Pedido #$id', style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
            const Spacer(),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(color: C.tinte, borderRadius: BorderRadius.circular(999)),
              child: Text(etiquetaEstado(e), style: const TextStyle(color: C.vino, fontWeight: FontWeight.w700, fontSize: 12)),
            ),
          ]),
          const SizedBox(height: 6),
          Text('👤 ${p['cliente_nombre']}  ·  📞 ${p['cliente_telefono'] ?? ''}', style: const TextStyle(fontSize: 13)),
          Text('📍 ${p['direccion_entrega']}', style: const TextStyle(fontSize: 13)),
          if (items.isNotEmpty) Text(items, style: const TextStyle(color: C.suave, fontSize: 13)),
          const SizedBox(height: 4),
          Text('${dinero(p['total'])} · ${tarjeta ? '💳 Pagado con tarjeta' : '💵 Cobrar en efectivo'}',
              style: const TextStyle(fontWeight: FontWeight.w700, color: C.vino)),
          if (botones.isNotEmpty) ...[
            const SizedBox(height: 10),
            Wrap(spacing: 8, runSpacing: 8, children: botones),
          ],
        ]),
      )),
    );
  }
}

class RepartidorPantalla extends StatelessWidget {
  const RepartidorPantalla({super.key});
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: _barra(context, 'Repartidor · ${Api.usuario!.nombre.split(' ').first}'),
        body: const Column(children: [BannerConexion(), Expanded(child: ListaPedidos(esRepartidor: true))]),
      );
}

// ---------------------------------------------------------------- Administrador
class AdminPantalla extends StatefulWidget {
  const AdminPantalla({super.key});
  @override
  State<AdminPantalla> createState() => _EstadoAdmin();
}

class _EstadoAdmin extends State<AdminPantalla> {
  int _tab = 0;
  @override
  Widget build(BuildContext context) {
    const paginas = [ListaPedidos(esRepartidor: false), AdminProductos(), AdminUsuarios()];
    return Scaffold(
      appBar: _barra(context, 'Administrador'),
      body: Column(children: [const BannerConexion(), Expanded(child: IndexedStack(index: _tab, children: paginas))]),
      bottomNavigationBar: PildoraNav(
        actual: _tab,
        items: const [
          (icono: Icons.inventory_2_outlined, texto: 'Pedidos', insignia: 0),
          (icono: Icons.restaurant_menu, texto: 'Productos', insignia: 0),
          (icono: Icons.group_outlined, texto: 'Usuarios', insignia: 0),
        ],
        alElegir: (i) => setState(() => _tab = i),
      ),
    );
  }
}

class AdminProductos extends StatefulWidget {
  const AdminProductos({super.key});
  @override
  State<AdminProductos> createState() => _EstadoAdminProductos();
}

class _EstadoAdminProductos extends State<AdminProductos> {
  List<Map<String, dynamic>> lista = [];
  bool cargando = true;

  @override
  void initState() { super.initState(); _cargar(); }

  Future<void> _cargar() async {
    try { lista = await Api.productos(); } catch (e) { if (mounted) aviso(context, '$e'); }
    if (mounted) setState(() => cargando = false);
  }

  Future<void> _nuevo() async {
    List<Map<String, dynamic>> rests = [];
    try { rests = await Api.restaurantes(); } catch (_) {}
    if (!mounted || rests.isEmpty) { if (mounted) aviso(context, 'No hay restaurantes'); return; }
    final nombre = TextEditingController(), desc = TextEditingController(), precio = TextEditingController(), img = TextEditingController();
    int rid = numero(rests.first['id']).toInt();
    final ok = await showDialog<bool>(context: context, builder: (ctx) => StatefulBuilder(builder: (ctx, set) => AlertDialog(
      title: const Text('Nuevo producto'),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        DropdownButtonFormField<int>(
          value: rid,
          items: [for (final r in rests) DropdownMenuItem(value: numero(r['id']).toInt(), child: Text('${r['nombre']}', overflow: TextOverflow.ellipsis))],
          onChanged: (v) => set(() => rid = v ?? rid),
          decoration: const InputDecoration(labelText: 'Restaurante'),
        ),
        const SizedBox(height: 10),
        TextField(controller: nombre, decoration: const InputDecoration(labelText: 'Nombre')),
        const SizedBox(height: 10),
        TextField(controller: desc, decoration: const InputDecoration(labelText: 'Descripción')),
        const SizedBox(height: 10),
        TextField(controller: precio, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Precio')),
        const SizedBox(height: 10),
        TextField(controller: img, decoration: const InputDecoration(labelText: 'URL de imagen (opcional)')),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Guardar')),
      ],
    )));
    if (ok != true) return;
    try {
      await Api.agregarProducto({
        'restaurante_id': rid, 'nombre': nombre.text.trim(), 'descripcion': desc.text.trim(),
        'precio': double.tryParse(precio.text) ?? 0, 'imagen_url': img.text.trim(),
      });
      await _cargar();
    } catch (e) { if (mounted) aviso(context, '$e'); }
  }

  Future<void> _borrar(Map<String, dynamic> p) async {
    final ok = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('¿Eliminar producto?'), content: Text('${p['nombre']}'),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('No')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Eliminar')),
      ],
    ));
    if (ok != true) return;
    try { await Api.borrarProducto(numero(p['id']).toInt()); await _cargar(); } catch (e) { if (mounted) aviso(context, '$e'); }
  }

  @override
  Widget build(BuildContext context) {
    if (cargando) return const Center(child: CircularProgressIndicator(color: C.vino));
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: C.vino, foregroundColor: Colors.white,
        onPressed: _nuevo, icon: const Icon(Icons.add), label: const Text('Producto'),
      ),
      body: RefreshIndicator(color: C.vino, onRefresh: _cargar, child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 100), children: [
        for (final p in lista)
          Padding(padding: const EdgeInsets.only(bottom: 8), child: Card(child: ListTile(
            title: Text('${p['nombre']}', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${p['restaurante_nombre']} · ${dinero(p['precio'])}'),
            trailing: IconButton(icon: const Icon(Icons.delete_outline, color: C.vino), onPressed: () => _borrar(p)),
          ))),
      ])),
    );
  }
}

class AdminUsuarios extends StatefulWidget {
  const AdminUsuarios({super.key});
  @override
  State<AdminUsuarios> createState() => _EstadoAdminUsuarios();
}

class _EstadoAdminUsuarios extends State<AdminUsuarios> {
  List<Map<String, dynamic>> lista = [];
  bool cargando = true;

  @override
  void initState() { super.initState(); _cargar(); }

  Future<void> _cargar() async {
    try { lista = await Api.usuarios(); } catch (e) { if (mounted) aviso(context, '$e'); }
    if (mounted) setState(() => cargando = false);
  }

  Future<void> _nuevo() async {
    final n = TextEditingController(), em = TextEditingController(), pw = TextEditingController(), tel = TextEditingController(), veh = TextEditingController();
    final ok = await showDialog<bool>(context: context, builder: (ctx) => AlertDialog(
      title: const Text('Nuevo repartidor'),
      content: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: n, decoration: const InputDecoration(labelText: 'Nombre')),
        const SizedBox(height: 10),
        TextField(controller: em, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Correo')),
        const SizedBox(height: 10),
        TextField(controller: pw, decoration: const InputDecoration(labelText: 'Contraseña')),
        const SizedBox(height: 10),
        TextField(controller: tel, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Teléfono')),
        const SizedBox(height: 10),
        TextField(controller: veh, decoration: const InputDecoration(labelText: 'Vehículo')),
      ])),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
        FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Guardar')),
      ],
    ));
    if (ok != true) return;
    try {
      await Api.agregarRepartidor({
        'nombre': n.text.trim(), 'email': em.text.trim(), 'password': pw.text, 'telefono': tel.text.trim(), 'vehiculo': veh.text.trim(),
      });
      await _cargar();
    } catch (e) { if (mounted) aviso(context, '$e'); }
  }

  Future<void> _borrar(Map<String, dynamic> u) async {
    try { await Api.borrarUsuario(numero(u['id']).toInt()); await _cargar(); } catch (e) { if (mounted) aviso(context, '$e'); }
  }

  @override
  Widget build(BuildContext context) {
    if (cargando) return const Center(child: CircularProgressIndicator(color: C.vino));
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: FloatingActionButton.extended(
        backgroundColor: C.vino, foregroundColor: Colors.white,
        onPressed: _nuevo, icon: const Icon(Icons.add), label: const Text('Repartidor'),
      ),
      body: RefreshIndicator(color: C.vino, onRefresh: _cargar, child: ListView(padding: const EdgeInsets.fromLTRB(16, 8, 16, 100), children: [
        for (final u in lista)
          Padding(padding: const EdgeInsets.only(bottom: 8), child: Card(child: ListTile(
            title: Text('${u['nombre']}', style: const TextStyle(fontWeight: FontWeight.w700)),
            subtitle: Text('${u['rol']} · ${u['email']}'),
            trailing: '${u['rol']}' == 'admin' ? null : IconButton(icon: const Icon(Icons.delete_outline, color: C.vino), onPressed: () => _borrar(u)),
          ))),
      ])),
    );
  }
}
