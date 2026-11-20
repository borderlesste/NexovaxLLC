/**
 * Translations of the common words sellers use for product variants: option names (Color,
 * Talla, Tamaño...) and their values (colors, sizes, materials). Sellers type them in their own
 * language (Rojo, Red, Rouge or Wouj are the same word), they are stored as typed, and every
 * shopper sees them in the shopper's language, Spanish included. Anything not listed (brands,
 * model codes, "XL", "42") is shown as typed.
 */
type Langs = { en: string; fr: string; ht: string };

const TERMS: Record<string, Langs> = {
  // option names
  Color: { en: 'Color', fr: 'Couleur', ht: 'Koulè' },
  Colores: { en: 'Colors', fr: 'Couleurs', ht: 'Koulè' },
  Talla: { en: 'Size', fr: 'Taille', ht: 'Tay' },
  Tamaño: { en: 'Size', fr: 'Taille', ht: 'Gwosè' },
  Medida: { en: 'Size', fr: 'Dimension', ht: 'Mezi' },
  Medidas: { en: 'Dimensions', fr: 'Dimensions', ht: 'Mezi' },
  Material: { en: 'Material', fr: 'Matériau', ht: 'Materyèl' },
  Capacidad: { en: 'Capacity', fr: 'Capacité', ht: 'Kapasite' },
  Almacenamiento: { en: 'Storage', fr: 'Stockage', ht: 'Espas memwa' },
  Memoria: { en: 'Memory', fr: 'Mémoire', ht: 'Memwa' },
  Sabor: { en: 'Flavor', fr: 'Saveur', ht: 'Gou' },
  Aroma: { en: 'Scent', fr: 'Parfum', ht: 'Odè' },
  Estilo: { en: 'Style', fr: 'Style', ht: 'Stil' },
  Modelo: { en: 'Model', fr: 'Modèle', ht: 'Modèl' },
  Diseño: { en: 'Design', fr: 'Design', ht: 'Desen' },
  Estampado: { en: 'Pattern', fr: 'Motif', ht: 'Motif' },
  Acabado: { en: 'Finish', fr: 'Finition', ht: 'Fini' },
  Forma: { en: 'Shape', fr: 'Forme', ht: 'Fòm' },
  Presentación: { en: 'Package', fr: 'Présentation', ht: 'Prezantasyon' },
  Cantidad: { en: 'Quantity', fr: 'Quantité', ht: 'Kantite' },
  Paquete: { en: 'Pack', fr: 'Lot', ht: 'Pake' },
  Contenido: { en: 'Contents', fr: 'Contenu', ht: 'Kontni' },
  Peso: { en: 'Weight', fr: 'Poids', ht: 'Pwa' },
  Volumen: { en: 'Volume', fr: 'Volume', ht: 'Volim' },
  Longitud: { en: 'Length', fr: 'Longueur', ht: 'Longè' },
  Largo: { en: 'Length', fr: 'Longueur', ht: 'Longè' },
  Ancho: { en: 'Width', fr: 'Largeur', ht: 'Lajè' },
  Voltaje: { en: 'Voltage', fr: 'Tension', ht: 'Vòltaj' },
  Potencia: { en: 'Power', fr: 'Puissance', ht: 'Pisans' },
  Edad: { en: 'Age', fr: 'Âge', ht: 'Laj' },
  Género: { en: 'Gender', fr: 'Genre', ht: 'Sèks' },
  Tipo: { en: 'Type', fr: 'Type', ht: 'Kalite' },
  Versión: { en: 'Version', fr: 'Version', ht: 'Vèsyon' },
  Conectividad: { en: 'Connectivity', fr: 'Connectivité', ht: 'Koneksyon' },

  // colors
  Negro: { en: 'Black', fr: 'Noir', ht: 'Nwa' },
  Blanco: { en: 'White', fr: 'Blanc', ht: 'Blan' },
  Azul: { en: 'Blue', fr: 'Bleu', ht: 'Ble' },
  'Azul marino': { en: 'Navy blue', fr: 'Bleu marine', ht: 'Ble maren' },
  'Azul claro': { en: 'Light blue', fr: 'Bleu clair', ht: 'Ble pal' },
  'Azul oscuro': { en: 'Dark blue', fr: 'Bleu foncé', ht: 'Ble fonse' },
  Celeste: { en: 'Sky blue', fr: 'Bleu ciel', ht: 'Ble syèl' },
  Turquesa: { en: 'Turquoise', fr: 'Turquoise', ht: 'Tikwaz' },
  Rojo: { en: 'Red', fr: 'Rouge', ht: 'Wouj' },
  Vino: { en: 'Burgundy', fr: 'Bordeaux', ht: 'Bòdo' },
  Verde: { en: 'Green', fr: 'Vert', ht: 'Vèt' },
  'Verde oliva': { en: 'Olive green', fr: 'Vert olive', ht: 'Vèt oliv' },
  'Verde claro': { en: 'Light green', fr: 'Vert clair', ht: 'Vèt pal' },
  'Verde oscuro': { en: 'Dark green', fr: 'Vert foncé', ht: 'Vèt fonse' },
  Menta: { en: 'Mint', fr: 'Menthe', ht: 'Mant' },
  Gris: { en: 'Gray', fr: 'Gris', ht: 'Gri' },
  'Gris claro': { en: 'Light gray', fr: 'Gris clair', ht: 'Gri pal' },
  'Gris oscuro': { en: 'Dark gray', fr: 'Gris foncé', ht: 'Gri fonse' },
  Morado: { en: 'Purple', fr: 'Violet', ht: 'Mov' },
  Lila: { en: 'Lilac', fr: 'Lilas', ht: 'Lila' },
  Rosado: { en: 'Pink', fr: 'Rose', ht: 'Woz' },
  Rosa: { en: 'Pink', fr: 'Rose', ht: 'Woz' },
  Fucsia: { en: 'Fuchsia', fr: 'Fuchsia', ht: 'Fichsya' },
  Amarillo: { en: 'Yellow', fr: 'Jaune', ht: 'Jòn' },
  Mostaza: { en: 'Mustard', fr: 'Moutarde', ht: 'Moutad' },
  Naranja: { en: 'Orange', fr: 'Orange', ht: 'Zoranj' },
  Coral: { en: 'Coral', fr: 'Corail', ht: 'Koray' },
  Marrón: { en: 'Brown', fr: 'Marron', ht: 'Mawon' },
  Café: { en: 'Brown', fr: 'Marron', ht: 'Mawon' },
  Chocolate: { en: 'Chocolate', fr: 'Chocolat', ht: 'Chokola' },
  Beige: { en: 'Beige', fr: 'Beige', ht: 'Bèj' },
  Crema: { en: 'Cream', fr: 'Crème', ht: 'Krèm' },
  Hueso: { en: 'Off-white', fr: 'Blanc cassé', ht: 'Blan kase' },
  Caqui: { en: 'Khaki', fr: 'Kaki', ht: 'Kaki' },
  Dorado: { en: 'Gold', fr: 'Doré', ht: 'Lò' },
  Plateado: { en: 'Silver', fr: 'Argenté', ht: 'Ajan' },
  Bronce: { en: 'Bronze', fr: 'Bronze', ht: 'Bwonz' },
  Cobre: { en: 'Copper', fr: 'Cuivre', ht: 'Kwiv' },
  Transparente: { en: 'Clear', fr: 'Transparent', ht: 'Transparan' },
  Multicolor: { en: 'Multicolor', fr: 'Multicolore', ht: 'Plizyè koulè' },
  Natural: { en: 'Natural', fr: 'Naturel', ht: 'Natirèl' },

  // sizes
  Pequeño: { en: 'Small', fr: 'Petit', ht: 'Piti' },
  Pequeña: { en: 'Small', fr: 'Petite', ht: 'Piti' },
  Chico: { en: 'Small', fr: 'Petit', ht: 'Piti' },
  Mediano: { en: 'Medium', fr: 'Moyen', ht: 'Mwayen' },
  Mediana: { en: 'Medium', fr: 'Moyenne', ht: 'Mwayen' },
  Grande: { en: 'Large', fr: 'Grand', ht: 'Gwo' },
  'Extra grande': { en: 'Extra large', fr: 'Très grand', ht: 'Trè gwo' },
  'Extra pequeño': { en: 'Extra small', fr: 'Très petit', ht: 'Trè piti' },
  'Talla única': { en: 'One size', fr: 'Taille unique', ht: 'Yon sèl tay' },
  Única: { en: 'One size', fr: 'Unique', ht: 'Inik' },
  Estándar: { en: 'Standard', fr: 'Standard', ht: 'Estanda' },
  Individual: { en: 'Twin', fr: 'Une place', ht: 'Yon plas' },
  Matrimonial: { en: 'Full', fr: 'Deux places', ht: 'De plas' },

  // materials
  Algodón: { en: 'Cotton', fr: 'Coton', ht: 'Koton' },
  Cuero: { en: 'Leather', fr: 'Cuir', ht: 'Kwi' },
  Piel: { en: 'Leather', fr: 'Cuir', ht: 'Kwi' },
  'Piel sintética': { en: 'Faux leather', fr: 'Similicuir', ht: 'Fo kwi' },
  'Cuero sintético': { en: 'Faux leather', fr: 'Similicuir', ht: 'Fo kwi' },
  Poliéster: { en: 'Polyester', fr: 'Polyester', ht: 'Polyestè' },
  Lana: { en: 'Wool', fr: 'Laine', ht: 'Len' },
  Seda: { en: 'Silk', fr: 'Soie', ht: 'Swa' },
  Lino: { en: 'Linen', fr: 'Lin', ht: 'Len' },
  Mezclilla: { en: 'Denim', fr: 'Denim', ht: 'Djin' },
  Plástico: { en: 'Plastic', fr: 'Plastique', ht: 'Plastik' },
  Metal: { en: 'Metal', fr: 'Métal', ht: 'Metal' },
  Madera: { en: 'Wood', fr: 'Bois', ht: 'Bwa' },
  Vidrio: { en: 'Glass', fr: 'Verre', ht: 'Vè' },
  'Acero inoxidable': { en: 'Stainless steel', fr: 'Acier inoxydable', ht: 'Asye pwòp' },
  Aluminio: { en: 'Aluminum', fr: 'Aluminium', ht: 'Aliminyòm' },
  Silicona: { en: 'Silicone', fr: 'Silicone', ht: 'Silikòn' },
  Cerámica: { en: 'Ceramic', fr: 'Céramique', ht: 'Seramik' },

  // who it is for
  Hombre: { en: 'Men', fr: 'Homme', ht: 'Gason' },
  Mujer: { en: 'Women', fr: 'Femme', ht: 'Fanm' },
  Niño: { en: 'Boy', fr: 'Garçon', ht: 'Ti gason' },
  Niña: { en: 'Girl', fr: 'Fille', ht: 'Ti fi' },
  Niños: { en: 'Kids', fr: 'Enfants', ht: 'Timoun' },
  Bebé: { en: 'Baby', fr: 'Bébé', ht: 'Tibebe' },
  Adulto: { en: 'Adult', fr: 'Adulte', ht: 'Granmoun' },
  Unisex: { en: 'Unisex', fr: 'Unisexe', ht: 'Inisèks' },
};

