import { useState, useEffect, useCallback, useRef } from 'react';
import followApi from '@/api/follow.api';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import Alert from '@/components/ui/Alert';
import Button from '@/components/ui/Button';
import ListeUtilisateurs from './ListeUtilisateurs';

/**
 * Fenêtre listant les abonnés ou les abonnements d'un profil.
 *
 * Le chargement n'est déclenché qu'à l'ouverture, jamais au montage : ces
 * listes ne sont consultées que par une minorité de visiteurs, et les
 * charger d'avance pour chaque profil affiché serait du gaspillage.
 *
 * Un profil privé renvoie 403 pour un non-abonné — l'erreur est affichée
 * telle quelle, elle est explicite.
 */
export default function ModaleAbonnes({
  ouvert,
  onFermer,
  identifiant,
  onglet = 'abonnes',
  estMonProfil,
  surTotal,
}) {

  const [ongletActif, setOngletActif] = useState(onglet);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [page, setPage] = useState(1);
  const [aSuivante, setASuivante] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);
  const [total, setTotal] = useState(0);

  /*
   * LE RAPPEL EST GARDÉ DANS UNE RÉFÉRENCE, PAS LU DIRECTEMENT.
   *
   * S'il figurait dans les dépendances de `charger`, un parent qui le passe
   * en fonction anonyme — l'écriture la plus naturelle — lui donnerait une
   * identité neuve à chaque rendu. `charger` changerait donc à chaque rendu,
   * l'effet qui en dépend se rejouerait, un `setState` suivrait, et l'on
   * boucle indéfiniment en martelant le serveur.
   *
   * La référence rend le rappel joignable sans le faire participer aux
   * dépendances : le composant ne peut plus être cassé par la façon dont on
   * l'appelle.
   */
  const rappelTotal = useRef(surTotal);
  useEffect(() => {
    rappelTotal.current = surTotal;
  }, [surTotal]);

  // L'onglet demandé peut changer entre deux ouvertures : on se resynchronise.
  useEffect(() => setOngletActif(onglet), [onglet, ouvert]);

  const charger = useCallback(
    async (numeroPage = 1) => {
      setChargement(true);
      setErreur(null);

      /*
       * ON VIDE LA LISTE AVANT DE RECHARGER LA PREMIÈRE PAGE.
       *
       * Sans cela, passer de « Abonnés » à « Abonnements » laissait affichée
       * la liste PRÉCÉDENTE pendant tout le chargement — l'indicateur
       * d'attente ne se montre que sur une liste vide. On voyait donc les
       * abonnés sous l'onglet « Abonnements », et si la requête échouait, ils
       * y restaient. C'est le symptôme « la liste ne s'actualise pas ».
       *
       * Seule la première page est concernée : « Voir plus » complète la liste
       * en cours, il serait absurde de l'effacer pour la reconstruire.
       */
      if (numeroPage === 1) setUtilisateurs([]);
      try {
        const appel =
          ongletActif === 'abonnes' ? followApi.abonnes : followApi.abonnements;
        const reponse = await appel(identifiant, { page: numeroPage });

        setUtilisateurs((precedents) =>
          numeroPage === 1
            ? reponse.data.elements
            : [...precedents, ...reponse.data.elements]
        );
        setASuivante(reponse.data.pagination.aSuivante);
        setPage(numeroPage);

        /*
         * ON REMONTE LE TOTAL AU PROFIL.
         *
         * Le compteur affiché sous l'avatar vient du profil, chargé avant
         * l'ouverture de cette fenêtre. Si un abonné a été désactivé depuis,
         * les deux nombres divergent — et l'utilisateur voit « 25 abonnés »
         * au-dessus d'une liste de 22 sans pouvoir comprendre l'écart.
         *
         * Le serveur recale sa propre valeur à cette occasion ; on met aussi
         * à jour l'affichage, sans quoi il faudrait recharger la page pour
         * voir la correction.
         */
        setTotal(reponse.data.pagination.total);
        rappelTotal.current?.(ongletActif, reponse.data.pagination.total);
      } catch (e) {
        setErreur(e.message);
        setUtilisateurs([]);
      } finally {
        setChargement(false);
      }
    },
    [identifiant, ongletActif]
  );

  useEffect(() => {
    if (ouvert) charger(1);
  }, [ouvert, charger]);

  const retirer = async (u) => {
    try {
      await followApi.retirerAbonne(u.pseudo);
      setUtilisateurs((precedents) => precedents.filter((x) => x._id !== u._id));

      /*
       * ON DÉCRÉMENTE LE TOTAL CONNU, jamais la longueur de la liste affichée.
       *
       * Celle-ci ne contient que les pages déjà chargées : sur un profil de
       * cent abonnés, elle en compte vingt. Y lire le nouveau total ferait
       * chuter le compteur de cent à dix-neuf d'un coup.
       *
       * Le compteur du profil doit suivre, et son oubli se voyait aussitôt :
       * la ligne disparaissait, et le nombre au-dessus continuait d'annoncer
       * l'ancien total jusqu'au prochain rechargement de la page.
       */
      /*
       * LE RAPPEL EST APPELÉ EN DEHORS DE LA FONCTION DE MISE À JOUR.
       *
       * Placé à l'intérieur, il s'exécutait PENDANT LE RENDU — React invoque
       * l'updater d'un `setState` au moment de calculer le nouvel état. On y
       * déclenchait donc le `setState` du parent, ce que React signale par
       * « Cannot update a component while rendering a different component ».
       *
       * Le symptôme était discret : l'affichage restait juste, seul un
       * avertissement en console le trahissait. Mais l'ordre des mises à jour
       * n'est alors plus garanti, et le défaut se réveille au premier rendu
       * concurrent.
       */
      const nouveauTotal = Math.max(0, total - 1);
      setTotal(nouveauTotal);
      rappelTotal.current?.('abonnes', nouveauTotal);
    } catch (e) {
      setErreur(e.message);
    }
  };

  return (
    <Modal ouvert={ouvert} onFermer={onFermer} titre="Relations" taille="md">
      <div className="p-4">
        {/* Onglets */}
        <div className="mb-3 flex gap-1 rounded-xl border border-ardoise-200 p-1">
          {[
            ['abonnes', 'Abonnés'],
            ['abonnements', 'Abonnements'],
          ].map(([cle, libelle]) => (
            <button
              key={cle}
              onClick={() => setOngletActif(cle)}
              aria-pressed={ongletActif === cle}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                ongletActif === cle
                  ? 'bg-marque-500 text-white'
                  : 'text-ardoise-600 hover:bg-ardoise-50'
              }`}
            >
              {libelle}
              {/*
                LE NOMBRE EST AFFICHÉ SUR L'ONGLET ACTIF.
                Il vient de la liste elle-même, pas du compteur dénormalisé du
                profil : c'est ce qui garantit qu'il correspond aux lignes
                visibles, et non à un total calculé ailleurs.
              */}
              {ongletActif === cle && total > 0 && (
                <span className="ml-1.5 text-xs opacity-80">{total}</span>
              )}
            </button>
          ))}
        </div>

        {erreur && (
          <Alert variante="erreur" className="mb-3">
            {erreur}
          </Alert>
        )}

        {chargement && utilisateurs.length === 0 ? (
          <div className="flex justify-center py-10">
            <Spinner taille="lg" className="text-marque-500" />
          </div>
        ) : (
          <>
            <ListeUtilisateurs
              utilisateurs={utilisateurs}
              vide={
                ongletActif === 'abonnes'
                  ? 'Aucun abonné pour le moment.'
                  : 'Aucun abonnement pour le moment.'
              }
              // Sur SON propre profil, dans l'onglet « Abonnés », on propose
              // de retirer la personne plutôt que de la suivre.
              action={
                estMonProfil && ongletActif === 'abonnes'
                  ? (u) => (
                      <Button variante="secondaire" taille="sm" onClick={() => retirer(u)}>
                        Retirer
                      </Button>
                    )
                  : undefined
              }
            />

            {aSuivante && (
              <div className="flex justify-center pt-3">
                <Button
                  variante="fantome"
                  taille="sm"
                  chargement={chargement}
                  onClick={() => charger(page + 1)}
                >
                  Voir plus
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
