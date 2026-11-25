import 'package:flutter/material.dart';
import 'api.dart';
import 'tema.dart';
import 'cliente.dart';
import 'personal.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Api.cargarSesion();
  runApp(const LosBugsApp());
}

class LosBugsApp extends StatelessWidget {
  const LosBugsApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'LOS BUGS DELIVERY',
        debugShowCheckedModeBanner: false,
        theme: temaApp(),
        home: pantallaPorRol(),
      );
}

Widget pantallaPorRol() {
  final u = Api.usuario;
  if (u == null) return const PantallaEntrada();
  switch (u.rol) {
    case 'admin':
      return const AdminPantalla();
    case 'repartidor':
      return const RepartidorPantalla();
    default:
      return const ClientePantalla();
  }
}

void irAInicio(BuildContext c) => Navigator.of(c).pushAndRemoveUntil(
    MaterialPageRoute(builder: (_) => pantallaPorRol()), (_) => false);

class PantallaEntrada extends StatefulWidget {
  const PantallaEntrada({super.key});
  @override
  State<PantallaEntrada> createState() => _EstadoEntrada();
}

class _EstadoEntrada extends State<PantallaEntrada> {
  final _nombre = TextEditingController();
  final _email = TextEditingController();
  final _pass = TextEditingController();
  final _tel = TextEditingController();
  bool _registro = false, _cargando = false, _ver = false;

  Future<void> _enviar() async {
    if (_email.text.trim().isEmpty || _pass.text.isEmpty || (_registro && _nombre.text.trim().isEmpty)) {
      aviso(context, 'Completa los campos');
      return;
    }
    setState(() => _cargando = true);
    try {
      if (_registro) {
        await Api.registrar(_nombre.text.trim(), _email.text, _pass.text, _tel.text.trim());
        if (!mounted) return;
        aviso(context, '¡Cuenta creada! Iniciando sesión...');
      }
      await Api.login(_email.text, _pass.text);
      if (mounted) irAInicio(context);
    } catch (e) {
      if (mounted) aviso(context, '$e');
    } finally {
      if (mounted) setState(() => _cargando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(begin: Alignment.topCenter, end: Alignment.bottomCenter, colors: [C.fondo, C.rosaClaro]),
        ),
        child: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: Column(children: [
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.fromLTRB(24, 28, 24, 24),
                    decoration: const BoxDecoration(
                      borderRadius: BorderRadius.vertical(top: Radius.circular(28)),
                      gradient: LinearGradient(begin: Alignment.topLeft, end: Alignment.bottomRight, colors: [C.vino, C.ciruela]),
                    ),
                    child: Column(children: [
                      Container(
                        width: 96, height: 96, padding: const EdgeInsets.all(8),
                        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(24)),
                        child: Image.asset('assets/logo.png'),
                      ),
                      const SizedBox(height: 14),
                      const Text('LOS BUGS', style: TextStyle(color: Colors.white, fontSize: 32, fontWeight: FontWeight.w300, letterSpacing: 2)),
                      const Text('D E L I V E R Y', style: TextStyle(color: C.rosaClaro, fontSize: 13)),
                      const SizedBox(height: 8),
                      const Text('Tu antojo, hasta tu puerta.', style: TextStyle(color: Colors.white70)),
                    ]),
                  ),
                  Container(
                    padding: const EdgeInsets.all(22),
                    decoration: const BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
                    ),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                      Text(_registro ? 'Crear cuenta de cliente' : 'Iniciar sesión',
                          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: C.ciruela)),
                      const SizedBox(height: 14),
                      if (_registro) ...[
                        TextField(controller: _nombre, decoration: const InputDecoration(labelText: 'Nombre completo')),
                        const SizedBox(height: 12),
                        TextField(controller: _tel, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Teléfono')),
                        const SizedBox(height: 12),
                      ],
                      TextField(controller: _email, keyboardType: TextInputType.emailAddress, decoration: const InputDecoration(labelText: 'Correo')),
                      const SizedBox(height: 12),
                      TextField(
                        controller: _pass, obscureText: !_ver,
                        decoration: InputDecoration(
                          labelText: 'Contraseña',
                          suffixIcon: IconButton(icon: Icon(_ver ? Icons.visibility_off : Icons.visibility), onPressed: () => setState(() => _ver = !_ver)),
                        ),
                        onSubmitted: (_) => _enviar(),
                      ),
                      const SizedBox(height: 18),
                      FilledButton(
                        onPressed: _cargando ? null : _enviar,
                        child: _cargando
                            ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                            : Text(_registro ? 'Crear cuenta' : 'Entrar'),
                      ),
                      TextButton(
                        onPressed: () => setState(() => _registro = !_registro),
                        child: Text(_registro ? 'Ya tengo cuenta' : 'Crear cuenta de cliente', style: const TextStyle(color: C.vino)),
                      ),
                      const Text('Administradores y repartidores entran con su correo y contraseña.',
                          textAlign: TextAlign.center, style: TextStyle(color: C.suave, fontSize: 12)),
                    ]),
                  ),
                ]),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
