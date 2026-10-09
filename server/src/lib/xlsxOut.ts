import ExcelJS from 'exceljs';

export interface Sheet { name: string; columns: { header: string; key: string; width?: number }[]; rows: Record<string, unknown>[] }

const cell = (v: unknown) => (v instanceof Date ? v : v !== null && typeof v === 'object' ? JSON.stringify(v) : typeof v === 'bigint' ? Number(v) : v);

/** Builds an .xlsx in memory from plain rows (one sheet per table). */
export async function workbookBuffer(sheets: Sheet[], title = 'School ERP') {
  const wb = new ExcelJS.Workbook();
  wb.creator = title; wb.created = new Date();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? Math.min(40, Math.max(12, c.header.length + 4)) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of s.rows) ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, cell(v)])));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
