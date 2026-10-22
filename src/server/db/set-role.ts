import { eq } from 'drizzle-orm';
import { db } from './client';
import { users } from './schema';

// Donne ou retire le rôle admin à un compte existant :
//   npm run admin:promote -- email@exemple.fr
//   npm run admin:demote -- email@exemple.fr
// Le rôle est relu en base à chaque requête : pas besoin de se reconnecter.
const [role, email] = process.argv.slice(2);

if ((role !== 'admin' && role !== 'customer') || !email) {
  console.error('Usage : npm run admin:promote -- <email>   |   npm run admin:demote -- <email>');
  process.exit(1);
}

const user = db.update(users).set({ role }).where(eq(users.email, email)).returning({ name: users.name }).get();

if (!user) {
  console.error(`Aucun compte avec l'email ${email}. Créez-le d'abord via /compte/inscription.`);
  process.exit(1);
}

console.log(`${user.name} (${email}) est maintenant ${role === 'admin' ? 'administrateur' : 'client'}.`);
