// Génère un hash bcrypt pour un mot de passe admin.
// Usage : node scripts/hash-password.js "mon-mot-de-passe"
import bcrypt from 'bcryptjs';

const pw = process.argv[2];
if (!pw) {
  console.error('Usage : node scripts/hash-password.js "mon-mot-de-passe"');
  process.exit(1);
}
console.log(bcrypt.hashSync(pw, 10));
