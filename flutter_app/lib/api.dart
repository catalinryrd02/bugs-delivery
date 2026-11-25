import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// Servidor en Render (el mismo que usa la página web).
const String baseUrl = 'https://bugs-delivery.onrender.com';

num numero(dynamic v) => v is num ? v : (num.tryParse('$v') ?? 0);
String dinero(dynamic v) => '\$${numero(v).toStringAsFixed(2)}';

class ApiError implements Exception {
  final String mensaje;
  ApiError(this.mensaje);
  @override
  String toString() => mensaje;
}

/// No hubo respuesta del servidor (sin internet).
class SinConexion extends ApiError {
  SinConexion() : super('Sin conexión con el servidor. Revisa tu internet e intenta de nuevo.');
}

class Usuario {
  final int id;
  final String nombre, email, rol, telefono;
  Usuario(this.id, this.nombre, this.email, this.rol, this.telefono);
  factory Usuario.fromJson(Map<String, dynamic> j) =>
      Usuario(j['id'] as int, '${j['nombre']}', '${j['email']}', '${j['rol']}', '${j['telefono'] ?? ''}');
  Map<String, dynamic> toJson() => {'id': id, 'nombre': nombre, 'email': email, 'rol': rol, 'telefono': telefono};
}

class Api {
  static Usuario? usuario;

  /// true = el servidor respondió la última vez; false = sin internet.
  static final ValueNotifier<bool> conectado = ValueNotifier(true);
  /// Cambios hechos sin internet que aún no se envían (pedidos, favoritos, estados).
  static final ValueNotifier<int> pendientes = ValueNotifier(0);
  static Timer? _timer;
  static bool _sincronizando = false;

  // ------------------------------------------------------------ red
  static Future<dynamic> _pedir(String metodo, String ruta, {Map<String, dynamic>? cuerpo}) async {
    final uri = Uri.parse('$baseUrl/api$ruta');
    final cab = {'Content-Type': 'application/json'};
    try {
      late http.Response r;
      // Render gratis tarda en despertar (hasta ~50 s); sin internet falla casi al instante.
      final t = Duration(seconds: conectado.value ? 60 : 8);
      switch (metodo) {
        case 'POST':
          r = await http.post(uri, headers: cab, body: jsonEncode(cuerpo ?? {})).timeout(t);
          break;
        case 'PUT':
          r = await http.put(uri, headers: cab, body: jsonEncode(cuerpo ?? {})).timeout(t);
          break;
        case 'DELETE':
          r = await http.delete(uri, headers: cab).timeout(t);
          break;
        default:
          r = await http.get(uri, headers: cab).timeout(t);
      }
      conectado.value = true;
      dynamic data;
      try {
        data = jsonDecode(utf8.decode(r.bodyBytes));
      } catch (_) {
        data = null;
      }
      if (r.statusCode >= 500 && data == null) throw SinConexion(); // Render dormido / caído
      if (r.statusCode >= 400) {
        throw ApiError(data is Map && data['error'] != null ? '${data['error']}' : 'Error ${r.statusCode}');
      }
      return data;
    } on SinConexion {
      conectado.value = false;
      rethrow;
    } on ApiError {
      rethrow;
    } catch (_) {
      conectado.value = false;
      throw SinConexion();
    }
  }

  // ------------------------------------------------------------ almacenamiento local
  static Future<void> _guardarCache(String clave, dynamic datos) async {
    final p = await SharedPreferences.getInstance();
    await p.setString('cache_$clave', jsonEncode(datos));
  }

  static Future<dynamic> _leerCache(String clave) async {
    final p = await SharedPreferences.getInstance();
    final s = p.getString('cache_$clave');
    return s == null ? null : jsonDecode(s);
  }

  /// GET con copia local: sin internet devuelve lo último que se descargó.
  static Future<dynamic> _conCache(String clave, String ruta) async {
    try {
      final d = await _pedir('GET', ruta);
      await _guardarCache(clave, d);
      return d;
    } on SinConexion {
      final c = await _leerCache(clave);
      if (c == null) {
        throw ApiError('Sin internet y todavía no hay datos guardados. Conéctate una vez para descargar el menú.');
      }
      return c;
    }
  }

  // ---- cola de cambios hechos sin internet ----
  static Future<List<Map<String, dynamic>>> _cola() async {
    final p = await SharedPreferences.getInstance();
    final s = p.getString('cola');
    if (s == null) return [];
    return List<Map<String, dynamic>>.from(jsonDecode(s));
  }

  static Future<void> _guardarCola(List<Map<String, dynamic>> c) async {
    final p = await SharedPreferences.getInstance();
    await p.setString('cola', jsonEncode(c));
    pendientes.value = c.length;
  }

  static Future<void> _encolar(String tipo, Map<String, dynamic> datos) async {
    final c = await _cola();
    c.add({'tipo': tipo, 'datos': datos});
    await _guardarCola(c);
  }

