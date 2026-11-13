'use client';
import { getIntlLocale, t } from '@/lib/i18n';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money, compact } from '@/lib/utils';

const BRAND = '#0a6cf5';
const PALETTE = ['#0a6cf5', '#f5901a', '#8ebbfd', '#fbd09a', '#34d399', '#f87171', '#60a5fa'];

const dayLabel = (d: string) => new Date(d + (d.length === 10 ? 'T12:00:00' : '')).toLocaleDateString(getIntlLocale(), { day: '2-digit', month: 'short' });

export function AreaTrend({ data, xKey = 'day', yKey = 'sales', height = 260, currency = true, color = BRAND }: { data: any[]; xKey?: string; yKey?: string; height?: number; currency?: boolean; color?: string }) {
  const rows = data.map((d) => ({ ...d, [yKey]: Number(d[yKey]) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`g-${yKey}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="#e9eef6" vertical={false} />
        <XAxis dataKey={xKey} tickFormatter={dayLabel} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickFormatter={(v) => (currency ? `$${compact(v)}` : compact(v))} tickLine={false} axisLine={false} width={56} />
        <Tooltip formatter={(v: any) => (currency ? money(v) : v)} labelFormatter={dayLabel} contentStyle={{ borderRadius: 12, border: '1px solid #e3e8f0' }} />
        <Area type="monotone" dataKey={yKey} stroke={color} strokeWidth={2.5} fill={`url(#g-${yKey})`} dot={false} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, total, label, height = 220 }: { data: { name: string; value: number }[]; total: React.ReactNode; label: string; height?: number }) {
  const sum = data.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div className="relative" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={sum ? data : [{ name: t('Sin datos'), value: 1 }]} dataKey="value" innerRadius="62%" outerRadius="95%" paddingAngle={1} stroke="none">
              {(sum ? data : [{}]).map((_, i) => <Cell key={i} fill={sum ? PALETTE[i % PALETTE.length] : '#e9eef6'} />)}
            </Pie>
            {sum ? <Tooltip contentStyle={{ borderRadius: 12 }} /> : null}
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div><p className="text-2xl font-extrabold">{total}</p><p className="text-xs text-muted">{label}</p></div>
        </div>
      </div>
      <ul className="min-w-40 flex-1 space-y-2.5 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="flex-1 text-muted">{t(d.name)}</span>
            <b>{sum ? Math.round((d.value / sum) * 100) : 0} %</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Bars({ data, xKey, bars, height = 260, stacked = false, xFormatter }: { data: any[]; xKey: string; bars: { key: string; name: string; color?: string }[]; height?: number; stacked?: boolean; xFormatter?: (v: any) => string }) {
  const rows = data.map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, bars.some((b) => b.key === k) ? Number(v) : v])));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="#e9eef6" vertical={false} />
        <XAxis dataKey={xKey} tickLine={false} axisLine={false} tickFormatter={xFormatter} minTickGap={8} />
        <YAxis tickFormatter={(v) => `$${compact(v)}`} tickLine={false} axisLine={false} width={56} />
        <Tooltip formatter={(v: any) => money(v)} labelFormatter={xFormatter} contentStyle={{ borderRadius: 12, border: '1px solid #e3e8f0' }} />
        {bars.length > 1 && <Legend iconType="square" />}
        {bars.map((b, i) => <Bar key={b.key} dataKey={b.key} name={t(b.name)} stackId={stacked ? 's' : undefined} fill={b.color ?? PALETTE[i]} radius={stacked && i < bars.length - 1 ? 0 : [6, 6, 0, 0]} maxBarSize={36} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export { dayLabel };
