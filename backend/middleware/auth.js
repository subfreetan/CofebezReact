// ===== MIDDLEWARE AUTH — Vérifie le JWT =====
// À utiliser sur toutes les routes qui nécessitent d'être connecté
// Usage : router.get('/profil', authMiddleware, (req, res) => { ... })

const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
  // Le token est envoyé dans le header : Authorization: Bearer <token>
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // Vérifie et décode le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attache les infos user à la requête pour les routes suivantes
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

// Même chose mais vérifie en plus que l'utilisateur est admin
function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès réservé aux administrateurs' });
    }
    next();
  });
}

module.exports = { authMiddleware, adminMiddleware };
