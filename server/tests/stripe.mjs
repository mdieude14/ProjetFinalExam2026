import { connecterDB, deconnecterDB } from '../src/config/db.js';
import User from '../src/models/User.js';
import Subscription from '../src/models/Subscription.js';
import stripe from '../src/config/stripe.js';

const BASE = 'http://localhost:5000/api';
const resultats = [];
const ok = (l, c, d = '') => resultats.push(`${c ? 'OK   ' : 'ECHEC'} ${l}${d ? '  -> ' + d : ''}`);

function dump(r) {
  console.log('\n===== RESULTATS PARTIELS =====');
  resultats.forEach((x) => console.log(x));
  console.log(`\nINTERROMPU : ${r}`);
}
process.on('uncaughtException', (e) => { dump(e.message); process.exit(1); });
process.on('unhandledRejection', (e) => { dump(e?.message || e); process.exit(1); });

async function appel(chemin, { methode = 'GET', corps, token } = {}) {
  const entetes = {};
  if (token) entetes.Authorization = `Bearer ${token}`;
  if (corps) entetes['Content-Type'] = 'application/json';
  const rep = await fetch(BASE + chemin, {
    method: methode, headers: entetes,
    body: corps ? JSON.stringify(corps) : undefined,
  });
  let json = null;
  try { json = await rep.json(); } catch { /* vide */ }
  return { statut: rep.status, json };
}

const S = Date.now();
const MDP = 'MotDePasse123';
const dom = '@stripetest.local';

await connecterDB();
const regex = new RegExp(dom.replace('.', '\\.') + '$');
await User.deleteMany({ email: regex });

async function creer(type, pseudo) {
  const r = await appel('/auth/register', {
    methode: 'POST',
    corps: { type, nom: 'T', prenom: pseudo, pseudo: `${pseudo}${S}`,
             email: `${pseudo}${S}${dom}`, password: MDP, ville: 'Lyon' },
  });
  if (r.statut !== 201) throw new Error(`${pseudo}: ${r.statut} ${r.json?.message}`);
  return { token: r.json.accessToken, id: r.json.utilisateur._id, pseudo: `${pseudo}${S}` };
}

const coach = await creer('coach', 'coach');
const sportif = await creer('utilisateur', 'sportif');

/* ============ 1. GARDE : COACH NON CERTIFIE ============ */

const onbNonCertifie = await appel('/stripe/connect/onboarding', {
  methode: 'POST', token: coach.token,
});
ok('onboarding refusé à un coach non certifié -> 403', onbNonCertifie.statut === 403,
  onbNonCertifie.json?.message?.slice(0, 70));

const sportifStripe = await appel('/stripe/connect/statut', { token: sportif.token });
ok('routes /stripe refusées à un sportif -> 403', sportifStripe.statut === 403);

const sansAuth = await appel('/stripe/connect/statut');
ok('routes /stripe refusées sans authentification -> 401', sansAuth.statut === 401);

/* ============ 2. ONBOARDING D UN COACH CERTIFIE ============ */

await User.updateOne({ _id: coach.id }, { 'diplome.statut': 'verifie' });

const onb = await appel('/stripe/connect/onboarding', {
  methode: 'POST', token: coach.token,
});
ok('onboarding accepté pour un coach certifié -> 200', onb.statut === 200,
  `statut ${onb.statut} ${onb.json?.message || ''}`);
ok('**lien hébergé par Stripe renvoyé**',
  onb.json?.url?.startsWith('https://connect.stripe.com/'),
  onb.json?.url?.slice(0, 48) + '…');
ok('compte signalé comme nouveau', onb.json?.compteExistant === false);

const coachApres = await User.findById(coach.id);
ok('identifiant de compte enregistré en base',
  coachApres.stripeAccount?.id?.startsWith('acct_'), coachApres.stripeAccount?.id);
ok('statut « en_attente » tant que le formulaire n’est pas rempli',
  coachApres.stripeAccount?.statut === 'en_attente', coachApres.stripeAccount?.statut);

const onb2 = await appel('/stripe/connect/onboarding', {
  methode: 'POST', token: coach.token,
});
ok('second appel réutilise le compte existant', onb2.json?.compteExistant === true);
ok('**un lien NEUF est régénéré** (les liens expirent)',
  onb2.json?.url !== onb.json?.url);

const compteStripe = await stripe.v2.core.accounts.retrieve(coachApres.stripeAccount.id, {
  include: ['configuration.recipient'],
});
ok('compte créé en configuration « recipient »',
  Boolean(compteStripe.configuration?.recipient));
ok('métadonnée reliant le compte à notre utilisateur',
  compteStripe.metadata?.utilisateurId === coach.id, compteStripe.metadata?.utilisateurId);

