/** Menu switches. Super admin can hide any of these for a school (Schools > school name > Menus). Hiding only removes the link and page. */
export interface MenuDef { key: string; label: string; parent?: string }
export const MENU_DEFS: MenuDef[] = [
  { key: 'dashboard', label: 'Dashboard' }, { key: 'attendance', label: 'Attendance' }, { key: 'students', label: 'Students' },
  { key: 'fees', label: 'Fees (whole section)' },
  { key: 'fees.collect', label: 'Collect Fee', parent: 'fees' }, { key: 'fees.records', label: 'Fee Records', parent: 'fees' },
  { key: 'fees.reports', label: 'Fee Reports', parent: 'fees' }, { key: 'fees.heads', label: 'Fee Heads', parent: 'fees' },
  { key: 'fees.structure', label: 'Fee Structure', parent: 'fees' }, { key: 'fees.months', label: 'Fee Months', parent: 'fees' },
  { key: 'fees.late', label: 'Due Date & Late Fee', parent: 'fees' }, { key: 'fees.custom', label: 'Custom Fees', parent: 'fees' },
  { key: 'fees.discounts', label: 'Discounts', parent: 'fees' }, { key: 'fees.discount_report', label: 'Discount Report', parent: 'fees' },
  { key: 'fees.collectors', label: 'Fee Collectors', parent: 'fees' },
  { key: 'backup', label: 'Backup' },
];

/** A menu is visible unless it, or its parent, was switched off. */
export const menuOn = (disabled: string[] | undefined, key: string) => {
  const off = disabled ?? [];
  if (off.includes(key)) return false;
  const parent = MENU_DEFS.find((m) => m.key === key)?.parent;
  return !(parent && off.includes(parent));
};

/** Which menu key a URL belongs to (null = always allowed, e.g. change password). */
export function menuOfPath(path: string): string | null {
  const table: [string, string][] = [
    ['/fees/collect', 'fees.collect'], ['/fees/records', 'fees.records'], ['/fees/reports', 'fees.reports'], ['/fees/heads', 'fees.heads'],
    ['/fees/structure', 'fees.structure'], ['/fees/months', 'fees.months'], ['/fees/late', 'fees.late'], ['/fees/custom', 'fees.custom'],
    ['/fees/discount-report', 'fees.discount_report'], ['/fees/discounts', 'fees.discounts'], ['/fees/collectors', 'fees.collectors'],
    ['/fees', 'fees'], ['/dashboard', 'dashboard'], ['/attendance', 'attendance'], ['/students', 'students'], ['/backup', 'backup'],
  ];
  return table.find(([p]) => path === p || path.startsWith(`${p}/`))?.[1] ?? null;
}
