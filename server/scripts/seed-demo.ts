/**
 * Demo data for building and testing the frontend: 3 verified organizers, shared venues,
 * and ~16 upcoming published events with covers and ticket types (one free, one sold out,
 * some online). Dev only. Safe to run repeatedly: anything that already exists is skipped.
 *   npm run db:seed          (categories first)
 *   npm run db:seed:demo
 *
 * Demo organizers can sign in with password "demo12345" (e.g. ktm-live@demo.bookevent.dev).
 * Cover images are stock photos from picsum.photos, stored as "ready" uploads.
 */
import { env } from "../src/config/env.js";
import { prisma } from "../src/lib/prisma.js";
import { redis } from "../src/lib/redis.js";
import { hashPassword } from "../src/modules/auth/password.js";

if (env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data in production.");
  process.exit(1);
}

const DEMO_PASSWORD = "demo12345";
const TZ_OFFSET_MIN = 5 * 60 + 45; // Asia/Kathmandu, UTC+05:45

/** `days` from today at local Kathmandu time `hh:mm`. */
function at(days: number, hh: number, mm = 0): Date {
  const now = new Date();
  const local = new Date(now.getTime() + TZ_OFFSET_MIN * 60_000);
  const utc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + days, hh, mm);
  return new Date(utc - TZ_OFFSET_MIN * 60_000);
}
const hours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

const cover = (seed: string) => ({
  lg: `https://picsum.photos/seed/${seed}/1600/900`,
  md: `https://picsum.photos/seed/${seed}/800/450`,
  sm: `https://picsum.photos/seed/${seed}/400/225`,
});

// ───────────── data ─────────────

const ORGANIZERS = [
  {
    key: "ktm-live",
    fullName: "Kathmandu Live",
    orgName: "Kathmandu Live",
    bio: "Concerts, comedy and late nights across the valley since 2016. We book the bands you'll be telling friends about.",
    website: "https://example.com/kathmandu-live",
  },
  {
    key: "himalayan-tech",
    fullName: "Himalayan Tech Community",
    orgName: "Himalayan Tech Community",
    bio: "Meetups, workshops and an annual summit for Nepal's builders, designers and founders.",
    website: "https://example.com/himalayan-tech",
  },
  {
    key: "lakeside",
    fullName: "Lakeside Collective",
    orgName: "Lakeside Collective",
    bio: "Food fairs, film nights and festivals by the lake in Pokhara.",
    website: "https://example.com/lakeside",
  },
] as const;

const VENUES = [
  { key: "tundikhel", name: "Tundikhel Open Ground", addressLine: "Tundikhel", city: "Kathmandu", lat: 27.7006, lng: 85.3158, capacity: 15000 },
  { key: "patan", name: "Patan Durbar Square", addressLine: "Mangal Bazar", city: "Lalitpur", lat: 27.6727, lng: 85.3253, capacity: 3000 },
  { key: "hyatt", name: "Hyatt Regency Kathmandu", addressLine: "Taragaon, Boudha", city: "Kathmandu", lat: 27.7167, lng: 85.3561, capacity: 800 },
  { key: "academy", name: "Nepal Academy Hall", addressLine: "Kamaladi", city: "Kathmandu", lat: 27.7074, lng: 85.3196, capacity: 1200 },
  { key: "labim", name: "QFX Labim Mall", addressLine: "Pulchowk", city: "Lalitpur", lat: 27.6785, lng: 85.3162, capacity: 220 },
  { key: "jhamsikhel", name: "The Courtyard, Jhamsikhel", addressLine: "Jhamsikhel Road", city: "Lalitpur", lat: 27.6802, lng: 85.3075, capacity: 250 },
  { key: "lakeside", name: "Lakeside Amphitheatre", addressLine: "Baidam, Lakeside", city: "Pokhara", lat: 28.2096, lng: 83.9595, capacity: 2000 },
  { key: "bhaktapur", name: "Bhaktapur Durbar Square", addressLine: "Durbar Square", city: "Bhaktapur", lat: 27.6722, lng: 85.4279, capacity: 5000 },
] as const;

type VenueKey = (typeof VENUES)[number]["key"];
type OrgKey = (typeof ORGANIZERS)[number]["key"];

interface DemoTicket {
  name: string;
  description?: string;
  price: number; // NPR (converted to paisa)
  quantity: number;
  sold?: number;
  max?: number;
}

