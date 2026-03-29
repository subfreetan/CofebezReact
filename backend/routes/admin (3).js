// ===== ROUTES ADMIN =====
const express = require('express');
const supabase = require('../lib/supabase');
const { adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// === GET /api/admin/orders ===
// Toutes les commandes (filtrable par statut)
// Query : ?status=pending|confirmed|preparing|ready|collected
router.get('/orders', adminMiddleware, async (req, res) => {
  try {
    let query = supabase
      .from('orders')
      .select('*, users!inner(prenom, pseudo, card_number)')
      .order('created_at', { ascending: false });

    // Filtre par statut si demandé
    if (req.query.status) {
      query = query.eq('status', req.query.status);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Erreur admin orders:', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }

    res.json({ orders: orders || [] });

  } catch (err) {
    console.error('Erreur admin orders:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === PUT /api/admin/orders/:id/status ===
// Changer le statut d'une commande
// Body : { status: 'confirmed'|'preparing'|'ready'|'collected' }
// Si statut passe à 'confirmed' → les points sont ajoutés au client
router.put('/orders/:id/status', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['confirmed', 'preparing', 'ready', 'collected'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    // Récupérer la commande
    const { data: order, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (!order) {
      return res.status(404).json({ error: 'Commande non trouvée' });
    }

    // Si on confirme la commande → ajouter les points au client
    if (status === 'confirmed' && order.status === 'pending') {
      const { error: pointsError } = await supabase.rpc('add_points', {
        user_id_param: order.user_id,
        points_to_add: order.points_earned
      });

      // Fallback si la fonction RPC n'existe pas : update direct
      if (pointsError) {
        const { data: user } = await supabase
          .from('users')
          .select('points, lifetime_points')
          .eq('id', order.user_id)
          .single();

        if (user) {
          const newPoints = (user.points || 0) + order.points_earned;
          const newLifetimePoints = (user.lifetime_points || 0) + order.points_earned;
          
          await supabase
            .from('users')
            .update({ 
              points: newPoints,
              lifetime_points: newLifetimePoints
            })
            .eq('id', order.user_id);
        }
      }
    }

    // Mettre à jour le statut
    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({ status: status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select('*, users!inner(prenom, pseudo, card_number)')
      .single();

    if (updateError) {
      console.error('Erreur update statut:', updateError);
      return res.status(500).json({ error: 'Erreur lors de la mise à jour' });
    }

    res.json({ order: updated });

  } catch (err) {
    console.error('Erreur update statut:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === POST /api/admin/orders/instore ===
// Créer une commande sur place (client présent au comptoir)
// Body : { userId, items: [...], total }
// La commande est directement marquée "collected" et les points sont ajoutés
router.post('/orders/instore', adminMiddleware, async (req, res) => {
  try {
    const { userId, items, total } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'userId requis' });
    }
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Le panier est vide' });
    }
    if (!total || total <= 0) {
      return res.status(400).json({ error: 'Total invalide' });
    }

    // Calculer les points (4 pts par EUR)
    const pointsEarned = Math.floor(total * 4);

    // Créer la commande avec statut "collected" (déjà récupérée)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        user_id: userId,
        items: items,
        total: total,
        note: 'Commande sur place',
        status: 'collected',
        points_earned: pointsEarned
      })
      .select()
      .single();

    if (orderError) {
      console.error('Erreur création commande instore:', orderError);
      return res.status(500).json({ error: 'Erreur lors de la création de la commande' });
    }

    // Ajouter les points au client (solde + lifetime)
    const { data: user } = await supabase
      .from('users')
      .select('points, lifetime_points')
      .eq('id', userId)
      .single();

    if (user) {
      const newPoints = (user.points || 0) + pointsEarned;
      const newLifetimePoints = (user.lifetime_points || 0) + pointsEarned;
      
      await supabase
        .from('users')
        .update({ 
          points: newPoints,
          lifetime_points: newLifetimePoints
        })
        .eq('id', userId);
    }

    console.log('✅ Commande sur place créée pour user:', userId, '| Points ajoutés:', pointsEarned);

    res.status(201).json({ 
      order,
      pointsEarned,
      newBalance: user ? (user.points || 0) + pointsEarned : pointsEarned
    });

  } catch (err) {
    console.error('Erreur commande instore:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === POST /api/admin/scan ===
// Scanner le QR code d'un client → retourne ses infos + commandes actives
// Body : { userId: string, pseudo: string }
router.post('/scan', adminMiddleware, async (req, res) => {
  try {
    const { userId, pseudo } = req.body;

    if (!userId && !pseudo) {
      return res.status(400).json({ error: 'userId ou pseudo requis' });
    }

    // Chercher le client
    let query = supabase.from('users').select('*');
    if (userId) query = query.eq('id', userId);
    else query = query.eq('pseudo', pseudo);

    const { data: user, error: userError } = await query.single();

    if (!user) {
      return res.status(404).json({ error: 'Client non trouvé' });
    }

    // Récupérer ses commandes actives (pas collected)
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['pending', 'confirmed', 'preparing', 'ready'])
      .order('created_at', { ascending: false });

    res.json({
      client: {
        id: user.id,
        prenom: user.prenom,
        pseudo: user.pseudo,
        points: user.points,
        card_number: user.card_number,
        member_since: user.member_since
      },
      orders: orders || []
    });

  } catch (err) {
    console.error('Erreur scan:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === GET /api/admin/orders/history ===
// Historique des commandes pour les stats (par année)
// Query : ?year=2026
router.get('/orders/history', adminMiddleware, async (req, res) => {
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const startDate = `${year}-01-01T00:00:00.000Z`;
    const endDate = `${year}-12-31T23:59:59.999Z`;

    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, created_at, total, status, items, points_earned, payment_method, points_spent')
      .gte('created_at', startDate)
      .lte('created_at', endDate)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Erreur history:', error);
      return res.status(500).json({ error: 'Erreur serveur' });
    }

    res.json({ orders: orders || [] });

  } catch (err) {
    console.error('Erreur history:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// === GET /api/admin/notifications ===
// Récupérer les notifications actives
router.get('/notifications', async (req, res) => {
  try {
    const { data: notifications, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('active', true)
      .order('created_at', { ascending: false });

    res.json({ notifications: notifications || [] });
  } catch (err) {
    res.json({ notifications: [] });
  }
});

// === GET /api/admin/events ===
// Récupérer les événements actifs
router.get('/events', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data: events, error } = await supabase
      .from('events')
      .select('*')
      .lte('start_date', today)
      .gte('end_date', today)
      .order('created_at', { ascending: false });

    res.json({ events: events || [] });
  } catch (err) {
    res.json({ events: [] });
  }
});

module.exports = router;
