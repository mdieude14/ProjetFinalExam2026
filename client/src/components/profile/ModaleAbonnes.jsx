import { useState, useEffect, useCallback } from 'react';
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
export default function ModaleAbonnes({ ouvert, onFermer, identifiant, onglet = 'abonnes', estMonProfil }) {

  const [ongletActif, setOngletActif] = useState(onglet);
  const [utilisateurs, setUtilisateurs] = useState([]);
  const [page, setPage] = useState(1);
  const [aSuivante, setASuivante] = useState(false);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState(null);

  // L'onglet demandé peut changer entre deux ouvertures : on se resynchronise.
  useEffect(() => setOngletActif(onglet), [onglet, ouvert]);

  const charger = useCallback(
    async (numeroPage = 1) => {
      setChargement(true);
      setErreur(null);
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