const key = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

type Entry = Langs & { es: string };
/** English words too generic to read back as a bed size ("Full", "Twin"). */
const NO_REVERSE = new Set(['Individual', 'Matrimonial']);
const BY_KEY = new Map<string, Entry>();
// Spanish first (it wins on clashes such as "Gris"), then the other languages as typed by sellers.
for (const [es, t] of Object.entries(TERMS)) BY_KEY.set(key(es), { es, ...t });
for (const l of ['en', 'fr', 'ht'] as const)
  for (const [es, t] of Object.entries(TERMS)) if (!NO_REVERSE.has(es) && !BY_KEY.has(key(t[l]))) BY_KEY.set(key(t[l]), { es, ...t });
// Common spellings sellers use that are not the canonical translation.
for (const [alias, es] of [['Colour', 'Color'], ['Grey', 'Gris'], ['Koule', 'Color'], ['Gold', 'Dorado'], ['Navy', 'Azul marino'], ['Dimensions', 'Medidas'], ['Dimension', 'Medida']] as const)
  if (!BY_KEY.has(key(alias))) BY_KEY.set(key(alias), { es, ...TERMS[es] });

export type VariantLang = 'es' | 'en' | 'fr' | 'ht';

/** One variant word ("Rojo", "red", "Rouge", "Tamaño") in the shopper's language, or the text as typed. */
export function variantTerm(text: string, lang: VariantLang): string {
  return BY_KEY.get(key(text))?.[lang] ?? text;
}

