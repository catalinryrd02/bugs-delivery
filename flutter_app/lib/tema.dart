import 'package:flutter/material.dart';
import 'api.dart';

class C {
  static const ciruela = Color(0xFF270D20);
  static const vino = Color(0xFF7B2857);
  static const rosa = Color(0xFFD95B96);
  static const rosaClaro = Color(0xFFF3ADC9);
  static const fondo = Color(0xFFFFF0F6);
  static const tinte = Color(0xFFFBE0EC);
  static const texto = Color(0xFF270D20);
  static const suave = Color(0xFF7A4A67);
}

ThemeData temaApp() {
  final base = ColorScheme.fromSeed(seedColor: C.vino, primary: C.vino, secondary: C.rosa, surface: Colors.white);
  return ThemeData(
    useMaterial3: true,
    colorScheme: base,
    scaffoldBackgroundColor: C.fondo,
    fontFamily: 'Helvetica Neue',
    appBarTheme: const AppBarTheme(
      backgroundColor: Colors.white, foregroundColor: C.ciruela, elevation: 0, centerTitle: false,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: C.vino, foregroundColor: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 15),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        textStyle: const TextStyle(fontWeight: FontWeight.w700, fontSize: 15),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true, fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: C.rosaClaro)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: C.rosaClaro)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(16), borderSide: const BorderSide(color: C.vino, width: 1.6)),
    ),
    cardTheme: CardThemeData(
      color: Colors.white, elevation: 0, margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
  );
}

void aviso(BuildContext c, String m) {
  ScaffoldMessenger.of(c)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      content: Text(m), behavior: SnackBarBehavior.floating, backgroundColor: C.ciruela,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
    ));
}

/// Menú inferior: barra oscura, círculos y píldora activa con degradado.
class PildoraNav extends StatelessWidget {
  final int actual;
  final List<({IconData icono, String texto, int insignia})> items;
  final ValueChanged<int> alElegir;
  const PildoraNav({super.key, required this.actual, required this.items, required this.alElegir});

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      minimum: const EdgeInsets.fromLTRB(14, 0, 14, 12),
      child: Container(
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: C.ciruela, borderRadius: BorderRadius.circular(999),
          boxShadow: [BoxShadow(color: C.ciruela.withOpacity(.4), blurRadius: 26, offset: const Offset(0, 10))],
        ),
        child: Row(children: [
          for (var i = 0; i < items.length; i++) ...[
            if (i > 0) const SizedBox(width: 6),
            i == actual ? Expanded(child: _activo(i)) : _circulo(i),
          ],
        ]),
      ),
    );
  }

  Widget _insignia(int n, Color fondo) => n <= 0
      ? const SizedBox.shrink()
      : Container(
          padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
          decoration: BoxDecoration(color: C.rosa, borderRadius: BorderRadius.circular(10), border: Border.all(color: fondo, width: 2)),
          child: Text('$n', style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.w800)),
        );

  Widget _circulo(int i) => GestureDetector(
        onTap: () => alElegir(i),
        child: SizedBox(
          width: 52, height: 52,
          child: Stack(alignment: Alignment.center, clipBehavior: Clip.none, children: [
            Container(
              decoration: BoxDecoration(
                shape: BoxShape.circle, color: const Color(0xFF34162C),
                border: Border.all(color: Colors.white.withOpacity(.07)),
              ),
              child: Center(child: Icon(items[i].icono, color: const Color(0xFFB79AAE), size: 22)),
            ),
            Positioned(top: 0, right: 0, child: _insignia(items[i].insignia, C.ciruela)),
          ]),
        ),
      );

  Widget _activo(int i) => AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        height: 52,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(999),
          gradient: const LinearGradient(colors: [C.fondo, C.rosaClaro, C.fondo]),
          boxShadow: [BoxShadow(color: C.rosa.withOpacity(.35), blurRadius: 14, offset: const Offset(0, 4))],
        ),
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Icon(items[i].icono, color: C.ciruela, size: 22),
          const SizedBox(width: 8),
          Flexible(child: Text(items[i].texto, overflow: TextOverflow.ellipsis,
              style: const TextStyle(color: C.ciruela, fontWeight: FontWeight.w800, fontSize: 14))),
          if (items[i].insignia > 0) ...[const SizedBox(width: 6), _insignia(items[i].insignia, C.rosaClaro)],
        ]),
      );
}

/// Franja que avisa cuando no hay internet o hay cambios por enviar.
class BannerConexion extends StatelessWidget {
  const BannerConexion({super.key});
  @override
  Widget build(BuildContext context) {
    return ValueListenableBuilder<bool>(
      valueListenable: Api.conectado,
      builder: (_, on, __) => ValueListenableBuilder<int>(
        valueListenable: Api.pendientes,
        builder: (_, n, __) {
          if (on && n == 0) return const SizedBox.shrink();
          final txt = !on
              ? '📴 Sin internet · usando datos guardados${n > 0 ? ' · $n por enviar' : ''}'
              : '🔄 Enviando $n cambio${n == 1 ? '' : 's'} guardado${n == 1 ? '' : 's'}...';
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(vertical: 6, horizontal: 12),
            color: on ? C.vino : C.ciruela,
            child: Text(txt, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 12.5, fontWeight: FontWeight.w600)),
          );
        },
      ),
    );
  }
}

/// Aparición suave (sube y se desvanece) para tarjetas y listas.
class Entrada extends StatelessWidget {
  final Widget child;
  final int indice;
  const Entrada({super.key, required this.child, this.indice = 0});
  @override
  Widget build(BuildContext context) => TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: 1),
        duration: Duration(milliseconds: 420 + (indice % 6) * 70),
        curve: Curves.easeOutCubic,
        builder: (c, v, w) => Opacity(opacity: v, child: Transform.translate(offset: Offset(0, 24 * (1 - v)), child: w)),
        child: child,
      );
}
