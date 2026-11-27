/**
 * CSV encoding for every export a user downloads. Text that starts with a spreadsheet formula
 * marker (= + - @, tab or CR) gets a leading apostrophe so Excel/Sheets show it as text instead
 * of running it (seller-controlled titles and SKUs reach admin exports). Plain numbers stay numbers.
 */
const FORMULA = /^[\s]*[=+\-@\t\r]/;
const NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  let s = value == null ? '' : String(value);
  if (typeof value !== 'number' && FORMULA.test(s) && !NUMBER.test(s.trim())) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(',')).join('\n');
}
