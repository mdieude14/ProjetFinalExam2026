import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    // Tailwind 4 s'integre directement a Vite. Plus de tailwind.config.js :
    // la configuration du theme se fait en CSS, dans src/index.css.
    tailwindcss(),
  ],

  resolve: {
    alias: {
      // Permet d'ecrire   import Button from '@/components/ui/Button'
      // au lieu de        import Button from '../../../components/ui/Button'
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  server: {
    port: 5173,
    proxy: {
      /**
       * Toutes les requetes vers /api sont relayees au back-end.
       *
       * L'INTERET N'EST PAS QUE COSMETIQUE : pour le navigateur, le front et
       * l'API se trouvent alors sur la meme origine (localhost:5173). Le
       * cookie httpOnly du refresh token est donc envoye et recu sans aucune
       * subtilite de CORS ni de SameSite en developpement.
       *
       * En production, front et API sont sur des domaines differents : c'est
       * la que les reglages `sameSite: 'none'` et `secure: true` du back-end
       * prennent le relais.
       */
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },

      /**
       * Fichiers televerses, en mode de stockage LOCAL uniquement.
       *
       * Dans ce mode, le serveur renvoie des URL relatives du type
       * « /uploads/posts/abc.png ». Sans ce relais, le navigateur les
       * demanderait a Vite (port 5173), qui repondrait par index.html : les
       * images apparaissent alors cassees, alors que l'API et la base sont
       * parfaitement fonctionnelles.
       *
       * Le probleme ne se pose pas avec Cloudinary, qui renvoie des URL
       * absolues vers son propre domaine. Cette entree ne sert donc qu'au
       * developpement sans compte Cloudinary.
       */
      '/uploads': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },

      /**
       * Temps reel (module 11).
       *
       * `ws: true` EST LA LIGNE QUI COMPTE, et son absence produit une panne
       * deroutante. Sans elle, Vite relaie la premiere requete HTTP de
       * Socket.io — celle du transport « polling » — mais refuse la montee en
       * WebSocket qui suit. Le client se rabat alors sur le polling, ou
       * boucle en reconnexions, selon les transports autorises : le socket a
       * l'air de fonctionner par intermittence, et rien en console ne designe
       * le proxy.
       *
       * Le chemin `/socket.io` est celui par defaut de la bibliotheque ; il
       * est declare explicitement des deux cotes pour qu'aucun changement de
       * configuration ne le desynchronise en silence.
       */
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
