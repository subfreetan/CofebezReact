// ===== ROUTES COMMANDES — Client + Stripe =====
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// URL du frontend (pour les redirections Stripe)
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://cofebezreact.vercel.app';

// === POST /api/orders/checkout ===
// Crée une session de paiement Stripe
// Body : { items: [...], total: number, note?: string, paymentMethod: string }
router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const { items, total, note, paymentMethod } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Le panier est vide' });
    }
    if (!total || total <= 0) {
      return res.status(400).json({ error: 'Total invalide' });
    }

    // Mapper le choix du client vers les types Stripe
    const methodMap = {
      'bancontact': ['bancontact'],
      'apple_pay': ['card'],   // Apple Pay passe par le type 'card' dans Stripe
      'google_pay': ['card'],  // Google Pay aussi — Stripe les gère via le wallet
      'card': ['card']
    };
    const stripePaymentTypes = methodMap[paymentMethod] || ['card'];

    // Créer les line_items pour Stripe
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name,
          description: [
            item.size ? `Taille: ${item.size}` : null,
            item.milk ? `Lait: ${item.milk}` : null,
            item.subcategory || null
          ].filter(Boolean).join(' · ') || 'Article BEANZ'
        },
        unit_amount: Math.round((item.price / item.quantity) * 100)
      },
      quantity: item.quantity
    }));

    // Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: stripePaymentTypes,
      line_items: lineItems,
      mode: 'payment',
      success_url: FRONTEND_URL + '/index.html?payment=success&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: FRONTEND_URL + '/index.html?payment=cancel',
      metadata: {
        userId: req.user.userId,
        items: JSON.stringify(items),
        total: total.toString(),
        note: note || '',
        pointsEarned: Math.floor(total * 4).toString()
      }
    });

    res.json({ url: session.url });

  } catch (err) {
    console.error('Erreur Stripe checkout:', err);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// === POST /api/orders/webhook ===
// Stripe envoie une notification quand le paiement est confirmé
// Le body est brut (pas JSON) — géré par server.js
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    if (webhookSecret) {
      // En production : vérifier la signature Stripe
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // En dev sans webhook secret : parser directement
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Erreur webhook signature:', err.message);
    return res.status(400).json({ error: 'Signature invalide' });
  }

  // Traiter l'événement de paiement réussi
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;

    try {
      const items = JSON.parse(metadata.items);
      const total = parseFloat(metadata.total);
      const pointsEarned = parseInt(metadata.pointsEarned);

      // Créer la commande en base
      await supabase
        .from('orders')
        .insert({
          user_id: metadata.userId,
          items: items,
          total: total,
          note: metadata.note || null,
          status: 'pending',
          points_earned: pointsEarned
        });

      console.log('✅ Commande créée après paiement Stripe pour user:', metadata.userId);
    } catch (err) {
      console.error('Erreur création commande post-paiement:', err);
    }
  }

  res.json({ received: true });
});

// === POST /api/orders ===
// Créer une commande directement (sans paiement, pour les commandes en caisse)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { items, total, note } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Le panier est vide' });
    }
    if (!total || total <= 0) {
      return res.status(400).json({ error: 'Total invalide' });
    }

    const pointsEarned = Math.floor(total * 4);

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        user_id: req.user.userId,
        items: items,
        total: total,
        note: note || null,
        status: 'pending',
        points_earned: pointsEarned
      })
      .select()
      .single();

    if (error) {
      console.error('Erreur création commande:', error);
      return res.status(500).json({ error: 'Erreur lors de la création de la commande' });
    }

    res.status(201).json({ order });

  } catch (err) {
    console.error('Erreur commande:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === GET /api/orders ===
// Récupérer les commandes de l'utilisateur connecté
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', req.user.userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur récupération commandes:', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }

    res.json({ orders: orders || [] });

  } catch (err) {
    console.error('Erreur commandes:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === GET /api/orders/:id ===
// Récupérer une commande par son ID
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.user.userId)
      .single();

    if (!order) {
      return res.status(404).json({ error: 'Commande non trouvée' });
    }

    res.json({ order });

  } catch (err) {
    console.error('Erreur commande:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
