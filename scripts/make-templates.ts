// Writes the two blank Excel templates to ./templates  (npm run templates)
import fs from 'fs';
import path from 'path';
import { attendanceTemplate, studentTemplate } from '../server/src/lib/templates';

(async () => {
  const dir = path.join(__dirname, '..', 'templates');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Student_Template.xlsx'), await studentTemplate());
  fs.writeFileSync(path.join(dir, 'Attendance_Template.xlsx'), await attendanceTemplate());
  console.log('Wrote templates/Student_Template.xlsx and templates/Attendance_Template.xlsx');
})();
