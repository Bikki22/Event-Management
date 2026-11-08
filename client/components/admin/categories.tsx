"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { CornerDownRight, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { DashHeader } from "@/components/dashboard/app-shell";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/inputs";
import { EmptyState, Skeleton } from "@/components/ui/primitives";
import { useCreateCategory, useDeleteCategory, useUpdateCategory } from "@/hooks/use-admin";
import { adminApi } from "@/lib/api/admin";
import { keys } from "@/lib/api/keys";
import type { Category, CategoryNode } from "@/lib/api/catalog";
import { ApiError, errorMessage } from "@/lib/api/client";
import { applyServerErrors } from "@/lib/form-errors";

// Mirrors server/src/modules/categories/categories.schemas.ts
const schema = z.object({
  name: z.string().trim().min(1, { error: "Name is required" }).max(60),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .refine((v) => v === "" || /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v), { error: "Lowercase letters, numbers and single hyphens" }),
  // optional: a disabled select (category with children) submits nothing
  parentId: z.string().optional(),
  sortOrder: z.string().trim().refine((v) => v === "" || (/^\d+$/.test(v) && +v <= 10_000), { error: "A whole number, 0–10000" }),
});
type Values = z.infer<typeof schema>;

type Editing = { kind: "new"; parentId: string } | { kind: "edit"; category: Category; hasChildren: boolean };