interface DemoEvent {
  slug: string;
  title: string;
  summary: string;
  description: string;
  org: OrgKey;
  category: string; // slug from seed-categories
  mode: "in_person" | "online" | "hybrid";
  venue?: VenueKey;
  startsAt: Date;
  durationH: number;
  tags?: string[];
  faqs?: { question: string; answer: string }[];
  tickets: DemoTicket[];
}

const FAQ_ENTRY = { question: "Can I get in with a ticket on my phone?", answer: "Yes. Show the QR code from My tickets at the door; no printout needed." };
const FAQ_REFUND = { question: "Can I get a refund?", answer: "You can cancel and get a refund up to 48 hours before the event starts." };

const EVENTS: DemoEvent[] = [
  {
    slug: "neon-nights-festival",
    title: "Neon Nights Festival",
    summary: "Two stages, twelve acts and the biggest light show in the valley.",
    description:
      "Neon Nights is back at Tundikhel for one long night of indie, electronic and rock.\n\nTwo stages run back to back from sunset, with a closing set and light show at 10 PM. Food stalls from Jhamsikhel's best kitchens, free water refill points, and a quiet zone if you need a break.\n\nGates open at 3 PM. Under-16s must come with an adult.",
    org: "ktm-live", category: "music-festivals", mode: "in_person", venue: "tundikhel",
    startsAt: at(5, 16), durationH: 7, tags: ["outdoor", "live music", "festival"],
    faqs: [FAQ_ENTRY, FAQ_REFUND, { question: "Is there parking?", answer: "No on-site parking. Take a taxi or ride-share to Ratna Park." }],
    tickets: [
      { name: "Early Bird", description: "Limited first release.", price: 1500, quantity: 300, sold: 300 },
      { name: "General Admission", description: "Entry to both stages.", price: 2500, quantity: 3000, sold: 1240 },
      { name: "VIP", description: "Viewing deck, fast-track entry and a drink token.", price: 7500, quantity: 200, sold: 120, max: 4 },
    ],
  },
  {
    slug: "stand-up-at-the-square",
    title: "Stand-up at the Square",
    summary: "An open-air comedy night with five of Nepal's sharpest comics.",
    description: "Bring a blanket and a friend. Five comics, ninety minutes, and Patan Durbar Square as the backdrop.\n\nThe show is in Nepali and English. Recommended for 16+.",
    org: "ktm-live", category: "stand-up", mode: "in_person", venue: "patan",
    startsAt: at(9, 18, 30), durationH: 2, tags: ["comedy", "outdoor"],
    faqs: [FAQ_ENTRY, { question: "What language is the show in?", answer: "A mix of Nepali and English." }],
    tickets: [
      { name: "Floor", price: 800, quantity: 400, sold: 150 },
      { name: "Front Rows", description: "First three rows, cushions included.", price: 1500, quantity: 60, sold: 41 },
    ],
  },
  {
    slug: "indie-film-premiere-nights",
    title: "Indie Film Premiere: Nights of Kathmandu",
    summary: "The premiere of this year's festival favourite, followed by a Q&A with the director.",
    description: "A quiet, funny film about four friends and one very long night in Thamel.\n\nThe screening is followed by a 30-minute Q&A with the director and two of the cast.",
    org: "lakeside", category: "festivals-culture", mode: "in_person", venue: "labim",
    startsAt: at(12, 18), durationH: 3, tags: ["film", "premiere"],
    faqs: [FAQ_ENTRY],
    tickets: [{ name: "Standard", price: 600, quantity: 220, sold: 90 }],
  },
  {
    slug: "himalayan-tech-summit-2026",
    title: "Himalayan Tech Summit",
    summary: "A day of talks on AI, fintech and building products for Nepal.",
    description:
      "Twenty speakers, two tracks and plenty of time to meet people.\n\nMorning keynotes cover AI and payments in South Asia. The afternoon splits into product and engineering tracks, and the day ends with founder office hours.\n\nLunch and coffee are included with every ticket.",
    org: "himalayan-tech", category: "tech", mode: "hybrid", venue: "hyatt",
    startsAt: at(21, 9), durationH: 9, tags: ["tech", "AI", "startups"],
    faqs: [FAQ_ENTRY, FAQ_REFUND, { question: "Will talks be recorded?", answer: "Yes. Online ticket holders get the live stream and recordings." }],
    tickets: [
      { name: "Online Pass", description: "Live stream and recordings.", price: 500, quantity: 2000, sold: 310 },
      { name: "In-person", description: "Both tracks, lunch and coffee.", price: 4500, quantity: 500, sold: 280 },
      { name: "Student", description: "Valid student ID required at the door.", price: 1500, quantity: 150, sold: 150 },
    ],
  },
  {
    slug: "pokhara-street-food-fair",
    title: "Pokhara Street Food Fair",
    summary: "Forty stalls, live music and the best sel roti by the lake.",
    description: "A weekend afternoon of food from all over Nepal: Newari bara, Thakali sets, momo from Pokhara's favourite spots, and desserts you've never heard of.\n\nEntry is free; food is paid at the stalls.",
    org: "lakeside", category: "food-drink", mode: "in_person", venue: "lakeside",
    startsAt: at(14, 12), durationH: 8, tags: ["food", "family friendly", "free"],
    faqs: [{ question: "Is entry really free?", answer: "Yes. Grab a free ticket so we can plan for numbers; food is paid at the stalls." }],
    tickets: [{ name: "Free Entry", price: 0, quantity: 5000, sold: 1800, max: 6 }],
  },
  {
    slug: "jazz-at-the-courtyard",
    title: "Jazz at the Courtyard",
    summary: "An intimate evening of jazz standards and Nepali folk reworked.",
    description: "A four-piece band, a small courtyard and a short menu of drinks. Seating is first come, first served.",
    org: "ktm-live", category: "concerts", mode: "in_person", venue: "jhamsikhel",
    startsAt: at(3, 19), durationH: 3, tags: ["jazz", "live music"],
    faqs: [FAQ_ENTRY],
    tickets: [{ name: "Entry", price: 1200, quantity: 120, sold: 98 }],
  },
  {
    slug: "bhaktapur-heritage-run",
    title: "Bhaktapur Heritage Run",
    summary: "A 10 km morning run through the old city's squares and lanes.",
    description: "Start and finish at Durbar Square. The route passes Taumadhi, Dattatreya and the pottery square. Water stations every 2.5 km.\n\nEvery runner gets a finisher's medal and breakfast.",
    org: "lakeside", category: "running", mode: "in_person", venue: "bhaktapur",
    startsAt: at(18, 6), durationH: 4, tags: ["running", "outdoor", "heritage"],
    faqs: [{ question: "Is there a shorter route?", answer: "Yes, a 5 km fun run starts 15 minutes after the 10 km." }],
    tickets: [
      { name: "10 km", price: 1800, quantity: 800, sold: 410 },
      { name: "5 km Fun Run", price: 1000, quantity: 600, sold: 220 },
    ],
  },
  {
    slug: "design-systems-workshop",
    title: "Design Systems in Practice",
    summary: "A hands-on workshop on building and scaling a design system in Figma and code.",
    description: "Bring a laptop. We'll build a small design system from scratch: tokens, components and documentation, and connect it to a React codebase.\n\nLimited to 40 people so everyone gets help.",
    org: "himalayan-tech", category: "workshops", mode: "in_person", venue: "jhamsikhel",
    startsAt: at(10, 10), durationH: 6, tags: ["design", "workshop"],
    faqs: [{ question: "Do I need experience?", answer: "Basic Figma knowledge helps; no coding needed." }],
    tickets: [{ name: "Workshop Seat", price: 3500, quantity: 40, sold: 40 }],
  },
  {
    slug: "classical-evening-nepal-academy",
    title: "A Classical Evening",
    summary: "Sitar, sarangi and tabla from three generations of masters.",
    description: "An evening of Hindustani classical music with a short introduction to each raga for newcomers.",
    org: "ktm-live", category: "classical", mode: "in_person", venue: "academy",
    startsAt: at(16, 17, 30), durationH: 3, tags: ["classical", "music"],
    faqs: [FAQ_ENTRY],
    tickets: [
      { name: "Balcony", price: 700, quantity: 400, sold: 120 },
      { name: "Stalls", price: 1200, quantity: 600, sold: 300 },
    ],
  },
  {
    slug: "startup-pitch-night-online",
    title: "Startup Pitch Night",
    summary: "Ten early-stage startups pitch to a panel of investors, live online.",
    description: "Watch ten five-minute pitches and vote for the audience award. The stream link is sent to ticket holders an hour before.",
    org: "himalayan-tech", category: "business", mode: "online",
    startsAt: at(7, 19), durationH: 2, tags: ["startups", "online"],
    faqs: [{ question: "How do I join?", answer: "The stream link appears on your ticket an hour before the start." }],
    tickets: [{ name: "Viewer", price: 0, quantity: 3000, sold: 640 }],
  },
  {
    slug: "kids-science-fair",
    title: "Kids' Science Fair",
    summary: "Experiments, robots and a planetarium tent for ages 6 to 14.",
    description: "A day of hands-on science: build a rocket, meet a robot, and see the night sky in our inflatable planetarium.",
    org: "himalayan-tech", category: "kids-family", mode: "in_person", venue: "academy",
    startsAt: at(25, 10), durationH: 6, tags: ["kids", "family friendly", "science"],
    faqs: [{ question: "Do adults need a ticket?", answer: "One adult per child gets in free with the child's ticket." }],
    tickets: [{ name: "Child", price: 400, quantity: 600, sold: 75 }],
  },
  {
    slug: "deep-house-rooftop",
    title: "Deep House on the Roof",
    summary: "Sunset to late with three resident DJs.",
    description: "Our monthly rooftop session. Dress code: comfortable. 18+ only, ID checked at the door.",
    org: "ktm-live", category: "dj-nights", mode: "in_person", venue: "jhamsikhel",
    startsAt: at(6, 17), durationH: 6, tags: ["dj", "nightlife", "18+"],
    faqs: [FAQ_ENTRY, { question: "Is there an age limit?", answer: "18+ only. Bring a photo ID." }],
    tickets: [
      { name: "Before 8 PM", price: 900, quantity: 150, sold: 80 },
      { name: "Regular", price: 1400, quantity: 250, sold: 60 },
    ],
  },
  {
    slug: "photography-walk-patan",
    title: "Photography Walk: Patan at Golden Hour",
    summary: "A guided photo walk through Patan's courtyards with a pro photographer.",
    description: "Three hours, twelve people, and the best light of the day. Any camera works, including your phone.",
    org: "lakeside", category: "photography", mode: "in_person", venue: "patan",
    startsAt: at(11, 15, 30), durationH: 3, tags: ["photography", "walk"],
    faqs: [{ question: "What should I bring?", answer: "Any camera or phone, comfortable shoes and water." }],
    tickets: [{ name: "Walk", price: 2000, quantity: 12, sold: 7, max: 2 }],
  },
  {
    slug: "folk-music-by-the-lake",
    title: "Folk Music by the Lake",
    summary: "Lok geet and dohori under the stars at Lakeside.",
    description: "An evening of Nepali folk with three bands and a dohori session where the audience joins in.",
    org: "lakeside", category: "folk", mode: "in_person", venue: "lakeside",
    startsAt: at(20, 17), durationH: 4, tags: ["folk", "outdoor"],
    faqs: [FAQ_ENTRY],
    tickets: [{ name: "General", price: 500, quantity: 1500, sold: 330 }],
  },
  {
    slug: "futsal-cup-weekend",
    title: "Valley Futsal Cup",
    summary: "Sixteen teams, one weekend, one trophy.",
    description: "Watch the valley's best amateur futsal teams battle it out over two days. Finals on Sunday evening.",
    org: "ktm-live", category: "football", mode: "in_person", venue: "tundikhel",
    startsAt: at(27, 9), durationH: 10, tags: ["football", "sports"],
    faqs: [FAQ_ENTRY],
    tickets: [
      { name: "Day Pass", price: 300, quantity: 2000, sold: 120 },
      { name: "Weekend Pass", price: 500, quantity: 1000, sold: 90 },
    ],
  },
  {
    slug: "ai-for-everyone-webinar",
    title: "AI for Everyone",
    summary: "A free, beginner-friendly online session on using AI tools at work.",
    description: "No jargon. We'll show practical ways to use AI tools for writing, research and planning, with time for questions.",
    org: "himalayan-tech", category: "education", mode: "online",
    startsAt: at(4, 18), durationH: 1.5, tags: ["AI", "online", "free"],
    faqs: [{ question: "Will it be recorded?", answer: "Yes, ticket holders get the recording." }],
    tickets: [{ name: "Free Seat", price: 0, quantity: 1000, sold: 412 }],
  },
];