/** Hex colors for the common color words, keyed by the Spanish term. */
const COLOR_HEX: Record<string, string> = {
  Negro: '#111111', Blanco: '#ffffff', Azul: '#2563eb', 'Azul marino': '#1e3a8a', 'Azul claro': '#93c5fd', 'Azul oscuro': '#1e40af', Celeste: '#7dd3fc',
  Turquesa: '#14b8a6', Rojo: '#dc2626', Vino: '#7f1d1d', Verde: '#16a34a', 'Verde oliva': '#6b8e23', 'Verde claro': '#86efac', 'Verde oscuro': '#14532d',
  Menta: '#99f6e4', Gris: '#9ca3af', 'Gris claro': '#d1d5db', 'Gris oscuro': '#4b5563', Morado: '#6d28d9', Lila: '#c4b5fd', Rosado: '#ec4899', Rosa: '#ec4899',
  Fucsia: '#d946ef', Amarillo: '#facc15', Mostaza: '#ca8a04', Naranja: '#f97316', Coral: '#fb7185', Marrón: '#7c4a1d', Café: '#7c4a1d', Chocolate: '#5b3a1e',
  Beige: '#e7d9c4', Crema: '#f5f0e1', Hueso: '#f3efe6', Caqui: '#c3b091', Dorado: '#d4a017', Plateado: '#c0c0c0', Bronce: '#cd7f32', Cobre: '#b87333',
};

