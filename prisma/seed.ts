import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const NAMES = [
  'Neeraj Sharma', 'Aarav Verma', 'Diya Patel', 'Rohan Gupta', 'Ananya Singh',
  'Vivaan Joshi', 'Isha Mehta', 'Kabir Yadav', 'Saanvi Rao', 'Arjun Nair',
  'Meera Iyer', 'Aditya Jain', 'Kavya Reddy', 'Yash Chauhan', 'Riya Malhotra',
  'Harsh Tiwari', 'Pooja Mishra', 'Dev Saxena', 'Nisha Kapoor', 'Rahul Dubey',
];

const now = new Date();
const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;

async function main() {
  const hash = await bcrypt.hash('123456', 10);

  await prisma.user.upsert({
    where: { email: 'super@saas.com' },
    update: {},
    create: { name: 'Super Admin', email: 'super@saas.com', password: hash, role: 'SUPER_ADMIN' },
  });

  const school = await prisma.school.upsert({
    where: { code: 'IND001' },
    update: {},
    create: { name: 'Demo School', code: 'IND001' },
  });

  await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: { name: 'Demo Admin', email: 'admin@demo.com', password: hash, role: 'SCHOOL_ADMIN', school_id: school.id },
  });

  await prisma.user.upsert({
    where: { email: 'collector@demo.com' },
    update: {},
    create: { name: 'Demo Fees Collector', email: 'collector@demo.com', password: hash, role: 'FEES_COLLECTOR', school_id: school.id },
  });

  // fee heads + per-class amounts (demo values; the admin edits them under Fees > Fee Heads / Fee Structure)
  const heads: Record<string, string> = {};
  for (const [name, transport_only] of [['Tuition fee', false], ['Transport fee', true], ['Library fee', false], ['Exam fee', false]] as const) {
    heads[name] = (await prisma.feeHead.upsert({
      where: { school_id_name: { school_id: school.id, name } }, update: {}, create: { school_id: school.id, name, transport_only },
    })).id;
  }
  // demo fees: tuition monthly, transport monthly, library QUARTERLY, exam fees exam-wise (3 tests at Rs 100 + half-yearly exam Rs 150)
  const exams = [
    { label: 'Unit test 1', month: 2, amount: 100 },       // June
    { label: 'Half-yearly exam', month: 5, amount: 150 },   // September
    { label: 'Unit test 2', month: 8, amount: 100 },       // December
    { label: 'Unit test 3', month: 11, amount: 100 },      // March
  ];
  for (let c = 1; c <= 12; c++) {
    const rows: [string, number, string, typeof exams | null][] = [
      ['Tuition fee', 1500, 'MONTHLY', null], ['Transport fee', 300, 'MONTHLY', null],
      ['Library fee', 150, 'QUARTERLY', null], ['Exam fee', 450, 'CUSTOM', exams],
    ];
    for (const [name, amount, period, installments] of rows) {
      await prisma.classFee.upsert({
        where: { school_id_class_head_id: { school_id: school.id, class: String(c), head_id: heads[name] } },
        update: {}, create: { school_id: school.id, class: String(c), head_id: heads[name], amount, period, ...(installments ? { installments } : {}) },
      });
    }
  }
  await prisma.discount.upsert({
    where: { school_id_name: { school_id: school.id, name: 'Sibling discount (10% tuition)' } }, update: {},
    create: { school_id: school.id, name: 'Sibling discount (10% tuition)', type: 'PERCENT', value: 10, head_id: heads['Tuition fee'] },
  });
  await prisma.discount.upsert({
    where: { school_id_name: { school_id: school.id, name: 'Merit scholarship (Rs 500 library)' } }, update: {},
    create: { school_id: school.id, name: 'Merit scholarship (Rs 500 library)', type: 'FLAT', value: 500, head_id: heads['Library fee'] },
  });

  const students = NAMES.map((name, i) => {
    const n = String(i + 1).padStart(4, '0');
    return {
      school_id: school.id,
      unique_no: `STU-${n}`,
      rfid_uid: `RFID-${n}`,
      name,
      class: String((i % 5) + 1),
      section: i % 2 === 0 ? 'A' : 'B',
      parent_phone: `98765432${String(i).padStart(2, '0')}`,
      uses_transport: i % 2 === 0,
      // a few mid-year admissions (July of the current financial year) to show month-wise billing
      admission_date: i % 5 === 4 ? new Date(Date.UTC(fyStart, 6, 1)) : null,
    };
  });
  await prisma.student.createMany({ data: students, skipDuplicates: true });

  console.log('Seed done:');
  console.log('  SUPER_ADMIN  super@saas.com / 123456');
  console.log('  SCHOOL_ADMIN admin@demo.com / 123456');
  console.log('  FEES_COLLECTOR collector@demo.com / 123456');
  console.log('  20 students STU-0001..STU-0020 | RFID-0001..RFID-0020');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