export function AdminCategories() {
  // same key as the public tree, so every page gets the fresh copy
  const tree = useQuery({ queryKey: keys.categories.all, queryFn: async () => (await adminApi.categoryTree()).data });
  const del = useDeleteCategory();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const parents = tree.data ?? [];

  return (
    <>
      <DashHeader
        eyebrow="Admin"
        title="Categories"
        description="What buyers filter by. One level of sub-categories; lower sort numbers come first. Changes show on the site right away."
        action={
          <Button className="h-10" onClick={() => setEditing({ kind: "new", parentId: "" })}>
            <Plus className="size-4" /> New category
          </Button>
        }
      />

      {tree.isPending ? (
        <Skeleton className="h-64 rounded-2xl" />
      ) : tree.isError ? (
        <EmptyState title="We couldn't load categories" description={errorMessage(tree.error)} />
      ) : parents.length === 0 ? (
        <EmptyState icon={<Tags className="size-5" />} title="No categories yet" description="Run npm run db:seed in server/ for the defaults, or add your own." />
      ) : (
        <ul className="space-y-3">
          {parents.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-2xl border border-line bg-card">
              <Row
                c={p}
                top
                onEdit={() => setEditing({ kind: "edit", category: p, hasChildren: p.children.length > 0 })}
                onDelete={() => setDeleting(p)}
                onAddChild={() => setEditing({ kind: "new", parentId: p.id })}
              />
              {p.children.length > 0 && (
                <ul className="divide-y divide-line border-t border-line bg-paper/40">
                  {p.children.map((c) => (
                    <li key={c.id}>
                      <Row c={c} onEdit={() => setEditing({ kind: "edit", category: c, hasChildren: false })} onDelete={() => setDeleting(c)} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && <CategoryDialog editing={editing} parents={parents} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "category"}?`}
        description="Only empty categories can be deleted: no sub-categories and no events using it."
        confirmLabel="Delete"
        destructive
        loading={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success(`${deleting.name} deleted`);
              setDeleting(null);
            },
            onError: (err) => {
              setDeleting(null);
              toast.error(
                err instanceof ApiError && err.code === "CATEGORY_HAS_CHILDREN"
                  ? "Delete or move its sub-categories first."
                  : err instanceof ApiError && err.code === "CATEGORY_IN_USE"
                    ? "Events still use this category. Move them to another one first."
                    : errorMessage(err),
              );
            },
          })
        }
      />
    </>
  );
}

function Row({
  c,
  top,
  onEdit,
  onDelete,
  onAddChild,
}: {
  c: Category | CategoryNode;
  top?: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddChild?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-5 py-3">
      {!top && <CornerDownRight className="size-4 shrink-0 text-muted" />}
      <div className="min-w-0 flex-1">
        <p className={top ? "text-[15px] font-semibold" : "text-[14.5px]"}>{c.name}</p>
        <p className="font-mono text-[12px] text-muted">
          /{c.slug} · sort {c.sortOrder}
        </p>
      </div>
      {onAddChild && (
        <button type="button" onClick={onAddChild} className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-muted transition hover:bg-ink/5 hover:text-ink sm:inline-flex">
          <Plus className="size-3.5" /> Sub-category
        </button>
      )}
      <button type="button" onClick={onEdit} aria-label={`Edit ${c.name}`} className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-ink/5 hover:text-ink">
        <Pencil className="size-4" />
      </button>
      <button type="button" onClick={onDelete} aria-label={`Delete ${c.name}`} className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-red-50 hover:text-red-600">
        <Trash2 className="size-4" />
      </button>
    </div>
  );
}

function CategoryDialog({ editing, parents, onClose }: { editing: Editing; parents: CategoryNode[]; onClose: () => void }) {
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const [formError, setFormError] = useState<string | null>(null);
  const c = editing.kind === "edit" ? editing.category : null;
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, dirtyFields },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: c?.name ?? "",
      slug: c?.slug ?? "",
      parentId: c ? (c.parentId ?? "") : editing.kind === "new" ? editing.parentId : "",
      sortOrder: c ? String(c.sortOrder) : "",
    },
  });
  // a category with sub-categories must stay top level (one level only)
  const parentOptions = [
    { value: "", label: "None (top level)" },
    ...parents.filter((p) => p.id !== c?.id).map((p) => ({ value: p.id, label: p.name })),
  ];

  const onSubmit = handleSubmit(async (v) => {
    setFormError(null);
    try {
      if (c) {
        const body = {
          ...(dirtyFields.name ? { name: v.name } : {}),
          ...(dirtyFields.slug && v.slug ? { slug: v.slug } : {}),
          ...(dirtyFields.parentId ? { parentId: v.parentId || null } : {}),
          ...(dirtyFields.sortOrder && v.sortOrder !== "" ? { sortOrder: Number(v.sortOrder) } : {}),
        };
        if (Object.keys(body).length === 0) return onClose();
        await update.mutateAsync({ id: c.id, body });
        toast.success(`${v.name} updated`);
      } else {
        await create.mutateAsync({
          name: v.name,
          ...(v.slug ? { slug: v.slug } : {}),
          ...(v.parentId ? { parentId: v.parentId } : {}),
          ...(v.sortOrder !== "" ? { sortOrder: Number(v.sortOrder) } : {}),
        });
        toast.success(`${v.name} added`);
      }
      onClose();
    } catch (err) {
      const at = err instanceof ApiError ? ({ SLUG_TAKEN: "slug", NAME_TAKEN: "name", MAX_DEPTH: "parentId", INVALID_PARENT: "parentId", SLUG_REQUIRED: "slug" } as const)[err.code as "SLUG_TAKEN"] : undefined;
      if (at) return setError(at, { type: "server", message: (err as ApiError).message }, { shouldFocus: true });
      setFormError(applyServerErrors(err, setError, ["name", "slug", "parentId", "sortOrder"]));
    }
  });

  return (
    <Dialog open onClose={onClose} title={c ? `Edit ${c.name}` : "New category"}>
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <FormAlert message={formError} />
        <Field label="Name" placeholder="Jazz" error={errors.name?.message} {...register("name")} />
        <Field
          label="Address"
          placeholder="Made from the name"
          labelAside={<span className="text-[12px] text-muted">Optional</span>}
          error={errors.slug?.message}
          hint={<p className="text-[12.5px] text-muted">{c ? "Changing it breaks old /categories links." : "Used in /categories/… links."}</p>}
          {...register("slug")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Parent"
            options={parentOptions}
            disabled={editing.kind === "edit" && editing.hasChildren}
            hint={editing.kind === "edit" && editing.hasChildren ? "Has sub-categories, so it stays top level." : undefined}
            error={errors.parentId?.message}
            {...register("parentId")}
          />
          <Field label="Sort order" inputMode="numeric" placeholder="0" error={errors.sortOrder?.message} {...register("sortOrder")} />
        </div>
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={create.isPending || update.isPending}>
            {c ? "Save changes" : "Add category"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
