"use client";

import { CreditCard } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DashHeader } from "@/components/dashboard/app-shell";
import { DataTable, FilterSelect, type Column } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/primitives";
import { useAdminPayments } from "@/hooks/use-admin";
import { PROVIDER_LABEL, type AdminPayment, type PaymentStatus, type Provider } from "@/lib/api/admin";
import { errorMessage } from "@/lib/api/client";
import { formatMoney } from "@/lib/format";

const STATUS: Record<PaymentStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  initiated: { label: "Started", tone: "neutral" },
  pending: { label: "Pending", tone: "warning" },
  succeeded: { label: "Paid", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  refunded: { label: "Refunded", tone: "neutral" },
};

const isStatus = (v: string | null): v is PaymentStatus => !!v && v in STATUS;
const isProvider = (v: string | null): v is Provider => !!v && v in PROVIDER_LABEL;

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-NP", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Filters live in the URL so links from the overview ("failed payments") land filtered. */
export function AdminPayments() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const status = isStatus(params.get("status")) ? (params.get("status") as PaymentStatus) : "";
  const provider = isProvider(params.get("provider")) ? (params.get("provider") as Provider) : "";
  const list = useAdminPayments({ status: status || undefined, provider: provider || undefined });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  };

  const columns: Column<AdminPayment>[] = [
    { key: "when", header: "Started", cell: (p) => <span className="whitespace-nowrap text-[13px]">{when(p.initiatedAt)}</span> },
    { key: "amount", header: "Amount", cell: (p) => <span className="font-medium tabular-nums">{formatMoney(p.amount, p.currency)}</span> },
    { key: "provider", header: "Gateway", cell: (p) => PROVIDER_LABEL[p.provider] },
    {
      key: "status",
      header: "Status",
      cell: (p) => (
        <div>
          <Badge tone={STATUS[p.status].tone} dot>
            {STATUS[p.status].label}
          </Badge>
          {p.failureReason && <p className="mt-1 max-w-56 text-[12px] text-muted">{p.failureReason}</p>}
        </div>
      ),
    },
    {
      key: "refs",
      header: "References",
      cell: (p) => (
        <div className="font-mono text-[12px] text-muted">
          <p title="Booking id">booking {p.bookingId.slice(-8)}</p>
          {p.providerTxnId && <p title="Gateway transaction id">txn {p.providerTxnId}</p>}
        </div>
      ),
    },
  ];

  return (
    <>
      <DashHeader eyebrow="Admin" title="Payments" description="Every payment attempt across gateways, newest first. Unfinished ones are settled by the worker every 5 minutes." />
      <div className="mb-5 flex flex-wrap gap-3">
        <FilterSelect
          label="Status"
          value={status}
          onChange={(v) => setParam("status", v)}
          options={[{ value: "", label: "Any status" }, ...(Object.keys(STATUS) as PaymentStatus[]).map((s) => ({ value: s, label: STATUS[s].label }))]}
        />
        <FilterSelect
          label="Gateway"
          value={provider}
          onChange={(v) => setParam("provider", v)}
          options={[{ value: "", label: "Any gateway" }, ...(Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))]}
        />
      </div>
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(p) => p.id}
        loading={list.isPending}
        error={list.isError ? errorMessage(list.error) : null}
        empty={{ icon: <CreditCard className="size-5" />, title: "No payments match" }}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
      />
    </>
  );
}
