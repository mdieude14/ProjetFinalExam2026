import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Trace de consultation d'une story.
 *
 * Sert a deux choses :
 *   - afficher a l'auteur qui a vu sa story ;
 *   - distinguer, dans la barre de stories, celles deja vues (cercle gris)
 *     de celles qui ne le sont pas encore (cercle colore).
 *
 * L'index unique garantit qu'un spectateur n'est compte qu'une fois, meme
 * s'il rouvre la story dix fois : c'est la base de donnees qui applique la
 * regle, pas une verification applicative qui pourrait etre contournee par
 * deux requetes simultanees.
 */
const storyViewSchema = new Schema(
  {
    story: {
      type: Schema.Types.ObjectId,
      ref: 'Story',
      required: true,
    },

    spectateur: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    /**
     * Meme echeance que la story elle-meme : quand la story disparait, ses
     * vues n'ont plus d'objet. Sans ce TTL, la collection grossirait
     * indefiniment avec des references vers des documents inexistants.
     */
    expireAt: { type: Date, required: true },
  },
  { timestamps: true }
);

storyViewSchema.index({ story: 1, spectateur: 1 }, { unique: true });
storyViewSchema.index({ spectateur: 1, story: 1 });
storyViewSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const StoryView = model('StoryView', storyViewSchema);
export default StoryView;
