import stripe from '../src/config/stripe.js';

const lignes = [];
const ok = (l, c, d = '') => lignes.push(`${c ? 'OK   ' : 'ECHEC'} ${l}${d ? '  -> ' + d : ''}`);

/* --- 1. Le compte et son mode --- */
const compte = await stripe.accounts.retrieve();
ok('compte accessible', Boolean(compte.id), compte.id);
ok('pays du compte', Boolean(compte.country), compte.country);
ok('devise par defaut', Boolean(compte.default_currency), compte.default_currency);

// Un solde en mode test contient toujours `livemode: false`.
const solde = await stripe.balance.retrieve();
ok('**mode TEST confirme** (aucun paiement reel possible)', solde.livemode === false,
  solde.livemode ? 'MODE REEL — DANGER' : 'livemode = false');

/* --- 2. Connect est-il actif, et sous quelle forme ? ---
 *
 * ON UTILISE L'API ACCOUNTS V2, PAS V1.
 * Stripe refuse desormais `accounts.create` en v1 pour toute nouvelle
 * integration Connect : « Stripe no longer recommends Accounts v1 for new
 * Connect integrations. Create connected accounts with POST /v2/core/accounts
 * instead. »
 *
 * ET ON DEMANDE UNE CONFIGURATION « RECIPIENT », PAS « MERCHANT ».
 * Une plateforme etablie en France ne peut pas creer un compte marchand sans
 * passer par des « account tokens », ce qui obligerait a collecter l'identite
 * du coach dans notre propre interface — exactement ce qu'on veut eviter.
 *
 * En configuration « recipient », le coach RECOIT des virements sans
 * encaisser lui-meme la carte : c'est la plateforme qui debite le client puis
 * reverse, en prelevant sa commission au passage. C'est le modele des
 * « destination charges », standard pour une place de marche.
 */
let connectActif = false;
let messageConnect = '';
let compteTest = null;
try {
  compteTest = await stripe.v2.core.accounts.create({
    contact_email: 'diagnostic@coachconnect.test',
    display_name: 'Diagnostic CoachConnect',
    identity: { country: (compte.country || 'FR').toLowerCase(), entity_type: 'individual' },
    include: ['configuration.recipient', 'requirements'],
    configuration: {
      recipient: {
        capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
      },
    },
    dashboard: 'express',
    defaults: {
      currency: (compte.default_currency || 'eur').toLowerCase(),
      responsibilities: { fees_collector: 'application', losses_collector: 'application' },
    },
  });
  connectActif = true;
  messageConnect = `${compteTest.id}, ${compteTest.requirements?.entries?.length ?? 0} exigences a remplir`;
} catch (erreur) {
  messageConnect = erreur.message?.slice(0, 180) || 'erreur inconnue';
}
ok('**Connect actif** (creation de comptes de coachs en API v2)', connectActif, messageConnect);

/* --- 2 bis. Le lien d'inscription heberge par Stripe --- */
if (compteTest) {
  try {
    const lien = await stripe.v2.core.accountLinks.create({
      account: compteTest.id,
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['recipient'],
          refresh_url: 'http://localhost:5173/coach/premium?refresh=1',
          return_url: 'http://localhost:5173/coach/premium?retour=1',
        },
      },
    });
    ok('lien d inscription genere (formulaire heberge par Stripe)',
      lien.url?.startsWith('https://connect.stripe.com/'),
      lien.url.slice(0, 52) + '…');
  } catch (erreur) {
    ok('lien d inscription genere', false, erreur.message?.slice(0, 120));
  }

  // Nettoyage : on ferme le compte de diagnostic.
  await stripe.v2.core.accounts
    .close(compteTest.id, { applied_configurations: ['recipient'] })
    .catch(() => {});
}

/* --- 3. Produits et prix (tarifs des coachs) --- */
try {
  const produit = await stripe.products.create({
    name: 'Diagnostic CoachConnect',
    metadata: { diagnostic: 'true' },
  });
  const prix = await stripe.prices.create({
    product: produit.id,
    unit_amount: 1990,
    currency: 'eur',
    recurring: { interval: 'month' },
  });
  ok('creation d un produit et d un prix recurrent', Boolean(prix.id),
    `${prix.unit_amount / 100} ${prix.currency.toUpperCase()} / ${prix.recurring.interval}`);

  // Nettoyage : un prix ne se supprime pas, il s'archive.
  await stripe.prices.update(prix.id, { active: false });
  await stripe.products.update(produit.id, { active: false });
  ok('archivage du prix (un prix Stripe est immuable)', true);
} catch (erreur) {
  ok('creation d un produit et d un prix recurrent', false, erreur.message?.slice(0, 120));
}

/* --- 4. Webhooks deja declares ? --- */
try {
  const points = await stripe.webhookEndpoints.list({ limit: 5 });
  ok('acces a la configuration des webhooks', true,
    `${points.data.length} point(s) declare(s) sur le tableau de bord`);
} catch (erreur) {
  ok('acces a la configuration des webhooks', false, erreur.message?.slice(0, 100));
}

console.log('\n============ DIAGNOSTIC STRIPE ============');
lignes.forEach((l) => console.log(l));
const echecs = lignes.filter((l) => l.startsWith('ECHEC')).length;
console.log(`\n${lignes.length - echecs}/${lignes.length} verifications reussies`);
process.exit(0);
