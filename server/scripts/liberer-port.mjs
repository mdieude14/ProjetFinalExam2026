/**
 * ===========================================================================
 *  LIBÉRER LE PORT — garde-fou lancé avant `npm run dev`
 * ===========================================================================
 *
 *   node scripts/liberer-port.mjs 5000
 *
 * POURQUOI CE SCRIPT EXISTE, ET CE QU'IL ÉVITE VRAIMENT.
 *
 * `npm run dev` lance `nodemon`, qui lance `node src/server.js`. Trois
 * processus en cascade : si celui du dessus est interrompu autrement que par
 * Ctrl+C — fermeture d'un terminal, arrêt d'une tâche de fond, plantage de
 * l'éditeur —, le petit-fils survit et GARDE LE PORT.
 *
 * L'ennui n'est pas le message `EADDRINUSE`, qui au moins se voit. C'est que
 * `GET /api/health` répond alors `200` : le serveur semble en pleine forme,
 * alors qu'il s'agit de l'ANCIEN, démarré avec les anciennes variables
 * d'environnement. Le cas s'est produit le 19 octobre, après la réémission du
 * jeton Gmail : le fichier `.env` portait le jeton neuf, l'API répondait `200`,
 * et pourtant elle utilisait toujours le jeton mort — `mail.service.js`
 * mémorise son transporteur à la première utilisation. La conclusion « c'est
 * réparé » tenait à un `200` qui ne prouvait rien.
 *
 * CE QUE CE SCRIPT NE FAIT PAS, DÉLIBÉRÉMENT. Il ne tue que `node` et
 * `nodemon`. Si le port est tenu par autre chose, il le NOMME et s'arrête en
 * erreur, ce qui interrompt `npm run dev`. Tuer un programme inconnu parce
 * qu'il occupe un port serait destructeur et surprenant ; mieux vaut dire
 * lequel et laisser la décision à l'humain.
 * ===========================================================================
 */

import { execFileSync } from 'node:child_process';

const port = Number(process.argv[2]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`[PORT] Numéro de port invalide : ${process.argv[2] ?? '(absent)'}`);
  process.exit(1);
}

/* Les seuls noms de processus que l'on s'autorise à arrêter. */
const NOTRES = ['node', 'node.exe', 'nodemon', 'nodemon.exe'];

/**
 * Qui écoute sur ce port ? Renvoie une liste de { pid, nom }.
 *
 * DEUX IMPLÉMENTATIONS, PARCE QUE LES OUTILS DIFFÈRENT. Sous Windows,
 * `Get-NetTCPConnection` donne le PID propriétaire ; ailleurs, `lsof`. On
 * n'utilise PAS `netstat` : sa sortie est localisée, donc son analyse
 * dépendrait de la langue du système.
 */
function quiEcoute() {
  try {
    if (process.platform === 'win32') {
      const commande = [
        `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue;`,
        'if ($c) {',
        '  $c.OwningProcess | Sort-Object -Unique | ForEach-Object {',
        '    $p = Get-Process -Id $_ -ErrorAction SilentlyContinue;',
        '    if ($p) { "$($p.Id)|$($p.ProcessName)" }',
        '  }',
        '}',
      ].join(' ');

      const sortie = execFileSync(
        'powershell',
        ['-NoProfile', '-NonInteractive', '-Command', commande],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
      );

      return sortie
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [pid, nom] = l.split('|');
          return { pid: Number(pid), nom: String(nom ?? '').toLowerCase() };
        })
        .filter((p) => Number.isInteger(p.pid));
    }

    const pids = execFileSync(
      'lsof',
      ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    )
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    return [...new Set(pids)].map((pid) => {
      let nom = '';
      try {
        nom = execFileSync('ps', ['-p', pid, '-o', 'comm='], { encoding: 'utf8' }).trim();
      } catch { /* le processus a pu disparaître entre-temps */ }
      return { pid: Number(pid), nom: nom.toLowerCase() };
    });
  } catch {
    /*
     * AUCUN ÉCOUTEUR, OU OUTIL ABSENT : on ne distingue pas les deux, et c'est
     * sans importance. Dans les deux cas il n'y a rien à libérer, et il serait
     * absurde d'empêcher le démarrage pour autant.
     */
    return [];
  }
}

const occupants = quiEcoute();

if (occupants.length === 0) {
  console.log(`[PORT] ${port} libre.`);
  process.exit(0);
}

const etrangers = occupants.filter(
  (p) => !NOTRES.some((n) => p.nom === n || p.nom === n.replace(/\.exe$/, ''))
);

if (etrangers.length > 0) {
  console.error(`\n[PORT] Le port ${port} est tenu par un programme qui n'est pas le nôtre :\n`);
  for (const p of etrangers) console.error(`    PID ${p.pid}  ${p.nom}`);
  console.error(
    '\n  Rien n’a été arrêté. Ferme ce programme, ou change le port de l’API,' +
    '\n  puis relance.\n'
  );
  process.exit(1);
}

for (const p of occupants) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(p.pid), '/F', '/T'], { stdio: 'ignore' });
    } else {
      process.kill(p.pid, 'SIGKILL');
    }
    console.log(`[PORT] ${port} : ancien serveur arrêté (PID ${p.pid}, ${p.nom}).`);
  } catch (erreur) {
    console.error(`[PORT] PID ${p.pid} n’a pas pu être arrêté : ${erreur.message}`);
    process.exit(1);
  }
}

/*
 * ON NE REND PAS LA MAIN TOUT DE SUITE. Windows garde le socket quelques
 * instants après l'arrêt du processus ; démarrer immédiatement rejouerait
 * l'`EADDRINUSE` qu'on cherche précisément à éviter. On attend que le port
 * soit réellement rendu, avec une borne pour ne jamais rester coincé.
 */
const limite = Date.now() + 5000;
while (Date.now() < limite && quiEcoute().length > 0) {
  /* Attente active brève, assumée : ce script vit moins d'une seconde en
     général, et dépendre d'un `await` imposerait un module asynchrone pour
     cinq lignes. */
}

if (quiEcoute().length > 0) {
  console.error(`[PORT] ${port} toujours occupé après 5 s. Vérifie à la main.`);
  process.exit(1);
}
