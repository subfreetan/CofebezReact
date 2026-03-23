-- ===== BEANZ COFFEE — TABLES DE BASE =====
-- À exécuter dans Supabase > SQL Editor > New Query

-- Table utilisateurs
CREATE TABLE users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  prenom TEXT NOT NULL,
  pseudo TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  card_number TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  eur_balance DECIMAL(10,2) DEFAULT 0.00,
  free_coffee INTEGER DEFAULT 0,
  role TEXT DEFAULT 'client' CHECK (role IN ('client', 'admin')),
  member_since TEXT NOT NULL,
  qr_code TEXT,
  card_visual TEXT DEFAULT 'carte_fete_2.png',
  consent_sms BOOLEAN DEFAULT true,
  consent_email BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour recherche rapide par pseudo (connexion)
CREATE INDEX idx_users_pseudo ON users(pseudo);

-- Table commandes (pour l'étape suivante)
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) NOT NULL,
  items JSONB NOT NULL,
  total DECIMAL(10,2) NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'preparing', 'ready', 'collected')),
  points_earned INTEGER DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les commandes par utilisateur et par statut
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);

-- Créer un compte admin par défaut
-- Le mot de passe est 'admin123' hashé avec bcrypt
-- Tu pourras le changer plus tard
INSERT INTO users (prenom, pseudo, password, card_number, points, role, member_since)
VALUES (
  'Admin',
  'admin',
  '$2a$10$sp/vRW07GJYAUW1WvR43A.PlgVkxblp6WA/eYfssNTYVrgbZuBZTy',
  '0000 0000 0000 0001',
  0,
  'admin',
  '01/26'
);