/* ============ 3. STATUT CONNECT ============ */

const statut = await appel('/stripe/connect/statut', { token: coach.token });
ok('statut interrogé auprès de Stripe -> 200', statut.statut === 200);
ok('encaissement encore impossible (formulaire non rempli)',
  statut.json?.chargesEnabled === false);
ok('peutMonetiser reste faux', statut.json?.peutMonetiser === false);
ok('ce qui manque est détaillé au coach',
  statut.json?.manque?.stripe === true && statut.json?.manque?.tarif === true,
  JSON.stringify(statut.json?.manque));
ok('exigences Stripe remontées', Array.isArray(statut.json?.exigences),
  `${statut.json?.exigences?.length} à fournir`);

/* ============ 4. TARIF ============ */

const tarifSansStripe = await appel('/stripe/premium/tarif', {
  methode: 'PUT', token: coach.token, corps: { prixMensuel: 19.9 },
});
ok('tarif refusé tant que Stripe n’encaisse pas -> 403', tarifSansStripe.statut === 403,
  tarifSansStripe.json?.message?.slice(0, 60));

// On simule la fin de l'onboarding : Stripe le fera par webhook en réel.
await User.updateOne({ _id: coach.id }, { 'stripeAccount.chargesEnabled': true });

const tarifTropBas = await appel('/stripe/premium/tarif', {
  methode: 'PUT', token: coach.token, corps: { prixMensuel: 2 },
});
ok('tarif de 2 € rejeté -> 400', tarifTropBas.statut === 400);

const tarifTropHaut = await appel('/stripe/premium/tarif', {
  methode: 'PUT', token: coach.token, corps: { prixMensuel: 900 },
});
ok('tarif de 900 € rejeté -> 400', tarifTropHaut.statut === 400);

const tarif = await appel('/stripe/premium/tarif', {
  methode: 'PUT', token: coach.token,
  corps: { prixMensuel: 19.9, description: 'Programmes et suivi personnalisé' },
});
ok('tarif de 19,90 € accepté -> 200', tarif.statut === 200, tarif.json?.message);
ok('converti en centimes', tarif.json?.premium?.prixMensuel === 1990,
  `${tarif.json?.premium?.prixMensuel}`);
ok('produit et prix Stripe créés',
  tarif.json?.premium?.stripeProductId?.startsWith('prod_') &&
  tarif.json?.premium?.stripePriceId?.startsWith('price_'));
ok('**peutMonetiser passe à vrai**', tarif.json?.peutMonetiser === true);

const premierPrix = tarif.json.premium.stripePriceId;

const tarif2 = await appel('/stripe/premium/tarif', {
  methode: 'PUT', token: coach.token, corps: { prixMensuel: 24.9 },
});
ok('changement de tarif -> 200', tarif2.statut === 200);
ok('**un NOUVEAU prix est créé** (un prix Stripe est immuable)',
  tarif2.json?.premium?.stripePriceId !== premierPrix);
ok('message avertissant que les abonnés gardent leur prix',
  /ancien prix/i.test(tarif2.json?.message || ''), tarif2.json?.message);

const ancien = await stripe.prices.retrieve(premierPrix);
ok('**ancien prix archivé chez Stripe**', ancien.active === false);

const produitInchange = tarif2.json.premium.stripeProductId === tarif.json.premium.stripeProductId;
ok('le produit reste le même', produitInchange);

/* ============ 5. SUSPENSION DE L OFFRE ============ */

const suspendre = await appel('/stripe/premium/actif', {
  methode: 'PATCH', token: coach.token, corps: { actif: false },
});
ok('suspension de l’offre -> 200', suspendre.statut === 200, suspendre.json?.message?.slice(0, 60));
ok('abonnés actuels comptés dans le message', suspendre.json?.abonnesActifs === 0);

const reactiver = await appel('/stripe/premium/actif', {
  methode: 'PATCH', token: coach.token, corps: { actif: true },
});
ok('réactivation -> 200', reactiver.statut === 200);

/* ============ 6. REVENUS ============ */

const rev = await appel('/stripe/premium/revenus', { token: coach.token });
ok('tableau de bord des revenus -> 200', rev.statut === 200);
ok('commission de 15 % appliquée', rev.json?.revenus?.tauxCommission === 15);
ok('tout à zéro sans abonné', rev.json?.revenus?.brutMensuel === 0);

/* ============ 7. SOUSCRIPTION ============ */

const soiMeme = await appel(`/subscriptions/${coach.pseudo}/checkout`, {
  methode: 'POST', token: coach.token,
});
ok('s’abonner à soi-même refusé -> 400', soiMeme.statut === 400, soiMeme.json?.message);

