// ===== BEANZ COFFEE — SERVEUR API =====
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const orderRoutes = require('./routes/orders');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// === MIDDLEWARE ===
app.use(cors());

// Stripe webhook a besoin du body brut (pas JSON parsé)
// On le place AVANT express.json()
app.post('/api/orders/webhook', express.raw({ type: 'application/json' }));

// Pour toutes les autres routes, on parse en JSON
app.use(express.json());

// === ROUTES API ===
app.use('/api/auth', authRoutes);     // Inscription, connexion
app.use('/api/orders', orderRoutes);  // Commandes client + Stripe
app.use('/api/admin', adminRoutes);   // Interface admin

// === HEALTH CHECK ===
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'BEANZ Coffee API is running' });
});

// === DÉMARRAGE ===
app.listen(PORT, () => {
  console.log(`☕ BEANZ API running on port ${PORT}`);
});
