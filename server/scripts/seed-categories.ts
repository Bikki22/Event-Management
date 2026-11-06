/**
 * Inserts the default categories. Safe to run repeatedly: existing slugs are left untouched,
 * so names or order you changed through the admin API are not overwritten.
 *   npm run db:seed
 */
import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";
import { slugify } from "../src/lib/slug.js";

const CATEGORIES: { name: string; children?: string[] }[] = [
  { name: "Music", children: ["Concerts", "Music Festivals", "DJ Nights", "Classical", "Folk"] },
  { name: "Comedy", children: ["Stand-up", "Improv"] },
  { name: "Theatre & Arts", children: ["Plays", "Dance", "Exhibitions"] },
  { name: "Sports", children: ["Football", "Cricket", "Running", "Esports"] },
  { name: "Conferences", children: ["Tech", "Business", "Education"] },
  { name: "Workshops", children: ["Photography", "Cooking", "Art & Craft"] },
  { name: "Food & Drink" },
  { name: "Nightlife" },
  { name: "Festivals & Culture" },
  { name: "Kids & Family" },
];

async function ensure(name: string, sortOrder: number, parentId: string | null) {
  const slug = slugify(name);
  const existing = await prisma.category.findUnique({ where: { slug } });
  if (existing) return { id: existing.id, created: false };
  const row = await prisma.category.create({ data: { name, slug, sortOrder, parentId } });
  return { id: row.id, created: true };
}

try {
  let created = 0;
  for (const [i, top] of CATEGORIES.entries()) {
    const parent = await ensure(top.name, i * 10, null);
    created += Number(parent.created);
    for (const [j, child] of (top.children ?? []).entries()) {
      created += Number((await ensure(child, j * 10, parent.id)).created);
    }
  }
  await redis.del("cat:all"); // public list picks up the new rows
  console.log(`Categories seeded: ${created} created.`);
} finally {
  await prisma.$disconnect();
  redis.disconnect();
}
