import { ButtonHTMLAttributes, forwardRef, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';

export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

type Variant = 'primary' | 'outline' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-board text-white hover:bg-board-600 disabled:bg-board/40',
  outline: 'border border-slate-300 bg-white text-ink hover:bg-board-50 disabled:opacity-50',
  ghost: 'text-board hover:bg-board-50 disabled:opacity-50',
  danger: 'bg-bad text-white hover:bg-bad/90 disabled:opacity-50',
};

export function Button({ variant = 'primary', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...p}
      className={cn('inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed', variants[variant], className)}
    />
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(({ className, ...p }, ref) => (
  <input
    ref={ref}
    {...p}
    className={cn('h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm placeholder:text-slate-400', className)}
  />
));

export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cn('h-10 rounded-md border border-slate-300 bg-white px-3 text-sm', className)} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function Panel({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('rounded-lg border border-slate-200 bg-white', className)}>{children}</section>;
}

const badge = { PRESENT: 'bg-good/10 text-good', LATE: 'bg-late/10 text-late', ABSENT: 'bg-bad/10 text-bad', ACTIVE: 'bg-good/10 text-good', INACTIVE: 'bg-slate-200 text-slate-600', LEFT: 'bg-slate-200 text-slate-600' } as Record<string, string>;
export function Badge({ kind }: { kind: string }) {
  return <span className={cn('rounded-sm px-2 py-0.5 text-xs font-semibold', badge[kind])}>{kind === 'LEFT' ? 'Left school' : kind}</span>;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div className={cn('max-h-[92vh] w-full overflow-y-auto rounded-t-xl bg-white p-4 shadow-xl sm:rounded-lg sm:p-6', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-sm px-2 text-xl text-slate-500 hover:bg-slate-100">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Pager({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total === 0 ? 0 : (page - 1) * limit + 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-600">
      <span>{from}–{Math.min(page * limit, total)} of {total}</span>
      <div className="flex gap-2">
        <Button variant="outline" className="h-8 px-3" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button variant="outline" className="h-8 px-3" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

export const th = 'px-4 py-2.5 text-left text-xs font-semibold text-slate-500';
export const td = 'px-4 py-2.5 text-sm';

export const ErrorText = ({ children }: { children?: ReactNode }) =>
  children ? <p role="alert" className="rounded-md bg-bad/10 px-3 py-2 text-sm text-bad">{children}</p> : null;
