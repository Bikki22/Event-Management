"use client";

import { Receipt, RotateCcw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { DashHeader } from "@/components/dashboard/app-shell";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Badge } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/tabs";
import { useAdminRefunds, useRefundAction } from "@/hooks/use-admin";
import { PROVIDER_LABEL, type AdminRefund, type RefundStatus } from "@/lib/api/admin";
import { ApiError, errorMessage } from "@/lib/api/client";
import { formatMoney, formatRelative } from "@/lib/format";

type Tab = "manual" | "failed" | "processing" | "succeeded" | "all";

const TABS: { value: Tab; label: string; filter: { status?: RefundStatus; manual?: boolean } }[] = [
  { value: "manual", label: "Pay back by hand", filter: { status: "processing", manual: true } },
  { value: "failed", label: "Failed", filter: { status: "failed" } },
  { value: "processing", label: "In progress", filter: { status: "processing" } },
  { value: "succeeded", label: "Done", filter: { status: "succeeded" } },
  { value: "all", label: "All", filter: {} },
];
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.value === v);

const STATUS: Record<RefundStatus, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  requested: { label: "Requested", tone: "neutral" },
  processing: { label: "Processing", tone: "warning" },
  succeeded: { label: "Refunded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export function AdminRefunds() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = isTab(params.get("tab")) ? (params.get("tab") as Tab) : "manual";
  const list = useAdminRefunds(TABS.find((t) => t.value === tab)!.filter);
  const action = useRefundAction();
  const [completing, setCompleting] = useState<AdminRefund | null>(null);

  const retry = (r: AdminRefund) =>
    action.mutate(
      { id: r.id, action: "retry" },
      {
        onSuccess: () => toast.success(`Refund for ${r.bookingCode} is queued again`),
        onError: (err) =>
          toast.error(err instanceof ApiError && err.code === "REFUND_NOT_RETRYABLE" ? `This refund can't be retried: ${err.message}` : errorMessage(err)),
      },
    );

  const columns: Column<AdminRefund>[] = [
    {
      key: "booking",
      header: "Booking",
      cell: (r) => (
        <div>
          <p className="font-mono text-[13px] font-medium">{r.bookingCode}</p>
          <p className="text-[12.5px] text-muted">{formatRelative(r.createdAt)}</p>
        </div>
      ),
    },
    { key: "amount", header: "Amount", cell: (r) => <span className="font-medium tabular-nums">{formatMoney(r.amount, r.currency)}</span> },
    {
      key: "via",
      header: "Gateway",
      cell: (r) => (
        <div>
          <p>{r.provider ? PROVIDER_LABEL[r.provider] : "–"}</p>
          {r.manual && <p className="text-[12px] text-muted">by hand</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (r) => (
        <div>
          <Badge tone={STATUS[r.status].tone} dot>
            {r.manual && r.status === "processing" ? "Waiting for you" : STATUS[r.status].label}
          </Badge>
          {(r.failureReason || r.reason) && <p className="mt-1 max-w-64 text-[12px] text-muted">{r.failureReason ?? `Reason: ${r.reason}`}</p>}
        </div>
      ),
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      className: "text-right",
      cell: (r) =>
        r.status === "succeeded" ? null : (
          <div className="flex justify-end gap-2">
            {r.status === "failed" && (
              <Button variant="secondary" className="h-9 px-3 text-[13px]" onClick={() => retry(r)} disabled={action.isPending}>
                <RotateCcw className="size-3.5" /> Retry
              </Button>
            )}
            {(r.manual || r.status === "failed") && (
              <Button className="h-9 px-3 text-[13px]" onClick={() => setCompleting(r)}>
                Mark refunded
              </Button>
            )}
          </div>
        ),
    },
  ];

  return (
    <>
      <DashHeader
        eyebrow="Admin"
        title="Refunds"
        description="Khalti and the test gateway refund automatically. eSewa has no refund API: send the money back yourself, then mark it refunded here."
      />
      <Tabs
        value={tab}
        onChange={(t) => router.replace(`${pathname}?tab=${t}`, { scroll: false })}
        items={TABS.map((t) => ({ value: t.value, label: t.label }))}
        className="mb-5 overflow-x-auto [scrollbar-width:none]"
      />
      <DataTable
        columns={columns}
        rows={list.rows}
        rowKey={(r) => r.id}
        loading={list.isPending}
        error={list.isError ? errorMessage(list.error) : null}
        empty={{
          icon: <Receipt className="size-5" />,
          title: tab === "manual" ? "Nothing to pay back" : tab === "failed" ? "No failed refunds" : "No refunds here",
          description: tab === "manual" ? "eSewa refunds that need a manual transfer show up here." : undefined,
        }}
        hasMore={list.hasNextPage}
        loadingMore={list.isFetchingNextPage}
        onLoadMore={() => list.fetchNextPage()}
      />
      {completing && <CompleteDialog r={completing} onClose={() => setCompleting(null)} />}
    </>
  );
}

function CompleteDialog({ r, onClose }: { r: AdminRefund; onClose: () => void }) {
  const action = useRefundAction();
  const [ref, setRef] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    action.mutate(
      { id: r.id, action: "complete", providerRefundId: ref.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`${r.bookingCode} marked as refunded`);
          onClose();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Mark ${formatMoney(r.amount, r.currency)} as refunded?`}
      description={
        <>
          Only do this <strong className="text-ink">after</strong> the money has been sent back to the buyer of booking{" "}
          <span className="font-mono">{r.bookingCode}</span>. The booking and payment are marked refunded, and it can&apos;t be undone here.
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormAlert message={error} />
        <Field
          label="Transfer reference"
          placeholder="eSewa / bank transaction id"
          labelAside={<span className="text-[12px] text-muted">Recommended</span>}
          value={ref}
          onChange={(e) => setRef(e.target.value)}
          maxLength={200}
          hint={<p className="text-[12.5px] text-muted">Saved with the refund so anyone can trace it later.</p>}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={action.isPending}>
            Mark refunded
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
