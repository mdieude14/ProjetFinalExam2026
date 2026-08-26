/**
 * Formatage des dates d'evenement.
 *
 * POURQUOI UN FICHIER A PART, alors que `prix.js` contient deja un
 * `formaterDate()` : celui-la rend une date seule (« 12 septembre 2026 »),
 * ce qui suffit pour un abonnement. Un evenement, lui, se lit toujours comme
 * un CRENEAU — un jour, une heure de debut, une heure de fin. Afficher
 * « 12 septembre » sans l'heure obligerait a ouvrir la fiche pour savoir si
 * la sortie part le matin ou le soir.
 */

/** Jour et heure : « sam. 12 sept. a 10:00 ». */
export function formaterDateHeure(valeur) {
  if (!valeur) return '—';

  return new Date(valeur).toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Creneau complet, condense quand les deux bornes tombent le meme jour.
 *
 *   meme jour   « sam. 12 sept., 10:00 – 12:00 »
 *   sinon       « sam. 12 sept. 10:00 → dim. 13 sept. 16:00 »
 *
 * Repeter la date pour un creneau de deux heures ajouterait du bruit sans
 * ajouter d'information : c'est le cas le plus frequent, il merite la forme
 * la plus courte.
 */
export function formaterPlage(debut, fin) {
  if (!debut) return '—';

  const d = new Date(debut);
  const f = fin ? new Date(fin) : null;

  const jour = d.toLocaleDateString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });

  const heure = (date) =>
    date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  if (!f) return `${jour}, ${heure(d)}`;

  const memeJour = d.toDateString() === f.toDateString();

  return memeJour
    ? `${jour}, ${heure(d)} – ${heure(f)}`
    : `${jour} ${heure(d)} → ${formaterDateHeure(f)}`;
}

/**
 * Delai avant le debut, en clair : « dans 3 jours », « demain », « dans 2 h ».
 *
 * CE QUE CETTE FONCTION EVITE A L'UTILISATEUR : la soustraction mentale.
 * « 12 septembre » ne dit pas si c'est demain ou dans trois semaines — il
 * faut connaitre la date du jour et compter. Sur une liste d'evenements, ce
 * petit calcul se repete a chaque ligne.
 */
export function delaiAvant(valeur) {
  if (!valeur) return null;

  const millisecondes = new Date(valeur) - new Date();
  if (millisecondes <= 0) return null;

  const heures = Math.round(millisecondes / 3600000);
  if (heures < 1) return 'dans moins d’une heure';
  if (heures < 24) return `dans ${heures} h`;

  const jours = Math.round(heures / 24);
  if (jours === 1) return 'demain';
  if (jours < 31) return `dans ${jours} jours`;

  const mois = Math.round(jours / 30);
  return `dans ${mois} mois`;
}

/**
 * Convertit une date ISO venue du serveur vers la valeur attendue par un
 * `<input type="datetime-local">`.
 *
 * LE PIEGE : cet input travaille en heure LOCALE et refuse tout fuseau. Lui
 * passer directement `toISOString()` — qui rend de l'UTC — decale la valeur
 * affichee de l'ecart horaire. En ete, en France, une seance de 10 h
 * apparaitrait a 8 h dans le formulaire, sans le moindre avertissement.
 */
export function versChampLocal(valeur) {
  if (!valeur) return '';

  const d = new Date(valeur);
  const decalage = d.getTimezoneOffset() * 60000;

  return new Date(d - decalage).toISOString().slice(0, 16);
}

/** Valeur d'un `datetime-local` vers une chaine ISO complete pour l'API. */
export function versISO(valeurLocale) {
  if (!valeurLocale) return '';
  return new Date(valeurLocale).toISOString();
}

/**
 * Anciennete d'un evenement passe, en tres court : « 3 min », « 2 h », « hier ».
 *
 * PENDANT DE `delaiAvant`, POUR LE PASSE — et volontairement plus laconique.
 * Cette valeur s'affiche au bout de chaque ligne d'une liste de
 * conversations, ou la place est comptee : « il y a 3 minutes » ferait
 * deborder le nom de l'interlocuteur sur un ecran de 375 px, alors que la
 * precision n'apporte rien. Une messagerie affiche « 3 min », pas une phrase.
 */
export function delaiDepuis(valeur) {
  if (!valeur) return null;

  const millisecondes = new Date() - new Date(valeur);
  if (millisecondes < 0) return 'a l’instant';

  const minutes = Math.floor(millisecondes / 60000);
  if (minutes < 1) return 'a l’instant';
  if (minutes < 60) return `${minutes} min`;

  const heures = Math.floor(minutes / 60);
  if (heures < 24) return `${heures} h`;

  const jours = Math.floor(heures / 24);
  if (jours === 1) return 'hier';
  if (jours < 7) return `${jours} j`;

  // Au-dela d'une semaine, la date parle mieux qu'un nombre de jours.
  return new Date(valeur).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}