// ───────────── seeding ─────────────

async function seedOrganizer(o: (typeof ORGANIZERS)[number], passwordHash: string) {
  const email = `${o.key}@demo.bookevent.dev`;
  const user =
    (await prisma.user.findUnique({ where: { email } })) ??
    (await prisma.user.create({
      data: { email, passwordHash, fullName: o.fullName, role: "organizer", emailVerifiedAt: new Date() },
    }));
  const existing = await prisma.organizerProfile.findUnique({ where: { userId: user.id } });
  if (!existing) {
    await prisma.organizerProfile.create({
      data: {
        userId: user.id,
        orgName: o.orgName,
        slug: o.key,
        bio: o.bio,
        website: o.website,
        logoUrl: `https://picsum.photos/seed/logo-${o.key}/256/256`,
        verificationStatus: "verified",
        reviewedAt: new Date(),
      },
    });
  }
  return user.id;
}

async function seedVenue(v: (typeof VENUES)[number]) {
  const found = await prisma.venue.findFirst({ where: { name: v.name, ownerId: null, deletedAt: null } });
  if (found) return found.id;
  const row = await prisma.venue.create({
    data: {
      name: v.name,
      addressLine: v.addressLine,
      city: v.city,
      latitude: v.lat,
      longitude: v.lng,
      capacity: v.capacity,
    },
  });
  return row.id;
}

