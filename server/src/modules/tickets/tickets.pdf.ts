import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { env } from "../../config/env.js";

export interface TicketPdfData {
  ticketCode: string;
  ticketType: string;
  holderName: string;
  bookingCode: string;
  eventTitle: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  mode: "in_person" | "online" | "hybrid";
  venue: string | null; // "Hall, Address, City"
  organizer: string;
  price: string; // "NPR 1,500.00" or "Free"
}

const formatWhen = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

const timeOnly = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);
const dayKey = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(d);

/** "Sun, 20 Dec 2026, 18:00 – 22:00", or full dates on both sides for multi-day events. */
const formatRange = (start: Date, end: Date, timeZone: string) =>
  dayKey(start, timeZone) === dayKey(end, timeZone)
    ? `${formatWhen(start, timeZone)} – ${timeOnly(end, timeZone)}`
    : `${formatWhen(start, timeZone)} – ${formatWhen(end, timeZone)}`;

/** Minor units → "NPR 1,500.00" (or "Free"). */
export const formatMoney = (minor: number, currency: string) =>
  minor === 0
    ? "Free"
    : `${currency} ${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** QR as PNG; error correction "M" survives a scratched phone screen or a crumpled print. */
export const qrPng = (payload: string) =>
  QRCode.toBuffer(payload, { errorCorrectionLevel: "M", margin: 1, width: 360 });

export const qrSvg = (payload: string) =>
  QRCode.toString(payload, { type: "svg", errorCorrectionLevel: "M", margin: 1 });

/** A5 portrait ticket: event details on top, big QR + code below. Uses built-in fonts only. */
export async function renderTicketPdf(t: TicketPdfData): Promise<Buffer> {
  const qr = await qrPng(t.ticketCode);
  const doc = new PDFDocument({
    size: "A5",
    margin: 36,
    info: { Title: `${t.eventTitle} - ${t.ticketType}`, Author: env.APP_NAME },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const width = doc.page.width - 72;
  doc.rect(0, 0, doc.page.width, 64).fill("#4f46e5");
  doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(18).text(env.APP_NAME, 36, 22);
  doc.font("Helvetica").fontSize(10).text("ADMISSION TICKET", 36, 26, { width, align: "right" });

  doc
    .fillColor("#111111")
    .font("Helvetica-Bold")
    .fontSize(17)
    .text(t.eventTitle, 36, 86, { width });
  doc.moveDown(0.4).font("Helvetica").fontSize(10.5).fillColor("#333333");
  const line = (label: string, value: string) => {
    doc
      .font("Helvetica-Bold")
      .text(`${label}: `, { continued: true })
      .font("Helvetica")
      .text(value, { width });
  };
  line("When", `${formatRange(t.startsAt, t.endsAt, t.timezone)} (${t.timezone})`);
  if (t.mode !== "online" && t.venue) line("Where", t.venue);
  if (t.mode !== "in_person") line("Online", "the join link is on your ticket page");
  line("Organizer", t.organizer);
  doc.moveDown(0.6);
  line("Ticket", `${t.ticketType} · ${t.price}`);
  line("Name", t.holderName);
  line("Booking", t.bookingCode);

  const qrSize = 190;
  const qrY = Math.max(doc.y + 18, 300);
  doc.image(qr, (doc.page.width - qrSize) / 2, qrY, { width: qrSize });
  doc
    .font("Courier-Bold")
    .fontSize(12)
    .fillColor("#111111")
    .text(t.ticketCode, 36, qrY + qrSize + 8, { width, align: "center" });
  doc
    .font("Helvetica")
    .fontSize(8.5)
    .fillColor("#666666")
    .text(
      "Show this QR code at the entrance. Each ticket admits one person once. Don't share it: whoever scans first gets in.",
      36,
      qrY + qrSize + 30,
      { width, align: "center" },
    );

  doc.end();
  return done;
}
