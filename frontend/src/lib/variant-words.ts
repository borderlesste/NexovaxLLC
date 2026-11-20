/**
 * Variant words for the seller product editor: option names, preset values and color swatches
 * in the seller's language. A seller may type "Rojo", "Red", "Rouge" or "Wouj"; all are the same
 * color (same swatch), and the API shows each shopper the word in the shopper's language.
 */
type Lang = 'es' | 'en' | 'fr' | 'ht';
type Word = Record<Lang, string>;

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const COLORS: (Word & { hex: string })[] = [
  { es: 'Negro', en: 'Black', fr: 'Noir', ht: 'Nwa', hex: '#111111' },
  { es: 'Blanco', en: 'White', fr: 'Blanc', ht: 'Blan', hex: '#ffffff' },
  { es: 'Azul', en: 'Blue', fr: 'Bleu', ht: 'Ble', hex: '#2563eb' },
  { es: 'Rojo', en: 'Red', fr: 'Rouge', ht: 'Wouj', hex: '#dc2626' },
  { es: 'Verde', en: 'Green', fr: 'Vert', ht: 'Vèt', hex: '#16a34a' },
  { es: 'Gris', en: 'Gray', fr: 'Gris', ht: 'Gri', hex: '#9ca3af' },
  { es: 'Morado', en: 'Purple', fr: 'Violet', ht: 'Mov', hex: '#6d28d9' },
  { es: 'Rosado', en: 'Pink', fr: 'Rose', ht: 'Woz', hex: '#ec4899' },
  { es: 'Amarillo', en: 'Yellow', fr: 'Jaune', ht: 'Jòn', hex: '#facc15' },
  { es: 'Naranja', en: 'Orange', fr: 'Orange', ht: 'Zoranj', hex: '#f97316' },
  { es: 'Marrón', en: 'Brown', fr: 'Marron', ht: 'Mawon', hex: '#7c4a1d' },
  { es: 'Beige', en: 'Beige', fr: 'Beige', ht: 'Bèj', hex: '#e7d9c4' },
  // Recognized when typed (not offered as presets).
  { es: 'Azul marino', en: 'Navy blue', fr: 'Bleu marine', ht: 'Ble maren', hex: '#1e3a8a' },
  { es: 'Azul claro', en: 'Light blue', fr: 'Bleu clair', ht: 'Ble pal', hex: '#93c5fd' },
  { es: 'Azul oscuro', en: 'Dark blue', fr: 'Bleu foncé', ht: 'Ble fonse', hex: '#1e40af' },
  { es: 'Celeste', en: 'Sky blue', fr: 'Bleu ciel', ht: 'Ble syèl', hex: '#7dd3fc' },
  { es: 'Turquesa', en: 'Turquoise', fr: 'Turquoise', ht: 'Tikwaz', hex: '#14b8a6' },
  { es: 'Vino', en: 'Burgundy', fr: 'Bordeaux', ht: 'Bòdo', hex: '#7f1d1d' },
  { es: 'Verde oliva', en: 'Olive green', fr: 'Vert olive', ht: 'Vèt oliv', hex: '#6b8e23' },
  { es: 'Verde claro', en: 'Light green', fr: 'Vert clair', ht: 'Vèt pal', hex: '#86efac' },
  { es: 'Verde oscuro', en: 'Dark green', fr: 'Vert foncé', ht: 'Vèt fonse', hex: '#14532d' },
  { es: 'Menta', en: 'Mint', fr: 'Menthe', ht: 'Mant', hex: '#99f6e4' },
  { es: 'Gris claro', en: 'Light gray', fr: 'Gris clair', ht: 'Gri pal', hex: '#d1d5db' },
  { es: 'Gris oscuro', en: 'Dark gray', fr: 'Gris foncé', ht: 'Gri fonse', hex: '#4b5563' },
  { es: 'Lila', en: 'Lilac', fr: 'Lilas', ht: 'Lila', hex: '#c4b5fd' },
  { es: 'Fucsia', en: 'Fuchsia', fr: 'Fuchsia', ht: 'Fichsya', hex: '#d946ef' },
  { es: 'Mostaza', en: 'Mustard', fr: 'Moutarde', ht: 'Moutad', hex: '#ca8a04' },
  { es: 'Coral', en: 'Coral', fr: 'Corail', ht: 'Koray', hex: '#fb7185' },
  { es: 'Chocolate', en: 'Chocolate', fr: 'Chocolat', ht: 'Chokola', hex: '#5b3a1e' },
  { es: 'Crema', en: 'Cream', fr: 'Crème', ht: 'Krèm', hex: '#f5f0e1' },
  { es: 'Caqui', en: 'Khaki', fr: 'Kaki', ht: 'Kaki', hex: '#c3b091' },
  { es: 'Dorado', en: 'Gold', fr: 'Doré', ht: 'Lò', hex: '#d4a017' },
  { es: 'Plateado', en: 'Silver', fr: 'Argenté', ht: 'Ajan', hex: '#c0c0c0' },
  { es: 'Bronce', en: 'Bronze', fr: 'Bronze', ht: 'Bwonz', hex: '#cd7f32' },
  { es: 'Cobre', en: 'Copper', fr: 'Cuivre', ht: 'Kwiv', hex: '#b87333' },
];
const PRESET_COLORS = COLORS.slice(0, 12);

