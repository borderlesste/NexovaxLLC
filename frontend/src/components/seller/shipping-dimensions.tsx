'use client';
import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Field, Input, Select } from '@/components/ui/input';
import { t } from '@/lib/i18n';

/** Canonical package data (what the API and Shippo use): kilograms and centimeters, as strings. */
export type ShipCanonical = { weightKg: string; lengthCm: string; widthCm: string; heightCm: string };
type WeightUnit = 'g' | 'kg' | 'oz' | 'lb';
type LengthUnit = 'cm' | 'in';

const TO_KG: Record<WeightUnit, number> = { g: 0.001, kg: 1, oz: 0.028349523125, lb: 0.45359237 };
const TO_CM: Record<LengthUnit, number> = { cm: 1, in: 2.54 };
const PREF_KEY = 'nx-ship-units';

const num = (v: string) => (v === '' ? NaN : Number(v));
/** Shows a converted amount without float noise: 0.3 kg → "300" g, 12.7 cm → "5" in. */
const show = (v: number, maxDecimals: number) => (isFinite(v) && v > 0 ? String(Number(v.toFixed(maxDecimals))) : '');
const toKg = (v: string, u: WeightUnit) => (num(v) > 0 ? Number((num(v) * TO_KG[u]).toFixed(4)) : NaN);
const toCm = (v: string, u: LengthUnit) => (num(v) > 0 ? Number((num(v) * TO_CM[u]).toFixed(2)) : NaN);

