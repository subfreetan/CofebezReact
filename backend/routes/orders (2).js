// ===== ROUTES COMMANDES — Client + Stripe =====
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const router = express.Router();

// URL du frontend (pour les redirections Stripe)
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://cofebezreact.vercel.app';

// === POST /api/orders/create-payment-intent ===
// Crée un PaymentIntent pour Apple Pay / Google Pay (Payment Request API)
// Body : { items: [...], total: number, note?: string }
router.post('/create-payment-intent', authMiddleware, async (req, res) => {
  try {
    const { items, total, note } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Le panier est vide' });
    }
    if (!total || total <= 0) {
      return res.status(400).json({ error: 'Total invalide' });
    }

    const pointsEarned = Math.floor(total * 4);

    // Créer le PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100), // Stripe veut des centimes
      currency: 'eur',
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        userId: req.user.userId,
        items: JSON.stringify(items),
        total: total.toString(),
        note: note || '',
        pointsEarned: pointsEarned.toString()
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id
    });

  } catch (err) {
    console.error('Erreur création PaymentIntent:', err);
    res.status(500).json({ error: 'Erreur lors de la création du paiement' });
  }
});

// === POST /api/orders/checkout ===
// Crée une session de paiement Stripe (pour Bancontact ou recharge wallet)
// Body : { items: [...], total: number, note?: string, paymentMethod: string, isWalletRecharge?: boolean }
router.post('/checkout', authMiddleware, async (req, res) => {
  try {
    const { items, total, note, paymentMethod, isWalletRecharge } = req.body;

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
          description: isWalletRecharge ? 'Recharge du portefeuille BEANZ' : ([
            item.size ? `Taille: ${item.size}` : null,
            item.milk ? `Lait: ${item.milk}` : null,
            item.subcategory || null
          ].filter(Boolean).join(' · ') || 'Article BEANZ')
        },
        unit_amount: Math.round((item.price / item.quantity) * 100)
      },
      quantity: item.quantity
    }));

    // URL de retour selon le type de transaction
    const successUrl = isWalletRecharge 
      ? FRONTEND_URL + '/index.html?wallet_recharge=success'
      : FRONTEND_URL + '/index.html?payment=success&session_id={CHECKOUT_SESSION_ID}';

    // Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      payment_method_types: stripePaymentTypes,
      line_items: lineItems,
      mode: 'payment',
      success_url: successUrl,
      cancel_url: FRONTEND_URL + '/index.html?payment=cancel',
      metadata: {
        userId: req.user.userId,
        items: JSON.stringify(items),
        total: total.toString(),
        note: note || '',
        pointsEarned: isWalletRecharge ? '0' : Math.floor(total * 4).toString(),
        isWalletRecharge: isWalletRecharge ? 'true' : 'false'
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

  // Traiter les événements de paiement réussi
  if (event.type === 'checkout.session.completed') {
    // Paiement via Stripe Checkout (Bancontact)
    const session = event.data.object;
    const metadata = session.metadata;

    try {
      const items = JSON.parse(metadata.items);
      const total = parseFloat(metadata.total);

      // Vérifier si c'est une recharge de wallet
      if (metadata.isWalletRecharge === 'true') {
        // Recharger le wallet de l'utilisateur
        const { data: user } = await supabase
          .from('users')
          .select('eur_balance')
          .eq('id', metadata.userId)
          .single();

        const currentBalance = user?.eur_balance || 0;
        const newBalance = currentBalance + total;

        await supabase
          .from('users')
          .update({ eur_balance: newBalance })
          .eq('id', metadata.userId);

        console.log('✅ Wallet rechargé pour user:', metadata.userId, '- Nouveau solde:', newBalance);
      } else {
        // Créer une commande normale
        const pointsEarned = parseInt(metadata.pointsEarned);

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

        console.log('✅ Commande créée après Checkout Session pour user:', metadata.userId);
      }
    } catch (err) {
      console.error('Erreur création commande post-checkout:', err);
    }
  }

  if (event.type === 'payment_intent.succeeded') {
    // Paiement via PaymentIntent (Apple Pay / Google Pay)
    const paymentIntent = event.data.object;
    const metadata = paymentIntent.metadata;

    // Vérifier qu'on a bien les metadata (pour éviter de traiter d'autres PaymentIntents)
    if (metadata && metadata.userId && metadata.items) {
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

        console.log('✅ Commande créée après PaymentIntent pour user:', metadata.userId);
      } catch (err) {
        console.error('Erreur création commande post-payment-intent:', err);
      }
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

// === POST /api/orders/pay-with-wallet ===
// Payer une commande avec le solde du wallet
// Body : { items: [...], total: number }
router.post('/pay-with-wallet', authMiddleware, async (req, res) => {
  try {
    const { items, total } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Le panier est vide' });
    }
    if (!total || total <= 0) {
      return res.status(400).json({ error: 'Total invalide' });
    }

    // Récupérer l'utilisateur pour vérifier son solde
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('eur_balance')
      .eq('id', req.user.userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ error: 'Utilisateur non trouvé' });
    }

    const currentBalance = user.eur_balance || 0;

    if (currentBalance < total) {
      return res.status(400).json({ error: 'Solde insuffisant' });
    }

    // Calculer le nouveau solde et les points gagnés
    const newBalance = currentBalance - total;
    const pointsEarned = Math.floor(total * 4);

    // Mettre à jour le solde de l'utilisateur
    const { error: updateError } = await supabase
      .from('users')
      .update({ eur_balance: newBalance })
      .eq('id', req.user.userId);

    if (updateError) {
      console.error('Erreur mise à jour solde:', updateError);
      return res.status(500).json({ error: 'Erreur lors du paiement' });
    }

    // Créer la commande
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: req.user.userId,
        items: items,
        total: total,
        note: 'Payé avec Wallet',
        status: 'pending',
        points_earned: pointsEarned
      })
      .select()
      .single();

    if (orderError) {
      // Rollback : remettre le solde
      await supabase
        .from('users')
        .update({ eur_balance: currentBalance })
        .eq('id', req.user.userId);

      console.error('Erreur création commande:', orderError);
      return res.status(500).json({ error: 'Erreur lors de la création de la commande' });
    }

    console.log('✅ Commande créée avec Wallet pour user:', req.user.userId, '- Nouveau solde:', newBalance);

    res.json({ 
      order, 
      newBalance,
      pointsEarned 
    });

  } catch (err) {
    console.error('Erreur pay-with-wallet:', err);
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
