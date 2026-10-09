import ExcelJS from 'exceljs';

const BOARD = 'FF173A31', BOARD_LIGHT = 'FF1F4A3E', PAPER = 'FFF4F6F5';

function header(ws: ExcelJS.Worksheet, cols: { key: string; width: number; required?: boolean; note: string; text?: boolean; fmt?: string }[]) {
  ws.columns = cols.map((c) => ({ header: c.key, key: c.key, width: c.width, style: c.text ? { numFmt: '@' } : c.fmt ? { numFmt: c.fmt } : {} }));
  const row = ws.getRow(1);
  row.height = 22;
  cols.forEach((c, i) => {
    const cell = row.getCell(i + 1);
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? BOARD : BOARD_LIGHT } };
    cell.alignment = { vertical: 'middle' };
    cell.note = `${c.required ? 'REQUIRED. ' : 'Optional. '}${c.note}`;
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function instructions(wb: ExcelJS.Workbook, title: string, lines: string[]) {
  const ws = wb.addWorksheet('Instructions');
  ws.getColumn(1).width = 110;
  const t = ws.getCell('A1'); t.value = title; t.font = { bold: true, size: 14, color: { argb: BOARD } };
  lines.forEach((l, i) => { const c = ws.getCell(`A${i + 3}`); c.value = l; c.alignment = { wrapText: true, vertical: 'top' }; if (!l) return; if (/^[A-Z ]+:$/.test(l)) c.font = { bold: true }; });
  ws.properties.tabColor = { argb: PAPER };
}

/** exceljs supports range validations at runtime but does not type them. */
const validate = (ws: ExcelJS.Worksheet, range: string, dv: ExcelJS.DataValidation) => (ws as any).dataValidations.add(range, dv);

const ROWS = 2000; // validation / formatting reaches this many data rows
const MODES = ['Yes', 'No'];

/* ======================= STUDENTS ======================= */
export async function studentTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'School ERP';
  const ws = wb.addWorksheet('Students');
  header(ws, [
    { key: 'unique_no', width: 16, text: true, note: 'Leave empty and the system generates it (e.g. DEMO-0021). Used to search a student for fees.' },
    { key: 'rfid_uid', width: 20, required: true, text: true, note: 'The number printed/stored on the 12-year RFID card. Keep it as text.' },
    { key: 'name', width: 26, required: true, text: true, note: 'Full name of the student.' },
    { key: 'class', width: 9, required: true, text: true, note: 'Class, for example 6 (or LKG, UKG).' },
    { key: 'section', width: 9, text: true, note: 'Section, for example A.' },
    { key: 'parent_phone', width: 16, text: true, note: 'Parent mobile number for WhatsApp alerts. Keep it as text so a leading 0 is not lost.' },
    { key: 'uses_transport', width: 16, note: 'Choose Yes or No. Transport fee applies only to Yes.' },
    { key: 'admission_date', width: 16, fmt: 'yyyy-mm-dd', note: 'Fee billing starts from this month (April to March year). Empty = billed from April. Format 2026-07-15 or 15/07/2026.' },
  ]);
  const last = ROWS + 1;
  validate(ws, `G2:G${last}`, { type: 'list', allowBlank: true, formulae: [`"${MODES.join(',')}"`], showErrorMessage: true, errorTitle: 'Choose Yes or No', error: 'Pick Yes or No from the list.' });
  validate(ws, `H2:H${last}`, { type: 'date', operator: 'between', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2100, 11, 31))], showErrorMessage: true, errorTitle: 'Not a date', error: 'Enter a date such as 2026-07-15.' });

  const ex = wb.addWorksheet('Example');
  header(ex, [
    { key: 'unique_no', width: 16, text: true, note: '' }, { key: 'rfid_uid', width: 20, required: true, text: true, note: '' }, { key: 'name', width: 26, required: true, text: true, note: '' },
    { key: 'class', width: 9, required: true, text: true, note: '' }, { key: 'section', width: 9, text: true, note: '' }, { key: 'parent_phone', width: 16, text: true, note: '' },
    { key: 'uses_transport', width: 16, note: '' }, { key: 'admission_date', width: 16, fmt: 'yyyy-mm-dd', note: '' },
  ]);
  ex.addRows([
    ['', '112233445501', 'Aman Khan', '6', 'A', '9876500001', 'Yes', new Date(Date.UTC(2026, 3, 5))],
    ['', '112233445502', 'Bhavna Rathore', '6', 'A', '9876500002', 'No', new Date(Date.UTC(2026, 6, 12))],
    ['', '112233445503', 'Chirag Soni', '7', 'B', '9876500003', 'Yes', null],
  ]);

  instructions(wb, 'Student upload template', [
    'HOW TO USE:',
    '1. Type students on the "Students" sheet, one student per row, starting at row 2. (The "Example" sheet only shows how rows look; it is not uploaded.)',
    '2. Save the file as .xlsx and upload it in the app: Students > Bulk upload.',
    '',
    'COLUMNS:',
    'unique_no - optional. Leave empty and the system creates one (DEMO-0021 ...). This is what you type on the Fees screen.',
    'rfid_uid - REQUIRED. The card number. Must be unique for each student.',
    'name - REQUIRED.',
    'class - REQUIRED. For example 6.',
    'section - optional.',
    'parent_phone - optional. Parent mobile number for WhatsApp alerts.',
    'uses_transport - optional. Yes or No (default No). The transport fee is charged only to students marked Yes.',
    'admission_date - optional. Fee billing starts from this month, and the fee year always runs April to March. Empty = billed from April.',
    '',
    'GOOD TO KNOW:',
    'Rows missing rfid_uid, name or class are skipped and listed after the upload. Students that already exist (same unique_no or card number) are skipped, not changed.',
    'Do not rename the column headings in row 1. Only the first sheet is read.',
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ======================= ATTENDANCE ======================= */
export interface AttendanceTemplateRow { unique_no: string; name: string; class: string }

export async function attendanceTemplate(opts: { date?: Date; students?: AttendanceTemplateRow[] } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'School ERP';
  const ws = wb.addWorksheet('Attendance');
  header(ws, [
    { key: 'unique_no', width: 16, required: true, text: true, note: 'The student unique no, for example DEMO-0001.' },
    { key: 'name', width: 26, text: true, note: 'For your reference only. Not read on upload.' },
    { key: 'class', width: 9, text: true, note: 'For your reference only. Not read on upload.' },
    { key: 'date', width: 14, required: true, fmt: 'yyyy-mm-dd', note: 'The school day. Format 2026-10-03 or 03/10/2026. Cannot be in the future.' },
    { key: 'status', width: 14, required: true, note: 'Choose PRESENT, LATE or ABSENT. Leave empty to skip the row.' },
    { key: 'in_time', width: 12, text: true, note: 'Optional, 24-hour HH:MM, for example 08:15. If status is empty, a time after the school late time becomes LATE.' },
    { key: 'out_time', width: 12, text: true, note: 'Optional, 24-hour HH:MM, for example 14:30.' },
  ]);
  const students = opts.students ?? [];
  students.forEach((s) => ws.addRow([s.unique_no, s.name, s.class, opts.date ?? null, null, null, null]));
  const last = Math.max(ROWS, students.length) + 1;
  validate(ws, `E2:E${last}`, { type: 'list', allowBlank: true, formulae: ['"PRESENT,LATE,ABSENT"'], showErrorMessage: true, errorTitle: 'Choose a status', error: 'Pick PRESENT, LATE or ABSENT.' });
  // name/class are only there to help whoever fills the sheet
  [2, 3].forEach((c) => { ws.getColumn(c).font = { color: { argb: 'FF64748B' } }; });

  instructions(wb, 'Attendance upload template', [
    'HOW TO USE:',
    students.length
      ? `1. This sheet already lists ${students.length} students. Fill the "status" column for each (PRESENT, LATE or ABSENT). Rows left empty are skipped.`
      : '1. Add one row per student per day: unique_no, date and status. You can put many days in one file.',
    '2. Save the file as .xlsx and upload it in the app: Attendance > Upload Excel.',
    '',
    'COLUMNS:',
    'unique_no - REQUIRED. The student unique no.',
    'name, class - for your reference only; they are not read.',
    'date - REQUIRED. 2026-10-03 or 03/10/2026. Future dates are rejected.',
    'status - PRESENT, LATE or ABSENT (P, L, A also work). Empty = row skipped.',
    'in_time, out_time - optional, 24-hour HH:MM (08:15). Ignored for ABSENT.',
    '',
    'GOOD TO KNOW:',
    'Uploading replaces the attendance already saved for that student and date, so a correction is just another upload.',
    'Late is counted separately; a late student is still counted as present.',
    'Only the first sheet is read. Do not rename the column headings in row 1.',
  ]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
