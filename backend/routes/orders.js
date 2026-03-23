// ===== ROUTES COMMANDES — Client =====
const express = require('express');
const supabase = require('../lib/supabase');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// === POST /api/orders ===
// Créer une nouvelle commande
// Body : { items: [...], total: number, note?: string }
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { items, total, note } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Le panier est vide' });
    }
    if (!total || total <= 0) {
      return res.status(400).json({ error: 'Total invalide' });
    }

    // Calculer les points gagnés (1 EUR = 4 Beanz)
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
