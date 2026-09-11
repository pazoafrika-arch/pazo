/**
 * Minimal RFC 4180 CSV writer for the export buttons.
 * Values are prefixed with an apostrophe when they could be read as a formula,
 * so an exported file cannot execute anything when opened in a spreadsheet.
 */

const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  let str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (FORMULA_START.test(str)) str = `'${str}`;
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

const headerLabel = (key) =>
  key
    .replace(/_tzs$/, ' (TZS)')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export function toCsv(rows, columns = null) {
  if (!rows || !rows.length) return '';
  const keys = columns || Object.keys(rows[0]);
  const head = keys.map((k) => cell(headerLabel(k))).join(',');
  const body = rows.map((row) => keys.map((k) => cell(row[k])).join(',')).join('\r\n');
  return `${head}\r\n${body}\r\n`;
}
