import { localizeMessage } from '../src/common/i18n-errors';
import { EXTRA } from '../src/common/i18n-extra';
import { notFound } from '../src/common/errors';

describe('API messages in every UI language', () => {
  it('translates every message of the extra catalog', () => {
    for (const [es, [en, fr, ht]] of Object.entries(EXTRA)) {
      expect(localizeMessage(es, 'en')).toBe(en);
      expect(localizeMessage(es, 'fr')).toBe(fr);
      expect(localizeMessage(es, 'ht')).toBe(ht);
    }
  });

  it('keeps the values inside sentences with embedded data', () => {
    expect(localizeMessage('Solo hay 3 unidades disponibles.', 'en')).toBe('Only 3 units are available.');
    expect(localizeMessage('SKU: «AB-1» está repetido (también en la fila 3).', 'fr')).toBe('SKU : « AB-1 » est en double (aussi à la ligne 3).');
    expect(localizeMessage('Imagen 2: El enlace redirige demasiadas veces.', 'en')).toBe('Image 2: The link redirects too many times.');
    expect(localizeMessage('No se puede eliminar todavía: Tiene devoluciones abiertas.', 'ht')).toBe('Ou poko ka efase l: Gen retou ki louvri.');
  });

  it('uses the right gender in Spanish and translates the noun', () => {
    expect(notFound('Devolución').message).toBe('Devolución no encontrada.');
    expect(notFound('Producto').message).toBe('Producto no encontrado.');
    expect(localizeMessage('Devolución no encontrada.', 'en')).toBe('Return not found.');
    expect(localizeMessage('Tarjeta no encontrada.', 'fr')).toBe('Carte introuvable.');
  });

  it('leaves Spanish untouched', () => {
    expect(localizeMessage('Selecciona el motivo.', 'es')).toBe('Selecciona el motivo.');
  });
});