try {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const orgIds = new Map<OrgKey, string>();
  for (const o of ORGANIZERS) orgIds.set(o.key, await seedOrganizer(o, passwordHash));

  const venueIds = new Map<VenueKey, string>();
  for (const v of VENUES) venueIds.set(v.key, await seedVenue(v));

  const categories = new Map((await prisma.category.findMany()).map((c) => [c.slug, c.id]));
  if (categories.size === 0) throw new Error("No categories. Run `npm run db:seed` first.");

  let created = 0;
  let skipped = 0;
  for (const e of EVENTS) {
    if (await prisma.event.findUnique({ where: { slug: e.slug } })) {
      skipped++;
      continue;
    }
    const organizerId = orgIds.get(e.org)!;
    const categoryId = categories.get(e.category) ?? null;
    if (!categoryId) console.warn(`  category "${e.category}" not found for ${e.slug}`);

    await prisma.$transaction(async (tx) => {
      const upload = await tx.upload.create({
        data: {
          userId: organizerId,
          purpose: "event_cover",
          status: "ready",
          contentType: "image/webp",
          sizeBytes: 250_000, // CHECK (size > 0); the real file lives on picsum
          objectKey: `demo/${e.slug}`,
          variants: cover(e.slug),
          width: 1600,
          height: 900,
        },
      });
      const now = new Date();
      await tx.event.create({
        data: {
          organizerId,
          categoryId,
          venueId: e.venue ? venueIds.get(e.venue)! : null,
          title: e.title,
          slug: e.slug,
          summary: e.summary,
          description: e.description,
          coverUploadId: upload.id,
          mode: e.mode,
          onlineUrl: e.mode === "in_person" ? null : `https://meet.example.com/${e.slug}`,
          startsAt: e.startsAt,
          endsAt: hours(e.startsAt, e.durationH),
          status: "published",
          visibility: "public",
          publishedAt: now,
          metadata: { tags: e.tags ?? [], faqs: e.faqs ?? [] },
          ticketTypes: {
            create: e.tickets.map((t, i) => ({
              name: t.name,
              description: t.description ?? null,
              price: BigInt(t.price * 100),
              quantityTotal: t.quantity,
              quantitySold: t.sold ?? 0,
              maxPerOrder: Math.min(t.max ?? 10, t.quantity),
              sortOrder: i,
              salesEndAt: e.startsAt,
            })),
          },
        },
      });
    });
    created++;
  }

  console.log(`Demo data: ${created} events created, ${skipped} already existed.`);
  console.log(`Demo organizers sign in with password "${DEMO_PASSWORD}":`);
  for (const o of ORGANIZERS) console.log(`  ${o.key}@demo.bookevent.dev`);
} finally {
  await prisma.$disconnect();
  redis.disconnect();
}
