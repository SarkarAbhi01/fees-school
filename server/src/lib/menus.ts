/** Every menu / sub menu the super admin can switch off for a school. Switching off only hides the navigation item and its page:
 *  data, other screens and every API keep working exactly as before. */
export const MENU_KEYS = [
  'dashboard', 'attendance', 'students',
  'fees', 'fees.collect', 'fees.records', 'fees.reports', 'fees.heads', 'fees.structure', 'fees.months', 'fees.late',
  'fees.custom', 'fees.discounts', 'fees.discount_report', 'fees.collectors',
  'backup',
] as const;
export const cleanMenus = (v: unknown): string[] =>
  [...new Set((Array.isArray(v) ? v : []).map(String).filter((k) => (MENU_KEYS as readonly string[]).includes(k)))];