const SIZES: Word[] = [
  { es: 'Pequeño', en: 'Small', fr: 'Petit', ht: 'Piti' },
  { es: 'Mediano', en: 'Medium', fr: 'Moyen', ht: 'Mwayen' },
  { es: 'Grande', en: 'Large', fr: 'Grand', ht: 'Gwo' },
  { es: 'Extra grande', en: 'Extra large', fr: 'Très grand', ht: 'Trè gwo' },
];
const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '36', '37', '38', '39', '40', '41', '42', '43', '44', '45'];

type Kind = 'color' | 'clothing' | 'size';
const OPTION_NAMES: Record<Kind, Word> = {
  color: { es: 'Color', en: 'Color', fr: 'Couleur', ht: 'Koulè' },
  clothing: { es: 'Talla', en: 'Size', fr: 'Taille', ht: 'Tay' },
  size: { es: 'Tamaño', en: 'Dimensions', fr: 'Dimension', ht: 'Gwosè' },
};
const KIND_WORDS: Record<Kind, string[]> = {
  color: ['color', 'colour', 'colores', 'colors', 'colours', 'couleur', 'couleurs', 'koule'],
  clothing: ['talla', 'size', 'taille', 'tay'],
  size: ['tamano', 'medida', 'medidas', 'dimension', 'dimensions', 'gwose', 'mezi'],
};

const lang = (l: string): Lang => (l === 'en' || l === 'fr' || l === 'ht' ? l : 'es');
const kindOf = (name: string): Kind | null => {
  const n = norm(name);
  return (Object.keys(KIND_WORDS) as Kind[]).find((k) => KIND_WORDS[k].includes(n)) ?? null;
};
const findIn = <T extends Word>(list: T[], label: string) => {
  const n = norm(label);
  return list.find((w) => (['es', 'en', 'fr', 'ht'] as const).some((l) => norm(w[l]) === n));
};

/** True for an option name that means color in any language (Color, Colour, Couleur, Koulè). */
export const isColorOption = (name: string) => kindOf(name) === 'color';

/** The swatch for a color word in any language; gray when the color isn't known. */
export const swatchFor = (label: string) => findIn(COLORS, label)?.hex ?? '#9ca3af';

/** Quick option buttons, named in the seller's language. */
export const quickOptions = (locale: string) => (['color', 'clothing', 'size'] as Kind[]).map((k) => OPTION_NAMES[k][lang(locale)]);

/** Suggested values for an option, in the seller's language. */
export function presetsFor(name: string, locale: string): string[] {
  const l = lang(locale);
  const k = kindOf(name);
  if (k === 'color') return PRESET_COLORS.map((c) => c[l]);
  if (k === 'clothing') return CLOTHING_SIZES;
  if (k === 'size') return SIZES.map((s) => s[l]);
  return [];
}

/** Same word in any language ("Rojo" and "Red"), so a preset isn't offered twice. */
export function sameWord(a: string, b: string) {
  if (norm(a) === norm(b)) return true;
  const w = findIn(COLORS, a) ?? findIn(SIZES, a);
  return !!w && w === (findIn(COLORS, b) ?? findIn(SIZES, b));
}

/** Same option kind in any language ("Talla" and "Size"), so a quick option isn't added twice. */
export const sameOption = (a: string, b: string) => norm(a) === norm(b) || (!!kindOf(a) && kindOf(a) === kindOf(b));
