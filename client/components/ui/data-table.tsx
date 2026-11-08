"use client";

import { Search } from "lucide-react";
import { Button } from "./button";
import { EmptyState, Skeleton, Spinner } from "./primitives";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  className?: string;
}

/**
 * Plain, accessible table for admin/dashboard lists: loading skeleton, empty state, error,
 * and a "Load more" button for cursor pagination. Scrolls sideways on phones.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  error,
  empty,
  hasMore,
  loadingMore,
  onLoadMore,
  minWidth = 720,
  rowClassName,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  empty?: { title: string; description?: React.ReactNode; icon?: React.ReactNode };
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  minWidth?: number;
  rowClassName?: (row: T) => string | undefined;
}) {
  if (loading) return <Skeleton className="h-64 rounded-2xl" />;
  if (error) return <EmptyState title="Couldn't load this list" description={error} />;
  if (rows.length === 0) return <EmptyState icon={empty?.icon} title={empty?.title ?? "Nothing here"} description={empty?.description} />;

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="w-full text-left text-[14px]" style={{ minWidth }}>
          <thead className="border-b border-line text-[12px] uppercase tracking-wide text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-4 py-3 font-medium first:pl-5 last:pr-5", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={rowKey(r)} className={rowClassName?.(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-4 py-3 align-top first:pl-5 last:pr-5", c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && onLoadMore && (
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={onLoadMore} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}
    </>
  );
}

/** Search box for list filters; shows a spinner while results refresh. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  label,
  busy,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  label: string;
  busy?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="h-10 w-full rounded-lg border border-line bg-card pl-10 pr-9 text-[14px] placeholder:text-ink/30 focus:border-ink focus:outline-none"
      />
      {busy && <Spinner className="absolute right-3 top-1/2 size-4 -translate-y-1/2" />}
    </div>
  );
}

/** Compact native select for filter rows (no label above, unlike <Select>). */
export function FilterSelect<V extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: V | "";
  onChange: (v: V | "") => void;
  options: { value: V | ""; label: string }[];
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as V | "")}
      className="h-10 rounded-lg border border-line bg-card px-3 pr-8 text-[14px] focus:border-ink focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
