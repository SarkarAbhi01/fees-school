import fs from 'fs';
import readline from 'readline';
import ExcelJS from 'exceljs';
import { HttpError } from './util';

/**
 * Reads an uploaded .xlsx or .csv as rows of { column_name: text }. Rows stream one at a time, so a big file never sits in RAM.
 * Column names are lower-cased with spaces turned into underscores ("Unique No" -> unique_no).
 */
export interface UploadedFile { path: string; originalname: string }
export type SheetRow = Record<string, string>;

export const normHeader = (h: unknown) => String(h ?? '').trim().toLowerCase().replace(/\(.*?\)/g, '').trim().replace(/[\s-]+/g, '_');

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Text of one Excel cell. Dates become YYYY-MM-DD, time-only cells become HH:MM, numbers lose a trailing .0. */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return v.getUTCFullYear() < 1950 ? `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` : `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  }
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'object') {
    const o = v as any;
    if (Array.isArray(o.richText)) return o.richText.map((t: any) => t.text).join('').trim();
    if ('result' in o) return cellText(o.result);
    if ('text' in o) return cellText(o.text);
    return '';
  }
  return String(v).trim();
}

export async function* readRows(file: UploadedFile): AsyncGenerator<SheetRow> {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.xls')) throw new HttpError(400, 'Old .xls files are not supported. Save the sheet as .xlsx (Excel Workbook) or .csv and upload again.');

  if (name.endsWith('.xlsx')) {
    const wb = new ExcelJS.stream.xlsx.WorkbookReader(file.path, { sharedStrings: 'cache', styles: 'cache', hyperlinks: 'ignore', worksheets: 'emit' });
    try {
      for await (const ws of wb as any) {                       // only the FIRST sheet is read
        let header: string[] | null = null;
        for await (const row of ws) {
          const values: unknown[] = Array.isArray(row.values) ? row.values : [];
          const cells = values.slice(1).map(cellText);          // exceljs rows are 1-based
          if (!cells.some((c) => c !== '')) continue;
          if (!header) { header = cells.map(normHeader); continue; }
          const out: SheetRow = {};
          header.forEach((h, i) => { if (h) out[h] = cells[i] ?? ''; });
          yield out;
        }
        return;
      }
    } catch (e: any) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, 'This file could not be read. Make sure it is a valid .xlsx file.');
    }
    return;
  }

  if (name.endsWith('.csv')) {
    const rl = readline.createInterface({ input: fs.createReadStream(file.path, { encoding: 'utf8' }), crlfDelay: Infinity });
    let header: string[] | null = null;
    for await (const line of rl) {
      if (!line.trim()) continue;
      if (!header) { header = parseCsvLine(line.replace(/^\uFEFF/, '')).map(normHeader); continue; }
      const cols = parseCsvLine(line);
      const out: SheetRow = {};
      header.forEach((h, i) => { if (h) out[h] = cols[i] ?? ''; });
      yield out;
    }
    return;
  }
  throw new HttpError(400, 'Upload an Excel (.xlsx) or CSV (.csv) file');
}

/** YYYY-MM-DD, DD/MM/YYYY or DD-MM-YYYY -> UTC-midnight Date. Anything else (or an impossible date) -> null. */
export function parseFlexDate(v: string): Date | null {
  const t = v.trim();
  let y: number, m: number, d: number, x: RegExpMatchArray | null;
  if ((x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/))) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) { d = +x[1]; m = +x[2]; y = +x[3]; }
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/** "08:15", "8:15", "08:15:30", "8:15 AM", "5:30 pm" or an Excel fraction of a day (0.34375) -> minutes after midnight. */
export function parseTimeMinutes(v: string): number | null {
  const t = v.trim().toLowerCase();
  if (!t) return null;
  let x: RegExpMatchArray | null;
  if ((x = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/))) {
    let h = +x[1]; const mi = +x[2];
    if (x[3]) { if (h < 1 || h > 12) return null; h = (h % 12) + (x[3] === 'pm' ? 12 : 0); }
    return h < 24 && mi < 60 ? h * 60 + mi : null;
  }
  if (/^0?\.\d+$|^0$/.test(t) || /^0\.\d+$/.test(t)) return Math.round(parseFloat(t) * 1440) % 1440;
  return null;
}
