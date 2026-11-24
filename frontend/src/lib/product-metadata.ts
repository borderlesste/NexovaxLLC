import type { Locale } from './i18n/core';

const labels = {
  es: {
    condition: 'Condición del producto', new: 'Nuevo', used: 'Usado', sizeGuide: 'Guía de tallas',
    sizeExample: 'Ej. Talla M — pecho de 92 a 98 cm. Mide alrededor de la parte más ancha del pecho.',
    customStyle: 'Otro estilo', addStyle: 'Añadir estilo',
  },
  en: {
    condition: 'Product condition', new: 'New', used: 'Used', sizeGuide: 'Size guide',
    sizeExample: 'E.g. Size M — chest 92 to 98 cm. Measure around the fullest part of the chest.',
    customStyle: 'Other style', addStyle: 'Add style',
  },
  fr: {
    condition: 'État du produit', new: 'Neuf', used: 'D’occasion', sizeGuide: 'Guide des tailles',
    sizeExample: 'Ex. Taille M — tour de poitrine de 92 à 98 cm. Mesurez à l’endroit le plus large.',
    customStyle: 'Autre style', addStyle: 'Ajouter un style',
  },
  ht: {
    condition: 'Eta pwodwi a', new: 'Nouvo', used: 'Itilize', sizeGuide: 'Gid tay',
    sizeExample: 'Egz. Tay M — pwatrin 92 rive 98 cm. Mezire toutotou pati ki pi laj nan pwatrin lan.',
    customStyle: 'Lòt stil', addStyle: 'Ajoute yon stil',
  },
};

export const productMetadataLabels = (locale: Locale) => labels[locale];
