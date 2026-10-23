require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { generateQRCode } = require('./utils/qrGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Inicializar cliente de Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// Configurar Nodemailer para envío de correos
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false, // true para 465, false para otros puertos
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ==========================================
// ENDPOINT 1: Login para el panel de administración/registro
// ==========================================
app.post('/api/admin-login', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Introduce la contraseña.' });
  }

  // Usa ADMIN_PASSWORD de .env (o 'admin2026' por defecto)
  const correctPassword = process.env.ADMIN_PASSWORD || 'admin2026';

  if (password === correctPassword) {
    return res.status(200).json({ success: true, message: 'Acceso autorizado' });
  } else {
    return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
  }
});

// ==========================================
// ENDPOINT 2: Login de seguridad para el escáner de la puerta
// ==========================================
app.post('/api/scanner-login', (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Introduce la contraseña.' });
  }

  // Compara con la variable DOOR_PASSWORD de .env (o 'fiesta2026' por defecto)
  const correctPassword = process.env.DOOR_PASSWORD || 'fiesta2026';

  if (password === correctPassword) {
    return res.status(200).json({ success: true, message: 'Acceso autorizado' });
  } else {
    return res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
  }
});

// ==========================================
// ENDPOINT 3: Registrar asistente, guardar en Supabase y enviar correo
// ==========================================
app.post('/api/guests', async (req, res) => {
  try {
    const { name, email, instagram, public_consent } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: 'El nombre y el correo electrónico son obligatorios.' });
    }

    // 1. Generar ID único (UUID) y QR
    const guestId = crypto.randomUUID();
    const qrDataUrl = await generateQRCode(guestId);

    // 2. Asignar avatar de DiceBear si hay consentimiento e Instagram
    let avatarUrl = '';
    const consentInt = public_consent ? 1 : 0;
    
    if (consentInt && instagram) {
      const cleanIg = instagram.replace('@', '').trim();
      avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(cleanIg)}`;
    } else {
      avatarUrl = `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(name)}`;
    }

    // 3. Guardar en la base de datos de Supabase
    const { data: insertedData, error: dbError } = await supabase
      .from('guests')
      .insert([
        {
          id: guestId,
          name: name,
          email: email,
          instagram: instagram || '',
          public_consent: consentInt,
          avatar_url: avatarUrl,
          ticket_status: 'VALID'
        }
      ])
      .select();

    if (dbError) {
      console.error('❌ ERROR AL GUARDAR EN SUPABASE:', JSON.stringify(dbError, null, 2));
      return res.status(500).json({ error: `Error en Base de Datos: ${dbError.message}` });
    }

    console.log('✅ GUARDADO EN SUPABASE CON ÉXITO:', insertedData);

    // Sección opcional de Instagram/Avatar para el correo
    let instagramSection = '';
    if (consentInt && instagram) {
      instagramSection = `
        <div style="text-align: center; margin-top: 20px;">
          <p>¡Tu personaje en la pista de baile ha sido asignado con tu cuenta <strong>${instagram}</strong>!</p>
          <img src="${avatarUrl}" alt="Tu Avatar" style="width: 80px; height: 80px; background: #333; border-radius: 50%; padding: 5px;" />
        </div>
      `;
    }

    // 4. Enviar correo electrónico con la entrada adjunta
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: '🎟️ ¡Tu entrada para la Fiesta Privada!',
      html: `
        <div style="font-family: Arial, sans-serif; background-color: #121212; color: #ffffff; padding: 20px; border-radius: 10px;">
          <h1 style="color: #ff007f; text-align: center;">¡Estás dentro, ${name}!</h1>
          <p style="text-align: center;">Tu pago en efectivo ha sido registrado con éxito. Aquí tienes tu entrada oficial con código QR.</p>
          
          <div style="text-align: center; background: #1e1e1e; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <img src="cid:qrcodeimage" alt="Código QR de Entrada" style="width: 200px; height: 200px; background: white; padding: 10px; border-radius: 8px;" />
            <p style="margin-top: 10px; font-size: 12px; color: #aaa;">ID de entrada: ${guestId}</p>
          </div>

          ${instagramSection}

          <p style="text-align: center; font-size: 12px; color: #666; margin-top: 30px;">Presenta este código QR en la entrada del evento. ¡Nos vemos en la pista!</p>
        </div>
      `,
      attachments: [
        {
          filename: 'qr-entrada.png',
          content: qrDataUrl.split(';base64,').pop(),
          encoding: 'base64',
          cid: 'qrcodeimage'
        }
      ]
    };

    try {
      await transporter.sendMail(mailOptions);
      console.log(`📧 Correo enviado exitosamente a ${email}`);
    } catch (mailError) {
      console.error('⚠️ Advertencia: No se pudo enviar el correo:', mailError.message);
    }

    res.status(201).json({
      success: true,
      message: 'Asistente registrado en Supabase y entrada enviada correctamente.',
      guestId,
      avatarUrl
    });

  } catch (error) {
    console.error('Error general en el servidor:', error);
    res.status(500).json({ error: 'Error en el servidor.' });
  }
});

// ==========================================
// ENDPOINT 4: Escanear y validar entrada en puerta
// ==========================================
app.post('/api/guests/scan', async (req, res) => {
  try {
    const { guestId } = req.body;

    if (!guestId) {
      return res.status(400).json({ success: false, message: 'ID de entrada no proporcionado.' });
    }

    // 1. Buscar al invitado en Supabase
    const { data: guest, error } = await supabase
      .from('guests')
      .select('*')
      .eq('id', guestId)
      .single();

    if (error || !guest) {
      return res.status(404).json({
        success: false,
        message: '❌ Entrada NO válida o no encontrada en el sistema.'
      });
    }

    // 2. Verificar si la entrada ya fue utilizada
    if (guest.ticket_status === 'USED') {
      return res.status(400).json({
        success: false,
        message: `⚠️ ¡ENTRADA YA USADA! Se usó a las: ${new Date(guest.used_at).toLocaleTimeString()}`,
        guest
      });
    }

    // 3. Marcar entrada como USADA (USED)
    const now = new Date().toISOString();
    const { error: updateError } = await supabase
      .from('guests')
      .update({ ticket_status: 'USED', used_at: now })
      .eq('id', guestId);

    if (updateError) {
      return res.status(500).json({ success: false, message: 'Error al actualizar la entrada.' });
    }

    // 4. Acceso concedido
    return res.status(200).json({
      success: true,
      message: '✅ ¡ACCESO PERMITIDO! Entrada válida.',
      guest
    });

  } catch (err) {
    console.error('Error en el escaneo:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
});

// Ruta de salud
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Servidor conectado a Supabase funcionando' });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});

// ==========================================
// ENDPOINT: Obtener asistentes para la pista de baile (Corregido)
// ==========================================
app.get('/api/guests/dancefloor', async (req, res) => {
  try {
    const { data: guests, error } = await supabase
      .from('guests')
      .select('id, name, instagram, avatar_url, ticket_status')
      .order('id', { ascending: false }); // Ordenamos por ID para evitar el error de created_at

    if (error) {
      console.error('❌ Error Supabase:', error.message);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, guests: guests || [] });
  } catch (err) {
    console.error('❌ Error servidor:', err);
    res.status(500).json({ success: false, error: 'Error al cargar la pista de baile' });
  }
});