  /// Envía al servidor lo que quedó pendiente. Se llama sola cada 15 s.
  static Future<void> sincronizar() async {
    if (_sincronizando) return;
    _sincronizando = true;
    try {
      final c = await _cola();
      pendientes.value = c.length;
      if (c.isEmpty) return;
      final resto = <Map<String, dynamic>>[];
      var cortado = false;
      for (final e in c) {
        if (cortado) { resto.add(e); continue; }
        final d = Map<String, dynamic>.from(e['datos']);
        try {
          switch (e['tipo']) {
            case 'pedido':
              await _pedir('POST', '/pedidos', cuerpo: d);
              break;
            case 'estado':
              await _pedir('PUT', '/pedidos/${d['id']}/estado', cuerpo: {'estado': d['estado'], 'repartidor_id': d['repartidor_id']});
              break;
            case 'fav':
              await _pedir('POST', '/favoritos', cuerpo: d);
              break;
          }
        } on SinConexion {
          cortado = true;
          resto.add(e);
        } on ApiError {
          // El servidor lo rechazó (ya no existe, datos inválidos): se descarta para no atorar la cola.
        }
      }
      await _guardarCola(resto);
    } finally {
      _sincronizando = false;
    }
  }

  static void iniciarSincronizacion() {
    _timer?.cancel();
    _cola().then((c) => pendientes.value = c.length);
    _timer = Timer.periodic(const Duration(seconds: 15), (_) => sincronizar());
    sincronizar();
  }

  // ------------------------------------------------------------ sesión
  static String _hash(String s) {
    var h = 0x811C9DC5;
    for (final u in utf8.encode('losbugs|$s')) {
      h ^= u;
      h = (h * 0x01000193) & 0xFFFFFFFF;
    }
    return h.toRadixString(16);
  }

  static Future<void> cargarSesion() async {
    final p = await SharedPreferences.getInstance();
    final s = p.getString('usuario');
    if (s != null) {
      usuario = Usuario.fromJson(jsonDecode(s));
      iniciarSincronizacion();
    }
  }

  static Future<void> _guardar(Usuario u, String email, String pass) async {
    usuario = u;
    final p = await SharedPreferences.getInstance();
    await p.setString('usuario', jsonEncode(u.toJson()));
    // Para poder entrar sin internet más adelante (solo se guarda una huella, no la contraseña)
    await p.setString('login_${email.trim().toLowerCase()}',
        jsonEncode({'h': _hash('${email.trim().toLowerCase()}|$pass'), 'u': u.toJson()}));
    iniciarSincronizacion();
  }

  static Future<void> salir() async {
    usuario = null;
    _timer?.cancel();
    final p = await SharedPreferences.getInstance();
    await p.remove('usuario');
  }

  static Future<Usuario> login(String email, String pass) async {
    try {
      final d = await _pedir('POST', '/login', cuerpo: {'email': email.trim(), 'password': pass});
      final u = Usuario.fromJson(Map<String, dynamic>.from(d['user']));
      await _guardar(u, email, pass);
      return u;
    } on SinConexion {
      final p = await SharedPreferences.getInstance();
      final g = p.getString('login_${email.trim().toLowerCase()}');
      if (g != null) {
        final m = jsonDecode(g);
        if (m['h'] == _hash('${email.trim().toLowerCase()}|$pass')) {
          final u = Usuario.fromJson(Map<String, dynamic>.from(m['u']));
          usuario = u;
          await p.setString('usuario', jsonEncode(u.toJson()));
          iniciarSincronizacion();
          return u;
        }
        throw ApiError('Credenciales incorrectas');
      }
      throw ApiError('Sin internet. La primera vez que entras en este teléfono necesitas conexión.');
    }
  }

  static Future<void> registrar(String nombre, String email, String pass, String tel) =>
      _pedir('POST', '/register', cuerpo: {'nombre': nombre, 'email': email.trim(), 'password': pass, 'telefono': tel});

  // ------------------------------------------------------------ catálogo
  static Future<List<Map<String, dynamic>>> productos() async =>
      List<Map<String, dynamic>>.from(await _conCache('productos', '/productos'));

  static Future<Set<int>> favoritos() async {
    final d = await _conCache('favs_${usuario!.id}', '/favoritos/${usuario!.id}');
    return {for (final x in d as List) numero(x).toInt()};
  }

  static Future<void> setFavorito(int productoId, bool activo) async {
    // Siempre se actualiza la copia local; si no hay internet, se envía después.
    final actual = {for (final x in (await _leerCache('favs_${usuario!.id}') ?? []) as List) numero(x).toInt()};
    activo ? actual.add(productoId) : actual.remove(productoId);
    await _guardarCache('favs_${usuario!.id}', actual.toList());
    final datos = {'usuario_id': usuario!.id, 'producto_id': productoId, 'activo': activo};
    try {
      await _pedir('POST', '/favoritos', cuerpo: datos);
    } on SinConexion {
      await _encolar('fav', datos);
    }
  }