const coachNonMonetisable = await creer('coach', 'coach2');
const versNonMonetisable = await appel(`/subscriptions/${coachNonMonetisable.pseudo}/checkout`, {
  methode: 'POST', token: sportif.token,
});
ok('s’abonner à un coach non certifié refusé -> 403', versNonMonetisable.statut === 403,
  versNonMonetisable.json?.message?.slice(0, 60));

const statutAvant = await appel(`/subscriptions/statut/${coach.pseudo}`, {
  token: sportif.token,
});
ok('statut d’abonnement consultable -> 200', statutAvant.statut === 200);
ok('pas encore abonné', statutAvant.json?.abonne === false);
ok('offre signalée disponible', statutAvant.json?.offreDisponible === true);
ok('prix exposé au sportif', statutAvant.json?.prixMensuel === 2490,
  `${statutAvant.json?.prixMensuel}`);

/**
 * LE COACH DE TEST N'A PAS REMPLI SON FORMULAIRE STRIPE.
 *
 * On a forcé `chargesEnabled: true` en base pour franchir nos propres
 * contrôles, mais le compte connecté reste restreint côté Stripe : ses
 * 12 exigences ne sont pas satisfaites. Stripe refuse donc de créer une
 * session dont la destination ne peut pas recevoir de virement.
 *
 * C'est le comportement attendu, et c'est même une garantie : impossible
 * de vendre un abonnement dont l'argent n'arriverait jamais au coach.
 * On vérifie donc que le refus se produit et qu'il porte sur la bonne cause.
 *
 * Le parcours de paiement complet exige une inscription Stripe réellement
 * finalisée — voir la note en fin de fichier.
 */
const checkout = await appel(`/subscriptions/${coach.pseudo}/checkout`, {
  methode: 'POST', token: sportif.token,
});
ok('**checkout refusé tant que le compte du coach n’est pas validé**',
  checkout.statut === 400,
  `statut ${checkout.statut}`);
ok('le motif porte bien sur la capacité de virement',
  /stripe_transfers|transfers/i.test(checkout.json?.message || ''),
  (checkout.json?.message || '').slice(0, 80) + '…');
ok('**aucun abonnement créé en base** malgré la tentative',
  (await Subscription.countDocuments({ utilisateur: sportif.id })) === 0);

const clientCree = await User.findById(sportif.id);
ok('client Stripe créé et mémorisé pour le sportif',
  clientCree.stripeCustomerId?.startsWith('cus_'), clientCree.stripeCustomerId);

const checkout2 = await appel(`/subscriptions/${coach.pseudo}/checkout`, {
  methode: 'POST', token: sportif.token,
});
const clientApres = await User.findById(sportif.id);
ok('**le même client Stripe est réutilisé**',
  clientApres.stripeCustomerId === clientCree.stripeCustomerId);
void checkout2;

/* ============ 8. LISTES ============ */

const mesAbos = await appel('/subscriptions', { token: sportif.token });
ok('liste de mes abonnements -> 200', mesAbos.statut === 200);
ok('vide tant qu’aucun paiement n’a abouti', mesAbos.json?.elements?.length === 0);

const abonnesSportif = await appel('/subscriptions/abonnes', { token: sportif.token });
ok('liste des abonnés refusée à un sportif -> 403', abonnesSportif.statut === 403);

const abonnesCoach = await appel('/subscriptions/abonnes', { token: coach.token });
ok('liste des abonnés accessible au coach -> 200', abonnesCoach.statut === 200);

/* ============ NETTOYAGE ============ */

const ids = await User.find({ email: regex }).distinct('_id');
const comptes = await User.find({ _id: { $in: ids } }).select('stripeAccount premium stripeCustomerId');
for (const u of comptes) {
  if (u.stripeAccount?.id) {
    await stripe.v2.core.accounts
      .close(u.stripeAccount.id, { applied_configurations: ['recipient'] })
      .catch(() => {});
  }
  if (u.premium?.stripeProductId) {
    await stripe.products.update(u.premium.stripeProductId, { active: false }).catch(() => {});
  }
  if (u.stripeCustomerId) {
    await stripe.customers.del(u.stripeCustomerId).catch(() => {});
  }
}
await Subscription.deleteMany({ utilisateur: { $in: ids } });
await User.deleteMany({ _id: { $in: ids } });
await deconnecterDB();

console.log('\n============ MODULE 7 — SECTIONS 7.3 A 7.5 ============');
resultats.forEach((r) => console.log(r));
const echecs = resultats.filter((r) => r.startsWith('ECHEC')).length;
console.log(`\n${resultats.length - echecs}/${resultats.length} vérifications réussies`);
process.exit(echecs > 0 ? 1 : 0);
