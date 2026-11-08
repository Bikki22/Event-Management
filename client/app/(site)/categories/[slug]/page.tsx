import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BrowseView } from "@/components/events/browse-view";
import { EventCardSkeleton, EventGrid } from "@/components/events/event-card";
import { Container, PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/primitives";
import { getCategory } from "@/lib/server/public-data";

export async function generateMetadata({ params }: PageProps<"/categories/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) return { title: "Category not found" };
  return {
    title: `${category.name} events`,
    description: `Upcoming ${category.name.toLowerCase()} events on Book Event.`,
  };
}

export default function Page({ params }: PageProps<"/categories/[slug]">) {
  return (
    <Container className="py-10 sm:py-14">
      <Suspense fallback={<CategorySkeleton />}>
        <CategoryContent params={params} />
      </Suspense>
    </Container>
  );
}

async function CategoryContent({ params }: Pick<PageProps<"/categories/[slug]">, "params">) {
  const { slug } = await params;
  const category = await getCategory(slug);
  if (!category) notFound();

  const related = category.children.length > 0 ? category.children : [];
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-[13.5px] text-muted">
        <Link href="/events" className="hover:text-ink">
          Events
        </Link>
        {category.parent && (
          <>
            <span aria-hidden>/</span>
            <Link href={`/categories/${category.parent.slug}`} className="hover:text-ink">
              {category.parent.name}
            </Link>
          </>
        )}
      </nav>
      <PageHeader eyebrow="Category" title={category.name} />

      {related.length > 0 && (
        <ul className="mt-6 flex flex-wrap gap-2" aria-label={`${category.name} sub-categories`}>
          {related.map((c) => (
            <li key={c.id}>
              <Link
                href={`/categories/${c.slug}`}
                className="inline-flex h-9 items-center rounded-full border border-line bg-card px-3.5 text-[13.5px] text-ink/75 transition hover:border-ink/30 hover:text-ink"
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8">
        {/* the list reads filters from the URL (useSearchParams), so it needs its own boundary */}
        <Suspense fallback={<ListSkeleton />}>
          <BrowseView lockedCategory={category.slug} />
        </Suspense>
      </div>
    </>
  );
}

function ListSkeleton() {
  return (
    <EventGrid className="mt-24">
      {Array.from({ length: 6 }, (_, i) => (
        <EventCardSkeleton key={i} />
      ))}
    </EventGrid>
  );
}

function CategorySkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-4 h-11 w-64" />
      <ListSkeleton />
    </>
  );
}
