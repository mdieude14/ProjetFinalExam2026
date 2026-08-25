/**
 * ===========================================================================
 *  LECTURE DES DIMENSIONS D'UNE IMAGE
 * ===========================================================================
 *
 * POURQUOI PAS UNE BIBLIOTHEQUE ?
 * `sharp` ou `image-size` feraient le travail, mais la premiere embarque des
 * binaires natifs de plusieurs dizaines de mega-octets et complique le
 * deploiement. Or on n'a besoin que de deux nombres, qui figurent dans les
 * tout premiers octets de chaque format. Une cinquantaine de lignes suffisent.
 *
 * A QUOI CELA SERT.
 * Le fil d'actualite reserve la place d'une image AVANT son chargement, via
 * `aspect-ratio`. Sans les dimensions, on retombe sur un carre par defaut :
 * une photo en paysage se retrouve recadree et perd un tiers de son contenu.
 * Cloudinary renvoie ces valeurs spontanement ; en stockage local, il faut
 * les extraire soi-meme.
 *
 * Les formats non reconnus (videos notamment) renvoient un objet vide :
 * l'appelant retombe alors sur son comportement par defaut.
 * ===========================================================================
 */

/** PNG — les dimensions sont dans le bloc IHDR, toujours en premier. */
function dimensionsPng(tampon) {
  // Signature (8 octets) + longueur (4) + « IHDR » (4) = 16, puis 2 x 4 octets.
  if (tampon.length < 24) return null;
  if (tampon.toString('ascii', 12, 16) !== 'IHDR') return null;

  return {
    largeur: tampon.readUInt32BE(16),
    hauteur: tampon.readUInt32BE(20),
  };
}

/** GIF — dans l'en-tete logique, en petit-boutiste. */
function dimensionsGif(tampon) {
  if (tampon.length < 10) return null;

  return {
    largeur: tampon.readUInt16LE(6),
    hauteur: tampon.readUInt16LE(8),
  };
}

/**
 * JPEG — il faut parcourir les segments jusqu'au marqueur SOF
 * (Start Of Frame), qui n'est pas a une position fixe : les donnees EXIF,
 * les vignettes et les profils colorimetriques le precedent souvent.
 */
function dimensionsJpeg(tampon) {
  let position = 2; // apres la signature FFD8

  while (position < tampon.length - 9) {
    if (tampon[position] !== 0xff) {
      position += 1; // resynchronisation sur un fichier legerement malforme
      continue;
    }

    const marqueur = tampon[position + 1];

    // SOF0 a SOF15 portent les dimensions. On exclut C4 (tables de Huffman),
    // C8 (extension JPEG) et CC (codage arithmetique), qui partagent la plage
    // sans decrire l'image.
    const estSOF =
      marqueur >= 0xc0 && marqueur <= 0xcf &&
      marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc;

    if (estSOF) {
      return {
        hauteur: tampon.readUInt16BE(position + 5),
        largeur: tampon.readUInt16BE(position + 7),
      };
    }

    // Segment suivant : 2 octets de marqueur + la longueur annoncee.
    const longueur = tampon.readUInt16BE(position + 2);
    if (longueur < 2) return null; // longueur aberrante, on abandonne
    position += 2 + longueur;
  }

  return null;
}

/** WebP — trois variantes de blocs, chacune avec son encodage. */
function dimensionsWebp(tampon) {
  if (tampon.length < 30) return null;

  const format = tampon.toString('ascii', 12, 16);

  // VP8X : format etendu (animation, transparence). Dimensions sur 24 bits,
  // stockees diminuees de 1.
  if (format === 'VP8X') {
    return {
      largeur: 1 + (tampon[24] | (tampon[25] << 8) | (tampon[26] << 16)),
      hauteur: 1 + (tampon[27] | (tampon[28] << 8) | (tampon[29] << 16)),
    };
  }

  // VP8L : sans perte. 14 bits par dimension, diminuees de 1.
  if (format === 'VP8L') {
    const bits = tampon.readUInt32LE(21);
    return {
      largeur: 1 + (bits & 0x3fff),
      hauteur: 1 + ((bits >> 14) & 0x3fff),
    };
  }

  // VP8 (avec perte) : les 14 bits de poids faible de deux entiers 16 bits.
  if (format === 'VP8 ') {
    return {
      largeur: tampon.readUInt16LE(26) & 0x3fff,
      hauteur: tampon.readUInt16LE(28) & 0x3fff,
    };
  }

  return null;
}

/**
 * Renvoie { largeur, hauteur } ou un objet vide si le format n'est pas
 * reconnu ou le fichier tronque.
 *
 * Ne leve JAMAIS d'exception : un fichier corrompu ne doit pas faire echouer
 * un televersement par ailleurs valide. L'absence de dimensions degrade
 * l'affichage, elle ne le casse pas.
 */
export function lireDimensions(tampon) {
  if (!Buffer.isBuffer(tampon) || tampon.length < 12) return {};

  try {
    let resultat = null;

    if (tampon[0] === 0x89 && tampon.toString('ascii', 1, 4) === 'PNG') {
      resultat = dimensionsPng(tampon);
    } else if (tampon.toString('ascii', 0, 3) === 'GIF') {
      resultat = dimensionsGif(tampon);
    } else if (tampon[0] === 0xff && tampon[1] === 0xd8) {
      resultat = dimensionsJpeg(tampon);
    } else if (
      tampon.toString('ascii', 0, 4) === 'RIFF' &&
      tampon.toString('ascii', 8, 12) === 'WEBP'
    ) {
      resultat = dimensionsWebp(tampon);
    }

    // Garde-fou : des valeurs nulles ou aberrantes valent mieux absentes
    // qu'appliquees a un `aspect-ratio`, ou elles casseraient la mise en page.
    if (
      resultat &&
      resultat.largeur > 0 && resultat.hauteur > 0 &&
      resultat.largeur < 100000 && resultat.hauteur < 100000
    ) {
      return resultat;
    }
  } catch {
    // Fichier tronque ou malforme : on renonce silencieusement.
  }

  return {};
}

export default lireDimensions;
