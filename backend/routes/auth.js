// ===== ROUTES AUTH — Inscription & Connexion =====
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// === POST /api/auth/inscription ===
// Body : { prenom, pseudo, password }
// Retourne : { token, user }
router.post('/inscription', async (req, res) => {
  try {
    const { prenom, pseudo, password } = req.body;

    // Validation des champs
    if (!prenom || !pseudo || !password) {
      return res.status(400).json({ error: 'Prénom, pseudo et mot de passe requis' });
    }
    if (pseudo.length < 3) {
      return res.status(400).json({ error: 'Le pseudo doit faire au moins 3 caractères' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit faire au moins 6 caractères' });
    }

    // Vérifier que le pseudo n'existe pas déjà
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('pseudo', pseudo.toLowerCase())
      .single();

    if (existing) {
      return res.status(409).json({ error: 'Ce pseudo est déjà pris' });
    }

    // Hasher le mot de passe (on ne stocke jamais le mot de passe en clair)
    const hashedPassword = await bcrypt.hash(password, 10);

    // Générer un numéro de carte unique (format BEANZ)
    const cardNumber = generateCardNumber();

    // Générer le QR code unique (contient l'ID qu'on mettra à jour après insertion)
    // On insère d'abord, puis on génère le QR avec l'ID

    // Insérer l'utilisateur en base
    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        prenom: prenom.trim(),
        pseudo: pseudo.toLowerCase().trim(),
        password: hashedPassword,
        card_number: cardNumber,
        points: 0,
        eur_balance: 0,
        free_coffee: 0,
        role: 'client',
        member_since: new Date().toLocaleDateString('fr-FR', { month: '2-digit', year: '2-digit' })
      })
      .select()
      .single();

    if (error) {
      console.error('Erreur insertion:', error);
      return res.status(500).json({ error: 'Erreur lors de la création du compte' });
    }

    // Générer le QR code avec l'ID utilisateur
    const qrData = JSON.stringify({ userId: newUser.id, pseudo: newUser.pseudo });
    const qrCodeUrl = await QRCode.toDataURL(qrData, { width: 300, margin: 2 });

    // Mettre à jour le QR code en base
    await supabase
      .from('users')
      .update({ qr_code: qrCodeUrl })
      .eq('id', newUser.id);

    // Créer le JWT
    const token = jwt.sign(
      { userId: newUser.id, pseudo: newUser.pseudo, role: newUser.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    // Répondre avec le token et les infos user (sans le mot de passe)
    res.status(201).json({
      token,
      user: {
        id: newUser.id,
        prenom: newUser.prenom,
        pseudo: newUser.pseudo,
        points: newUser.points,
        eur_balance: newUser.eur_balance,
        free_coffee: newUser.free_coffee,
        card_number: newUser.card_number,
        member_since: newUser.member_since,
        qr_code: qrCodeUrl
      }
    });

  } catch (err) {
    console.error('Erreur inscription:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === POST /api/auth/connexion ===
// Body : { pseudo, password }
// Retourne : { token, user }
router.post('/connexion', async (req, res) => {
  try {
    const { pseudo, password } = req.body;

    if (!pseudo || !password) {
      return res.status(400).json({ error: 'Pseudo et mot de passe requis' });
    }

    // Chercher l'utilisateur par pseudo
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('pseudo', pseudo.toLowerCase().trim())
      .single();

    if (!user) {
      return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
    }

    // Vérifier le mot de passe
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Pseudo ou mot de passe incorrect' });
    }

    // Créer le JWT
    const token = jwt.sign(
      { userId: user.id, pseudo: user.pseudo, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        prenom: user.prenom,
        pseudo: user.pseudo,
        points: user.points,
        eur_balance: user.eur_balance,
        free_coffee: user.free_coffee,
        card_number: user.card_number,
        member_since: user.member_since,
        qr_code: user.qr_code,
        last_name: user.last_name || '',
        email: user.email || '',
        phone: user.phone || '',
        birth_date: user.birth_date || '',
        gender: user.gender || 'Préfère ne pas dire',
        nationality: user.nationality || 'Préfère ne pas dire',
        consent_sms: user.consent_sms !== false,
        consent_email: user.consent_email !== false,
        card_visual: user.card_visual || 'carte_fete_2.png'
      }
    });

  } catch (err) {
    console.error('Erreur connexion:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === GET /api/auth/profil ===
// Header : Authorization: Bearer <token>
// Retourne les infos à jour de l'utilisateur
router.get('/profil', authMiddleware, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.user.userId)
      .single();

    if (!user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    res.json({
      user: {
        id: user.id,
        prenom: user.prenom,
        pseudo: user.pseudo,
        points: user.points,
        eur_balance: user.eur_balance,
        free_coffee: user.free_coffee,
        card_number: user.card_number,
        member_since: user.member_since,
        qr_code: user.qr_code,
        last_name: user.last_name || '',
        email: user.email || '',
        phone: user.phone || '',
        birth_date: user.birth_date || '',
        gender: user.gender || 'Préfère ne pas dire',
        nationality: user.nationality || 'Préfère ne pas dire',
        consent_sms: user.consent_sms !== false,
        consent_email: user.consent_email !== false,
        card_visual: user.card_visual || 'carte_fete_2.png'
      }
    });

  } catch (err) {
    console.error('Erreur profil:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === PUT /api/auth/profil ===
// Met à jour les informations personnelles
router.put('/profil', authMiddleware, async (req, res) => {
  try {
    const { prenom, last_name, email, phone, birth_date, gender, nationality, consent_sms, consent_email, card_visual } = req.body;

    // Construire l'objet de mise à jour (uniquement les champs envoyés)
    const updates = {};
    if (prenom !== undefined) updates.prenom = prenom.trim();
    if (last_name !== undefined) updates.last_name = last_name.trim();
    if (email !== undefined) updates.email = email.trim();
    if (phone !== undefined) updates.phone = phone.trim();
    if (birth_date !== undefined) updates.birth_date = birth_date;
    if (gender !== undefined) updates.gender = gender;
    if (nationality !== undefined) updates.nationality = nationality;
    if (consent_sms !== undefined) updates.consent_sms = consent_sms;
    if (consent_email !== undefined) updates.consent_email = consent_email;
    if (card_visual !== undefined) updates.card_visual = card_visual;

    const { data: updated, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', req.user.userId)
      .select()
      .single();

    if (error) {
      console.error('Erreur update profil:', error);
      return res.status(500).json({ error: 'Erreur lors de la mise à jour' });
    }

    res.json({
      user: {
        id: updated.id,
        prenom: updated.prenom,
        pseudo: updated.pseudo,
        points: updated.points,
        eur_balance: updated.eur_balance,
        free_coffee: updated.free_coffee,
        card_number: updated.card_number,
        member_since: updated.member_since,
        qr_code: updated.qr_code,
        last_name: updated.last_name || '',
        email: updated.email || '',
        phone: updated.phone || '',
        birth_date: updated.birth_date || '',
        gender: updated.gender || 'Préfère ne pas dire',
        nationality: updated.nationality || 'Préfère ne pas dire',
        consent_sms: updated.consent_sms !== false,
        consent_email: updated.consent_email !== false,
        card_visual: updated.card_visual || 'carte_fete_2.png'
      }
    });

  } catch (err) {
    console.error('Erreur update profil:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === HELPER — Génère un numéro de carte BEANZ ===
function generateCardNumber() {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(String(Math.floor(1000 + Math.random() * 9000)));
  }
  return segments.join(' ');
}

module.exports = router;