  // ------------------------------------------------------------ pedidos
  /// Devuelve el id del pedido, o 0 si quedó guardado sin internet (se enviará solo).
  static Future<int> crearPedido(String direccion, String metodo, List<Map<String, dynamic>> lineas) async {
    final Map<String, dynamic> cuerpo = {
      'cliente_id': usuario!.id,
      'direccion_entrega': direccion,
      'metodo_pago': metodo,
      'items': [for (final l in lineas) {'id': l['id'], 'cantidad': l['cantidad']}],
      'ref': 'app-${DateTime.now().millisecondsSinceEpoch}',
    };
    try {
      final d = await _pedir('POST', '/pedidos', cuerpo: cuerpo);
      return numero(d['pedidoId']).toInt();
    } on SinConexion {
      if (metodo == 'Tarjeta') {
        throw ApiError('Para pagar con tarjeta necesitas internet. Puedes pedir en efectivo y se enviará cuando regreses a línea.');
      }
      cuerpo['_vista'] = {
        'items': [for (final l in lineas) {'cantidad': l['cantidad'], 'nombre': l['nombre']}],
        'total': lineas.fold<double>(0, (s, l) => s + (numero(l['precio']) * numero(l['cantidad'])).toDouble()),
        'fecha': DateTime.now().toIso8601String(),
      };
      await _encolar('pedido', cuerpo);
      return 0;
    }
  }

  static Future<String> linkMercadoPago(int pedidoId) async {
    final d = await _pedir('POST', '/pagos/mercadopago', cuerpo: {'pedido_id': pedidoId});
    return '${d['init_point']}';
  }

  static Future<List<Map<String, dynamic>>> misPedidos() async {
    final lista = List<Map<String, dynamic>>.from(await _conCache('mis_pedidos_${usuario!.id}', '/pedidos?cliente_id=${usuario!.id}'));
    // Pedidos hechos sin internet que todavía no llegan al servidor
    final locales = <Map<String, dynamic>>[];
    for (final e in await _cola()) {
      if (e['tipo'] != 'pedido') continue;
      final d = Map<String, dynamic>.from(e['datos']);
      final v = Map<String, dynamic>.from(d['_vista'] ?? {});
      locales.add({
        'id': 0, 'local': true, 'estado': 'pendiente', 'pago_estado': 'contra_entrega',
        'total': v['total'] ?? 0, 'direccion_entrega': d['direccion_entrega'], 'items': v['items'] ?? [],
      });
    }
    return [...locales.reversed, ...lista];
  }

  static Future<List<Map<String, dynamic>>> todosPedidos() async {
    final lista = List<Map<String, dynamic>>.from(await _conCache('todos_pedidos', '/pedidos'));
    // Aplica encima los cambios de estado que aún no se han enviado
    for (final e in await _cola()) {
      if (e['tipo'] != 'estado') continue;
      final d = Map<String, dynamic>.from(e['datos']);
      for (final p in lista) {
        if (numero(p['id']).toInt() == numero(d['id']).toInt()) {
          p['estado'] = d['estado'];
          if (d['repartidor_id'] != null) p['repartidor_id'] = d['repartidor_id'];
        }
      }
    }
    return lista;
  }

  /// true = enviado al servidor; false = guardado para enviarse al volver el internet.
  static Future<bool> cambiarEstado(int pedidoId, String estado, {int? repartidorId}) async {
    final datos = {'id': pedidoId, 'estado': estado, 'repartidor_id': repartidorId};
    try {
      await _pedir('PUT', '/pedidos/$pedidoId/estado', cuerpo: {'estado': estado, 'repartidor_id': repartidorId});
      return true;
    } on SinConexion {
      await _encolar('estado', datos);
      return false;
    }
  }

  // ------------------------------------------------------------ administración (requiere internet salvo lectura)
  static Future<List<Map<String, dynamic>>> usuarios() async =>
      List<Map<String, dynamic>>.from(await _conCache('usuarios', '/usuarios'));

  static Future<List<Map<String, dynamic>>> restaurantes() async =>
      List<Map<String, dynamic>>.from(await _conCache('restaurantes', '/restaurantes'));

  static Future<void> agregarProducto(Map<String, dynamic> p) => _pedir('POST', '/productos', cuerpo: p);
  static Future<void> borrarProducto(int id) => _pedir('DELETE', '/productos/$id');
  static Future<void> agregarRepartidor(Map<String, dynamic> r) => _pedir('POST', '/repartidores', cuerpo: r);
  static Future<void> borrarUsuario(int id) => _pedir('DELETE', '/usuarios/$id');
}
