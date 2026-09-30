import { useCallback, useEffect, useRef, useState } from 'react';

import supportApi, { BOT_TELEGRAM } from '@/api/support.api';
import { traiterErreurApi } from '@/utils/erreurs';
import Button from '@/components/ui/Button';
import Alert from '@/components/ui/Alert';

/**
 * ===========================================================================
 *  RATTACHER SA CONVERSATION TELEGRAM — Paramètres
 * ===========================================================================
 *
 * LE CODE NAÎT ICI, DERRIÈRE LA SESSION. Un compte Telegram ne prouve pas
 * une identité CoachConnect : c'est parce que la personne est CONNECTÉE en
 * voyant ce code que l'envoyer au bot prouve qu'il s'agit bien d'elle.
 *
 * L'ÉCRAN DÉTECTE SEUL LE RATTACHEMENT. Tant qu'un code est affiché, il
 * interroge l'API toutes les quatre secondes : la personne envoie le code
 * depuis son téléphone et voit la page confirmer, sans rien recharger. Le
 * sondage s'arrête dès que le lien existe, que le code expire, ou que la page
 * est quittée — jamais d'appels qui continueraient en arrière-plan.
 * ===========================================================================
 */

const INTERVALLE_SONDAGE = 4000;

const dateFr = (iso) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export default function RattachementTelegram() {
  const [etat, setEtat] = useState(null); // { lie, lieLe } ; null = chargement
  const [code, setCode] = useState(null); // { code, expireLe }
  const [restant, setRestant] = useState(0);
  const [chargement, setChargement] = useState(false);
  const [message, setMessage] = useState(null);
  const [copie, setCopie] = useState(false);
  const monte = useRef(true);

  const lireEtat = useCallback(async () => {
    try {
      const { data } = await supportApi.etatTelegram();
      if (monte.current) setEtat({ lie: data.lie, lieLe: data.lieLe });
      return data.lie;
    } catch (erreur) {
      if (monte.current) {
        setEtat({ lie: false, lieLe: null });
        setMessage({ variante: 'erreur', texte: traiterErreurApi(erreur).global });
      }
      return false;
    }
  }, []);

  useEffect(() => {
    monte.current = true;
    lireEtat();
    return () => { monte.current = false; };
  }, [lireEtat]);

  /* Compte à rebours du code, et sondage tant qu'il est valable. */
  useEffect(() => {
    if (!code) return undefined;

    const expire = new Date(code.expireLe).getTime();
    const tic = () => setRestant(Math.max(0, Math.round((expire - Date.now()) / 1000)));
    tic();
    const minuteur = setInterval(tic, 1000);

    const sondage = setInterval(async () => {
      if (Date.now() >= expire) {
        clearInterval(sondage);
        return;
      }
      if (await lireEtat()) {
        clearInterval(sondage);
        if (monte.current) {
          setCode(null);
          setMessage({ variante: 'succes', texte: 'C’est fait : votre conversation Telegram est rattachée.' });
        }
      }
    }, INTERVALLE_SONDAGE);

    return () => { clearInterval(minuteur); clearInterval(sondage); };
  }, [code, lireEtat]);

  const generer = async () => {
    setChargement(true);
    setMessage(null);
    setCopie(false);
    try {
      const { data } = await supportApi.codeTelegram();
      setCode({ code: data.code, expireLe: data.expireLe });
    } catch (erreur) {
      setMessage({ variante: 'erreur', texte: traiterErreurApi(erreur).global });
    } finally {
      setChargement(false);
    }
  };

  const delier = async () => {
    setChargement(true);
    setMessage(null);
    try {
      await supportApi.delierTelegram();
      setCode(null);
      await lireEtat();
      setMessage({ variante: 'info', texte: 'Votre conversation Telegram n’est plus rattachée à ce compte.' });
    } catch (erreur) {
      setMessage({ variante: 'erreur', texte: traiterErreurApi(erreur).global });
    } finally {
      setChargement(false);
    }
  };

  const commande = code ? `/lier ${code.code}` : '';

  const copier = async () => {
    // Le presse-papiers peut être refusé (contexte non sécurisé, permission) :
    // la commande reste lisible à l'écran, rien n'est perdu.
    try {
      await navigator.clipboard.writeText(commande);
      setCopie(true);
    } catch {
      setCopie(false);
    }
  };

  if (!etat) {
    return <p className="text-sm text-ardoise-500">Chargement…</p>;
  }

  const minutes = Math.floor(restant / 60);
  const secondes = String(restant % 60).padStart(2, '0');

  return (
    <div className="space-y-4" data-test="rattachement-telegram">
      {message && <Alert variante={message.variante}>{message.texte}</Alert>}

      {etat.lie ? (
        <div className="space-y-3">
          <p className="text-sm text-ardoise-700">
            Une conversation Telegram est rattachée à ce compte
            {etat.lieLe ? ` depuis le ${dateFr(etat.lieLe)}` : ''}. L’assistant{' '}
            <a
              href={`https://t.me/${BOT_TELEGRAM}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-marque-700 underline"
            >
              @{BOT_TELEGRAM}
            </a>{' '}
            peut y répondre sur vos abonnements premium et vos prochaines inscriptions — jamais sur
            un montant, un paiement ou votre adresse.
          </p>
          <Button variante="secondaire" onClick={delier} chargement={chargement}>
            Délier la conversation
          </Button>
        </div>
      ) : code && restant > 0 ? (
        <div className="space-y-3">
          <p className="text-sm text-ardoise-700">
            Ouvrez{' '}
            <a
              href={`https://t.me/${BOT_TELEGRAM}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-marque-700 underline"
            >
              @{BOT_TELEGRAM}
            </a>{' '}
            dans Telegram et envoyez-lui ce message :
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <code
              data-test="commande-lier"
              className="select-all rounded-lg bg-ardoise-100 px-4 py-2 font-mono text-lg font-bold tracking-widest text-ardoise-900"
            >
              {commande}
            </code>
            <Button variante="fantome" onClick={copier}>
              {copie ? 'Copié' : 'Copier'}
            </Button>
          </div>

          <p className="text-xs text-ardoise-500" aria-live="polite">
            Valable encore {minutes} min {secondes} s, une seule fois. Cette page se mettra à jour
            d’elle-même dès que le bot l’aura reçu.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ardoise-700">
            Sans rattachement, l’assistant{' '}
            <a
              href={`https://t.me/${BOT_TELEGRAM}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-marque-700 underline"
            >
              @{BOT_TELEGRAM}
            </a>{' '}
            répond sur l’utilisation de l’application. Rattachez votre conversation pour qu’il
            puisse aussi répondre sur vos abonnements et vos inscriptions.
          </p>
          {code && restant === 0 && (
            <p className="text-xs text-ardoise-500">Le code précédent a expiré.</p>
          )}
          <Button onClick={generer} chargement={chargement}>
            Générer un code
          </Button>
        </div>
      )}
    </div>
  );
}
