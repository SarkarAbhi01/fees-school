import { th } from './ui';

/** Clickable column header: click to sort, click again to reverse. */
export default function SortTh({ label, k, sort, dir, onSort }: { label: string; k: string; sort: string; dir: 'asc' | 'desc'; onSort: (k: string) => void }) {
  const on = sort === k;
  return (
    <th className={th} aria-sort={on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(k)} className={`inline-flex items-center gap-1 font-semibold ${on ? 'text-board' : 'hover:text-ink'}`}>
        {label}<span aria-hidden className="text-[10px]">{on ? (dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </button>
    </th>
  );
}
