/* LOS BUGS DELIVERY - Pagos con Mercado Pago (Checkout Pro) y correos de confirmación.
   No necesita librerías extra: usa fetch (Node 18+).

   Variables de entorno (se ponen en Render → Environment):
     MP_ACCESS_TOKEN     Access Token de tu app de Mercado Pago (APP_USR-... o TEST-...)
     MP_WEBHOOK_SECRET   (opcional) clave secreta de Webhooks para validar las notificaciones
     MP_SANDBOX          (opcional) "true" para usar el enlace de pruebas
     PUBLIC_URL          URL pública de tu app, ej. https://bugs-delivery.onrender.com
                         (en Render se detecta sola con RENDER_EXTERNAL_URL)
     BREVO_API_KEY       API key de Brevo (correos). Render gratis bloquea SMTP, por eso se usa la API.
     MAIL_FROM           correo remitente verificado en Brevo
     MAIL_FROM_NAME      (opcional) nombre del remitente, por defecto "LOS BUGS DELIVERY"
*/
const crypto = require('crypto');

const MP_API = 'https://api.mercadopago.com';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '$' + Number(n || 0).toFixed(2);

module.exports = function montarPagos(app, db, wrap) {
    const mpToken = () => process.env.MP_ACCESS_TOKEN || '';

    function baseUrl(req) {
        const fija = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
        if (fija) return fija.replace(/\/+$/, '');
        if (!req) return '';
        const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0];
        return `${proto}://${req.get('host')}`;
    }

    // ------------------------------------------------------------
    // Correo de confirmación (Brevo, por API HTTP)
    // ------------------------------------------------------------
    function plantillaCorreo(p, items, base) {
        const tarjeta = p.metodo_pago === 'Tarjeta';
        const filas = items.map((it) => `
            <tr>
              <td style="padding:10px 0;border-bottom:1px solid #FCE3E8;color:#2B0710;">${esc(it.cantidad)} × ${esc(it.nombre)}</td>
              <td style="padding:10px 0;border-bottom:1px solid #FCE3E8;color:#2B0710;text-align:right;">${money(it.precio_unitario * it.cantidad)}</td>
            </tr>`).join('');
        const pago = tarjeta
            ? `<p style="margin:0;font-size:15px;color:#2B0710;">💳 <b>Pago con tarjeta (Mercado Pago): aprobado ✅</b><br><span style="color:#7A4A56;">Folio de pago: ${esc(p.mp_payment_id || '—')}</span></p>`
            : `<p style="margin:0;font-size:15px;color:#2B0710;">💵 <b>Pago en efectivo contra entrega</b><br><span style="color:#7A4A56;">Pagarás <b>${money(p.total)} MXN</b> al recibir tu pedido.</span></p>`;
        const logo = base ? `<img src="${esc(base)}/icons/icon-192.png" width="84" height="84" alt="LOS BUGS" style="border-radius:20px;background:#fff;display:block;margin:0 auto 12px;">` : '';
        return `<!DOCTYPE html><html lang="es"><body style="margin:0;padding:0;background:#FCE3E8;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCE3E8;padding:24px 12px;"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:24px;overflow:hidden;">
    <tr><td style="background:#5C0F21;background-image:linear-gradient(160deg,#921733,#2B0710);padding:28px 20px;text-align:center;color:#ffffff;">
      ${logo}
      <div style="font-size:12px;letter-spacing:4px;color:#F2C98B;">DELIVERY DE COMIDA</div>
      <div style="font-size:28px;font-weight:bold;margin-top:6px;">LOS BUGS</div>
    </td></tr>
    <tr><td style="padding:26px 24px 8px;">
      <h1 style="margin:0 0 6px;font-size:22px;color:#5C0F21;">¡Gracias por tu pedido, ${esc(p.cliente_nombre)}! 🎉</h1>
      <p style="margin:0 0 18px;color:#7A4A56;font-size:15px;">Tu pedido <b>#${esc(p.id)}</b> fue confirmado y ya lo estamos preparando.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;">${filas}
        <tr><td style="padding:14px 0 4px;font-weight:bold;color:#5C0F21;">Total</td><td style="padding:14px 0 4px;text-align:right;font-weight:bold;color:#921733;font-size:18px;">${money(p.total)} MXN</td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:12px 24px;"><div style="background:#FCE3E8;border-radius:16px;padding:16px;">${pago}</div></td></tr>
    <tr><td style="padding:4px 24px 24px;"><p style="margin:0;color:#2B0710;font-size:15px;">📍 <b>Entrega en:</b><br><span style="color:#7A4A56;">${esc(p.direccion_entrega)}</span></p></td></tr>
    ${base ? `<tr><td style="padding:0 24px 28px;text-align:center;"><a href="${esc(base)}/cliente.html#pedidos" style="display:inline-block;background:#921733;color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 26px;border-radius:999px;">Ver mi pedido</a></td></tr>` : ''}
    <tr><td style="background:#2B0710;padding:16px;text-align:center;color:#F2A9B7;font-size:12px;">LOS BUGS DELIVERY · Tu antojo, hasta tu puerta.</td></tr>
  </table>
</td></tr></table></body></html>`;
    }

    async function enviarCorreoPedido(pedidoId, req) {
        if (!process.env.BREVO_API_KEY || !process.env.MAIL_FROM) {
            console.log('✉️  Correo no enviado: falta configurar BREVO_API_KEY y MAIL_FROM.');
            return { omitido: true };
        }
        // Marca como enviado ANTES (así una notificación repetida no manda dos correos)
        const [upd] = await db.query('UPDATE pedidos SET correo_enviado = 1 WHERE id = ? AND correo_enviado = 0', [pedidoId]);
        if (!upd.affectedRows) return { duplicado: true };
        try {
            const [rows] = await db.query(
                `SELECT p.*, u.nombre AS cliente_nombre, u.email AS cliente_email
                 FROM pedidos p JOIN usuarios u ON u.id = p.cliente_id WHERE p.id = ?`, [pedidoId]);
            if (!rows.length) throw new Error('Pedido no encontrado');
            const p = rows[0];
            const [items] = await db.query(
                `SELECT d.cantidad, d.precio_unitario, pr.nombre
                 FROM detalle_pedidos d JOIN productos pr ON pr.id = d.producto_id WHERE d.pedido_id = ?`, [pedidoId]);
            const tarjeta = p.metodo_pago === 'Tarjeta';
            const res = await fetch('https://api.brevo.com/v3/smtp/email', {
                method: 'POST',
                headers: { 'api-key': process.env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({
                    sender: { name: process.env.MAIL_FROM_NAME || 'LOS BUGS DELIVERY', email: process.env.MAIL_FROM },
                    to: [{ email: p.cliente_email, name: p.cliente_nombre }],
                    subject: `Pedido #${p.id} confirmado · ${tarjeta ? 'pago con tarjeta aprobado' : 'pagas en efectivo al recibir'}`,
                    htmlContent: plantillaCorreo(p, items, baseUrl(req))
                })
            });
            if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
            console.log(`✉️  Correo del pedido #${pedidoId} enviado a ${p.cliente_email}`);
            return { enviado: true };
        } catch (e) {
            await db.query('UPDATE pedidos SET correo_enviado = 0 WHERE id = ?', [pedidoId]).catch(() => {});
            console.error('❌ Correo:', e.message);
            return { error: e.message };
        }
    }

    // ------------------------------------------------------------
    // Mercado Pago
    // ------------------------------------------------------------
    // Crea el cobro y devuelve el enlace de pago de Mercado Pago
    app.post('/api/pagos/mercadopago', wrap(async (req, res) => {
        if (!mpToken()) return res.status(503).json({ error: 'Mercado Pago aún no está configurado (falta MP_ACCESS_TOKEN).' });
        const pedidoId = parseInt(req.body.pedido_id, 10);
        const [rows] = await db.query(
            `SELECT p.id, p.metodo_pago, p.pago_estado, u.nombre, u.email
             FROM pedidos p JOIN usuarios u ON u.id = p.cliente_id WHERE p.id = ?`, [pedidoId]);
        if (!rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });
        const ped = rows[0];
        if (ped.pago_estado === 'aprobado') return res.status(409).json({ error: 'Este pedido ya está pagado' });
        const [items] = await db.query(
            `SELECT d.cantidad, d.precio_unitario, pr.nombre
             FROM detalle_pedidos d JOIN productos pr ON pr.id = d.producto_id WHERE d.pedido_id = ?`, [pedidoId]);

        const base = baseUrl(req);
        const https = base.startsWith('https://');
        const body = {
            items: items.map((it) => ({ title: String(it.nombre).slice(0, 250), quantity: Number(it.cantidad), unit_price: Number(it.precio_unitario), currency_id: 'MXN' })),
            payer: { name: ped.nombre, email: ped.email },
            external_reference: String(pedidoId),
            statement_descriptor: 'LOS BUGS',
            binary_mode: true,
            payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }] },
            back_urls: { success: `${base}/pago.html`, failure: `${base}/pago.html`, pending: `${base}/pago.html` }
        };
        if (https) { body.auto_return = 'approved'; body.notification_url = `${base}/api/mp/webhook`; }

        const r = await fetch(`${MP_API}/checkout/preferences`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${mpToken()}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            console.error('❌ Mercado Pago (preferencia):', r.status, JSON.stringify(data).slice(0, 300));
            return res.status(502).json({ error: 'Mercado Pago rechazó la solicitud. Revisa el Access Token y que la URL sea https.' });
        }
        const url = process.env.MP_SANDBOX === 'true' ? (data.sandbox_init_point || data.init_point) : data.init_point;
        res.json({ init_point: url, preference_id: data.id });
    }));

    // Consulta el pago directo a Mercado Pago (así nadie puede "fingir" un pago) y actualiza el pedido
    async function procesarPago(paymentId, req) {
        const r = await fetch(`${MP_API}/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { Authorization: `Bearer ${mpToken()}` } });
        if (!r.ok) throw new Error(`Mercado Pago respondió ${r.status} al consultar el pago ${paymentId}`);
        const pago = await r.json();
        const pedidoId = parseInt(pago.external_reference, 10);
        if (!pedidoId) return { ignorado: true };
        const [rows] = await db.query('SELECT id, total, pago_estado FROM pedidos WHERE id = ?', [pedidoId]);
        if (!rows.length) return { ignorado: true };
        const ped = rows[0];

        let estado = 'pendiente';
        if (pago.status === 'approved') estado = 'aprobado';
        else if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(pago.status)) estado = 'rechazado';

        if (estado === 'aprobado' && Number(pago.transaction_amount) + 0.01 < Number(ped.total)) {
            console.error(`⚠️ Pago ${paymentId} por monto menor al pedido #${pedidoId}; no se marca como pagado.`);
            return { pedido_id: pedidoId, estado: 'monto_invalido' };
        }
        if (ped.pago_estado !== 'aprobado') {
            await db.query('UPDATE pedidos SET pago_estado = ?, mp_payment_id = ? WHERE id = ? AND pago_estado <> ?',
                [estado, String(paymentId), pedidoId, 'aprobado']);
        }
        if (estado === 'aprobado') await enviarCorreoPedido(pedidoId, req);
        const [fin] = await db.query('SELECT pago_estado FROM pedidos WHERE id = ?', [pedidoId]);
        return { pedido_id: pedidoId, estado: fin[0] ? fin[0].pago_estado : estado };
    }

    function firmaValida(req, dataId) {
        const secret = process.env.MP_WEBHOOK_SECRET;
        if (!secret) return true; // sin clave: igual se confirma consultando a Mercado Pago
        const sig = String(req.headers['x-signature'] || '');
        const ts = (sig.match(/ts=([^,]+)/) || [])[1];
        const v1 = (sig.match(/v1=([^,]+)/) || [])[1];
        if (!ts || !v1) return false;
        let manifest = '';
        if (dataId) manifest += `id:${String(dataId).toLowerCase()};`;
        if (req.headers['x-request-id']) manifest += `request-id:${req.headers['x-request-id']};`;
        manifest += `ts:${ts};`;
        const calc = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
        try { return crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(v1)); } catch { return false; }
    }

    // Aviso automático de Mercado Pago (webhook)
    app.post('/api/mp/webhook', (req, res) => {
        const q = req.query || {};
        const b = req.body || {};
        const tipo = q.type || q.topic || b.type || b.topic;
        const dataId = q['data.id'] || (b.data && b.data.id) || q.id;
        if (!firmaValida(req, dataId)) return res.sendStatus(401);
        res.sendStatus(200); // responder rápido; el resto se procesa después
        if (tipo !== 'payment' || !dataId || !mpToken()) return;
        procesarPago(dataId, req).catch((e) => console.error('❌ Webhook MP:', e.message));
    });

    // La página de regreso (pago.html) llama aquí para confirmar sin esperar el webhook
    app.get('/api/pagos/verificar', wrap(async (req, res) => {
        const paymentId = req.query.payment_id || req.query.collection_id;
        if (!paymentId || !mpToken()) return res.status(400).json({ error: 'Falta el número de pago' });
        res.json(await procesarPago(paymentId, req));
    }));

    app.get('/api/pedidos/:id/pago', wrap(async (req, res) => {
        const [rows] = await db.query('SELECT id, metodo_pago, pago_estado, total FROM pedidos WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });
        res.json(rows[0]);
    }));

    return {
        // Se llama cuando se crea un pedido: en efectivo manda el correo de inmediato.
        // En tarjeta el correo sale hasta que Mercado Pago confirme el pago.
        pedidoCreado(pedidoId, metodo, req) {
            if (metodo !== 'Tarjeta') enviarCorreoPedido(pedidoId, req).catch(() => {});
        }
    };
};