function savedUnits(): { w?: WeightUnit; d?: LengthUnit } {
  try {
    return JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * Weight and box size in the unit the seller thinks in (grams avoid typing "0.3"),
 * converted to kg/cm for the API. Flags combinations that are physically unlikely
 * (a unit mix-up) and offers a one-click fix; it never changes values on its own.
 */
export function ShippingDimensions({ value, onChange }: { value: ShipCanonical; onChange: (v: ShipCanonical) => void }) {
  const [wUnit, setWUnit] = useState<WeightUnit>('kg');
  const [dUnit, setDUnit] = useState<LengthUnit>('cm');
  const [disp, setDisp] = useState({ weight: '', length: '', width: '', height: '' });
  const emitted = useRef<string>('');

  // Load (or external change): pick a comfortable unit and show the stored kg/cm in it.
  useEffect(() => {
    const key = JSON.stringify(value);
    if (key === emitted.current) return;
    const pref = savedUnits();
    const kg = num(value.weightKg);
    const w: WeightUnit = pref.w === 'oz' || pref.w === 'lb' ? (kg > 0 && kg < 0.45 ? 'oz' : 'lb') : kg > 0 && kg < 1 ? 'g' : kg >= 1 ? 'kg' : pref.w ?? 'g';
    const d: LengthUnit = pref.d ?? 'cm';
    setWUnit(w);
    setDUnit(d);
    setDisp({
      weight: show(kg / TO_KG[w], w === 'g' ? 0 : 3),
      length: show(num(value.lengthCm) / TO_CM[d], 2),
      width: show(num(value.widthCm) / TO_CM[d], 2),
      height: show(num(value.heightCm) / TO_CM[d], 2),
    });
    emitted.current = key;
  }, [value]);

  const emit = (next: typeof disp, w = wUnit, d = dUnit) => {
    const c: ShipCanonical = {
      weightKg: isNaN(toKg(next.weight, w)) ? '' : String(Math.max(toKg(next.weight, w), next.weight ? 0.0001 : 0)),
      lengthCm: isNaN(toCm(next.length, d)) ? '' : String(toCm(next.length, d)),
      widthCm: isNaN(toCm(next.width, d)) ? '' : String(toCm(next.width, d)),
      heightCm: isNaN(toCm(next.height, d)) ? '' : String(toCm(next.height, d)),
    };
    emitted.current = JSON.stringify(c);
    onChange(c);
  };
  const set = (k: keyof typeof disp, v: string) => {
    const next = { ...disp, [k]: v };
    setDisp(next);
    emit(next);
  };
  /** Changing the unit keeps the typed numbers (the usual intent is "I meant grams"). */
  const changeUnits = (w: WeightUnit, d: LengthUnit, next = disp) => {
    setWUnit(w);
    setDUnit(d);
    setDisp(next);
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ w, d }));
    } catch {}
    emit(next, w, d);
  };

  // ---- plausibility (density of the package and carrier limits)
  const kg = toKg(disp.weight, wUnit);
  const dims = [toCm(disp.length, dUnit), toCm(disp.width, dUnit), toCm(disp.height, dUnit)];
  const liters = dims.every((x) => x > 0) ? (dims[0] * dims[1] * dims[2]) / 1000 : NaN;
  const density = kg / liters; // kg per liter; packed goods are roughly 0.02–2
  const warnings: { text: string; fix?: { label: string; run: () => void } }[] = [];
  if (kg > 0 && liters > 0 && density > 4) {
    warnings.push({
      text: t('El peso parece demasiado alto para una caja de {l} L ({w}).', { l: fmt(liters), w: `${disp.weight} ${wUnit}` }),
      fix: wUnit === 'kg' ? { label: t('¿Querías decir {v} g?', { v: disp.weight }), run: () => changeUnits('g', dUnit) }
        : wUnit === 'lb' ? { label: t('¿Querías decir {v} oz?', { v: disp.weight }), run: () => changeUnits('oz', dUnit) } : undefined,
    });
  }
  if (kg > 0 && liters > 0 && density < 0.004) {
    warnings.push({
      text: t('El peso parece demasiado bajo para una caja de {l} L ({w}).', { l: fmt(liters), w: `${disp.weight} ${wUnit}` }),
      fix: wUnit === 'g' ? { label: t('¿Querías decir {v} kg?', { v: disp.weight }), run: () => changeUnits('kg', dUnit) }
        : wUnit === 'oz' ? { label: t('¿Querías decir {v} lb?', { v: disp.weight }), run: () => changeUnits('lb', dUnit) }
        : dUnit === 'cm' && dims.some((x) => x > 100) ? { label: t('¿Medidas en milímetros? Convertir a cm'), run: () => changeUnits(wUnit, dUnit, mmToCm(disp)) } : undefined,
    });
  }
  if (dims.some((x) => x > 270)) warnings.push({ text: t('Un lado supera 270 cm: la mayoría de transportistas no lo aceptan.') });
  if (kg > 68) warnings.push({ text: t('Más de 68 kg: la mayoría de transportistas no aceptan paquetes tan pesados.') });

  const wPh: Record<WeightUnit, string> = { g: '300', kg: '1.5', oz: '10', lb: '2' };
  const dPh = dUnit === 'cm' ? ['30', '20', '10'] : ['12', '8', '4'];
  return (
    <div className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <span className="text-muted">{t('Unidades:')}</span>
        <Select value={wUnit} onChange={(e) => changeUnits(e.target.value as WeightUnit, dUnit)} className="h-9 w-32" aria-label={t('Unidad de peso')}>
          <option value="g">{t('Gramos (g)')}</option><option value="kg">{t('Kilogramos (kg)')}</option><option value="oz">{t('Onzas (oz)')}</option><option value="lb">{t('Libras (lb)')}</option>
        </Select>
        <Select value={dUnit} onChange={(e) => changeUnits(wUnit, e.target.value as LengthUnit)} className="h-9 w-40" aria-label={t('Unidad de medida')}>
          <option value="cm">{t('Centímetros (cm)')}</option><option value="in">{t('Pulgadas (in)')}</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label={`${t('Peso')} (${wUnit})`} required>
          <Input rule={wUnit === 'g' ? 'integer' : 'measure'} value={disp.weight} onChange={(e) => set('weight', e.target.value)} placeholder={t('Ej. {v}', { v: wPh[wUnit] })} data-ship="weight" />
        </Field>
        <Field label={`${t('Largo')} (${dUnit})`} required><Input rule="measure" value={disp.length} onChange={(e) => set('length', e.target.value)} placeholder={t('Ej. {v}', { v: dPh[0] })} data-ship="length" /></Field>
        <Field label={`${t('Ancho')} (${dUnit})`} required><Input rule="measure" value={disp.width} onChange={(e) => set('width', e.target.value)} placeholder={t('Ej. {v}', { v: dPh[1] })} data-ship="width" /></Field>
        <Field label={`${t('Alto')} (${dUnit})`} required><Input rule="measure" value={disp.height} onChange={(e) => set('height', e.target.value)} placeholder={t('Ej. {v}', { v: dPh[2] })} data-ship="height" /></Field>
      </div>
      <p className="mt-3 text-xs text-muted">
        {t('Medidas del paquete listo para enviar. Escribe números enteros; el punto decimal solo si lo necesitas.')}
        {kg > 0 && ` ${t('Se guarda como {kg} kg.', { kg: fmt(kg) })}`}
      </p>
      {warnings.map((w, i) => (
        <div key={i} role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" data-ship-warning>
          <AlertTriangle className="size-4 shrink-0" /> <span className="flex-1">{w.text}</span>
          {w.fix && <button type="button" onClick={w.fix.run} className="rounded-md bg-white px-2 py-1 text-xs font-semibold text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100">{w.fix.label}</button>}
        </div>
      ))}
    </div>
  );
}

const fmt = (n: number) => String(Number(n.toFixed(n < 1 ? 3 : 1)));
const mmToCm = (d: { weight: string; length: string; width: string; height: string }) => ({
  ...d,
  length: show(num(d.length) / 10, 2),
  width: show(num(d.width) / 10, 2),
  height: show(num(d.height) / 10, 2),
});
