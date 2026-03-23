// ===== CONNEXION SUPABASE =====
// On utilise la service_role key (côté serveur uniquement)
// car elle permet de lire/écrire sans restrictions de sécurité row-level

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = supabase;