/** True for an option name that means color in any supported language (Color, Colour, Couleur, Koulè...). */
export const isColorOption = (name: string) => ['Color', 'Colores'].includes(BY_KEY.get(key(name))?.es ?? '');

/** The swatch for a color word in any supported language, or null when it isn't a known color. */
export const colorSwatch = (label: string) => COLOR_HEX[BY_KEY.get(key(label))?.es ?? ''] ?? null;

/** Variant title "Rojo / Mediano": each part translated when known. */
export function variantTitle(text: string, lang: VariantLang): string {
  return text
    .split(' / ')
    .map((p) => variantTerm(p, lang))
    .join(' / ');
}

/**
 * Translates variant words in an API response: catalog product options ({ name, displayType,
 * values: [{ label }] }), catalog variants ({ title, isDefault }) and order/cart lines
 * ({ variantTitle }). The seller's product editor ({ name, values } without displayType) is
 * left as typed, so saving a product never renames its options.
 */
export function translateVariants(v: any, lang: VariantLang, depth = 0): any {
  if (depth > 8 || v == null) return v;
  if (Array.isArray(v)) return v.map((x) => translateVariants(x, lang, depth + 1));
  if (typeof v !== 'object' || v instanceof Date || Buffer.isBuffer(v)) return v;
  // Only plain JSON objects: class instances (files, streams) pass through untouched.
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return v;
  const out: any = {};
  const isOption = typeof v.displayType === 'string' && Array.isArray(v.values);
  for (const [k, val] of Object.entries(v)) {
    if (isOption && k === 'name' && typeof val === 'string') out.name = variantTerm(val, lang);
    else if (isOption && k === 'values') out.values = (val as any[]).map((x) => (x && typeof x.label === 'string' ? { ...x, label: variantTerm(x.label, lang) } : x));
    else if (k === 'title' && typeof val === 'string' && 'isDefault' in v && 'optionValues' in v) out.title = variantTitle(val, lang);
    else if (k === 'variantTitle' && typeof val === 'string') out.variantTitle = variantTitle(val, lang);
    else out[k] = translateVariants(val, lang, depth + 1);
  }
  return out;
}

/** True when the object is a seller-editor option ({ name, values } without displayType): its name stays as typed. */
export const isEditableOption = (v: any) => v && typeof v === 'object' && typeof v.name === 'string' && Array.isArray(v.values) && !('displayType' in v);
