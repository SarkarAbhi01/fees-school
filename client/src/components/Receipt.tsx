import { ReactNode } from 'react';
import { rupees } from '../lib/api';
import { Button } from './ui';

export interface ReceiptData {
  receipt_no: string; date: string; school_name: string; student_name: string; class: string; section?: string; unique_no: string; fy_label: string;
  billing_mode: 'MONTHLY' | 'QUARTERLY' | 'HALF_YEARLY' | 'YEARLY'; months: number; payment_mode: string;
  lines: { head_name: string; amount: number; other_discount: number }[];
  amount_paid: number; discount_amount: number; discount_reason: string | null; fee_months?: string[];
  collected_by_name?: string | null; reprint_count?: number; duplicate?: boolean;
}

export const planText = (mode: string, months: number) =>
  mode === 'MONTHLY' ? `Monthly payment · ${months} month${months > 1 ? 's' : ''}` : mode === 'QUARTERLY' ? 'Quarterly payment · 3 months'
  : mode === 'HALF_YEARLY' ? 'Half-yearly payment · 6 months' : 'Yearly payment (full remaining balance)';
/** Short label for tables. */
export const planShort = (mode: string, months: number) =>
  mode === 'MONTHLY' ? `Monthly${months ? ` (${months})` : ''}` : mode === 'QUARTERLY' ? 'Quarterly' : mode === 'HALF_YEARLY' ? 'Half-yearly' : 'Yearly';

const MODE: Record<string, string> = { CASH: 'cash', UPI: 'UPI', CARD: 'card', CHEQUE: 'cheque' };

/** The printable receipt. Only #receipt prints (see index.css). A reprint is clearly marked as a duplicate copy. */
export function ReceiptView({ receipt, children }: { receipt: ReceiptData; children?: ReactNode }) {
  return (
    <>
      <div id="receipt" className="space-y-1 text-sm">
        {receipt.duplicate && (
          <p className="font-display text-lg font-bold text-late">DUPLICATE COPY{receipt.reprint_count ? ` · Reprint ${receipt.reprint_count}` : ''}</p>
        )}
        <p className="font-display text-xl font-bold">{receipt.school_name}</p>
        <p className="text-slate-600">Fee receipt {receipt.receipt_no} · FY {receipt.fy_label}</p>
        <p className="text-slate-600">Paid on {new Date(receipt.date).toLocaleString('en-IN')}{receipt.duplicate ? ` · Printed on ${new Date().toLocaleString('en-IN')}` : ''}</p>
        <div className="my-3 border-t border-dashed border-slate-300" />
        <p>{receipt.student_name}, Class {receipt.class}{receipt.section ? `-${receipt.section}` : ''} ({receipt.unique_no})</p>
        {receipt.fee_months && receipt.fee_months.length > 0
          ? <p className="text-slate-600">Fee for: <b className="text-ink">{receipt.fee_months.join(', ')}</b></p>
          : <p className="text-slate-600">{planText(receipt.billing_mode, receipt.months)}</p>}
        {receipt.lines.map((l) => (
          <p key={l.head_name} className="flex justify-between"><span>{l.head_name}</span><span>{rupees(l.amount)}{l.other_discount > 0 ? ` (+ discount ${rupees(l.other_discount)})` : ''}</span></p>
        ))}
        <p className="text-lg">Received <b>{rupees(receipt.amount_paid)}</b> by {MODE[receipt.payment_mode] ?? receipt.payment_mode}</p>
        {receipt.discount_amount > 0 && <p>Other discount: <b>{rupees(receipt.discount_amount)}</b>{receipt.discount_reason ? ` (${receipt.discount_reason})` : ''}</p>}
        {receipt.collected_by_name && <p className="text-slate-600">Collected by {receipt.collected_by_name}</p>}
      </div>
      <div className="no-print mt-4 flex flex-wrap gap-2">
        <Button onClick={() => window.print()}>Print receipt</Button>
        {children}
      </div>
    </>
  );
}
