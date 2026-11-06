import type { Job } from "bullmq";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { closeQueues } from "../src/lib/queue.js";
import { redis } from "../src/lib/redis.js";
import { ensureBucket, headObject } from "../src/lib/storage.js";
import { processMedia } from "../src/modules/uploads/uploads.jobs.js";
import type { MediaJobData } from "../src/modules/uploads/uploads.service.js";
import { api, bearer, makeOrganizer, register, resetState } from "./helpers.js";

beforeAll(ensureBucket);
beforeEach(resetState);
afterAll(async () => {
  await closeQueues();
  await prisma.$disconnect();
  await redis.quit();
});

/** A real JPEG with EXIF data (including a "secret" field) to check it gets stripped. */
const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 60, b: 90 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "secret-exif-value", Artist: "Ram" } })
    .toBuffer();

const presign = (token: string, body: object) =>
  api().post("/api/v1/uploads/presign").set(bearer(token)).send(body);

/** Does what the browser does: multipart POST of the presigned fields + file. */
async function sendToStorage(
  form: { url: string; fields: Record<string, string> },
  file: Buffer,
  contentType: string,
) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form.fields)) fd.append(k, v);
  fd.append("file", new Blob([new Uint8Array(file)], { type: contentType }));
  return (await fetch(form.url, { method: "POST", body: fd })).status;
}

const runJob = (uploadId: string) => processMedia({ data: { uploadId } } as Job<MediaJobData>);

/** presign → upload → complete. Returns the upload id. */
async function uploadImage(
  token: string,
  file: Buffer,
  opts: { purpose?: string; contentType?: string } = {},
) {
  const contentType = opts.contentType ?? "image/jpeg";
  const p = await presign(token, {
    purpose: opts.purpose ?? "event_cover",
    contentType,
    size: file.length,
  });
  expect(p.status).toBe(201);
  expect(await sendToStorage(p.body, file, contentType)).toBe(204);
  const done = await api().post(`/api/v1/uploads/${p.body.uploadId}/complete`).set(bearer(token));
  expect(done.status).toBe(202);
  expect(done.body.upload.status).toBe("processing");
  return p.body.uploadId as string;
}

describe("uploads", () => {
  it("presign → upload → complete → processed WebP variants without EXIF", async () => {
    const { accessToken } = await register();
    const file = await jpeg(1920, 1080);
    const id = await uploadImage(accessToken, file);
    const raw = await prisma.upload.findUniqueOrThrow({ where: { id } });
    expect(raw.objectKey).toMatch(/^tmp\//);

    await runJob(id);

    const res = await api().get(`/api/v1/uploads/${id}`).set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.upload).toMatchObject({ status: "ready", width: 1920, height: 1080 });
    const { lg, md, sm } = res.body.upload.variants;
    expect(lg).toMatch(/\/media\/event_cover\/.+\/lg\.webp$/);

    // variants are public, WebP, the right size, and carry no EXIF
    for (const [url, w, h] of [
      [lg, 1600, 900],
      [md, 800, 450],
      [sm, 400, 225],
    ] as const) {
      const r = await fetch(url);
      expect(r.status).toBe(200);
      const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
      expect(meta).toMatchObject({ format: "webp", width: w, height: h });
      expect(meta.exif).toBeUndefined();
    }
    // raw upload deleted, and it was never publicly readable
    expect(await headObject(raw.objectKey)).toBeNull();

    // completing again is a no-op
    const again = await api().post(`/api/v1/uploads/${id}/complete`).set(bearer(accessToken));
    expect(again.status).toBe(200);
    expect(again.body.upload.status).toBe("ready");
  });

  it("raw uploads are private", async () => {
    const { accessToken } = await register();
    const file = await jpeg(800, 600);
    const p = await presign(accessToken, {
      purpose: "event_cover",
      contentType: "image/jpeg",
      size: file.length,
    });
    await sendToStorage(p.body, file, "image/jpeg");
    const raw = await prisma.upload.findUniqueOrThrow({ where: { id: p.body.uploadId } });
    const publicGuess = `${new URL(p.body.url).origin}/ems-test/${raw.objectKey}`;
    expect((await fetch(publicGuess)).status).toBe(403);
  });

  it("storage enforces the declared content type and the size limit", async () => {
    const { accessToken } = await register();
    const file = await jpeg(800, 600);
    const p = await presign(accessToken, {
      purpose: "event_cover",
      contentType: "image/png",
      size: file.length,
    });
    // the form says image/png; sending it as image/jpeg breaks the signed policy
    const fd = new FormData();
    for (const [k, v] of Object.entries(p.body.fields as Record<string, string>)) fd.append(k, v);
    fd.set("Content-Type", "image/jpeg");
    fd.append("file", new Blob([new Uint8Array(file)]));
    expect((await fetch(p.body.url, { method: "POST", body: fd })).status).toBe(400);

    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    const p2 = await presign(accessToken, {
      purpose: "event_cover",
      contentType: "image/jpeg",
      size: 1000,
    });
    expect(await sendToStorage(p2.body, big, "image/jpeg")).toBe(400);
  });

  it("rejects bad presign requests", async () => {
    const { accessToken } = await register();
    for (const body of [
      { purpose: "event_cover", contentType: "image/gif", size: 100 },
      { purpose: "event_cover", contentType: "image/jpeg", size: 50 * 1024 * 1024 },
      { purpose: "avatar", contentType: "image/jpeg", size: 100 },
      { purpose: "event_cover", contentType: "image/jpeg" },
    ]) {
      expect((await presign(accessToken, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await api().post("/api/v1/uploads/presign").send({})).status).toBe(401);
  });

  it("completing before the file is uploaded fails", async () => {
    const { accessToken } = await register();
    const p = await presign(accessToken, {
      purpose: "event_cover",
      contentType: "image/jpeg",
      size: 1000,
    });
    const res = await api()
      .post(`/api/v1/uploads/${p.body.uploadId}/complete`)
      .set(bearer(accessToken));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("FILE_NOT_UPLOADED");
  });

  it("marks files that aren't what they claim, or too small, as failed", async () => {
    const { accessToken } = await register();
    // JPEG bytes declared as PNG: the magic-bytes check catches it
    const fake = await uploadImage(accessToken, await jpeg(1200, 800), {
      contentType: "image/png",
    });
    await expect(runJob(fake)).rejects.toThrow(/not image\/png/);
    let res = await api().get(`/api/v1/uploads/${fake}`).set(bearer(accessToken));
    expect(res.body.upload).toMatchObject({ status: "failed", variants: null });

    const tiny = await uploadImage(accessToken, await jpeg(300, 200));
    await expect(runJob(tiny)).rejects.toThrow(/at least 640×360/);

    const garbage = await uploadImage(accessToken, Buffer.from("definitely not an image"));
    await expect(runJob(garbage)).rejects.toThrow(/not a valid image/);
    res = await api().get(`/api/v1/uploads/${garbage}`).set(bearer(accessToken));
    expect(res.body.upload.error).toMatch(/not a valid image/);
  });

  it("other users can't see or complete my upload", async () => {
    const alice = await register("alice@example.com");
    const bob = await register("bob@example.com");
    const p = await presign(alice.accessToken, {
      purpose: "event_cover",
      contentType: "image/jpeg",
      size: 100,
    });
    const id = p.body.uploadId as string;
    expect((await api().get(`/api/v1/uploads/${id}`).set(bearer(bob.accessToken))).status).toBe(
      404,
    );
    expect(
      (await api().post(`/api/v1/uploads/${id}/complete`).set(bearer(bob.accessToken))).status,
    ).toBe(404);
  });

  it("an event cover and an organizer logo can use processed uploads", async () => {
    const org = await makeOrganizer();
    const cover = await uploadImage(org.token, await jpeg(1600, 900));
    const startsAt = new Date(Date.now() + 7 * 86_400_000);
    const endsAt = new Date(startsAt.getTime() + 3 * 3_600_000);
    const body = {
      title: "Cover Test",
      mode: "online",
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      coverUploadId: cover,
    };

    // still processing → 422
    let res = await api().post("/api/v1/events").set(bearer(org.token)).send(body);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("UPLOAD_NOT_READY");

    await runJob(cover);
    res = await api().post("/api/v1/events").set(bearer(org.token)).send(body);
    expect(res.status).toBe(201);
    expect(res.body.event.coverImage.md).toMatch(/\/md\.webp$/);

    // a cover upload can't be used as a logo
    res = await api()
      .patch("/api/v1/me/organizer-profile")
      .set(bearer(org.token))
      .send({ logoUploadId: cover });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("INVALID_UPLOAD");

    const logo = await uploadImage(org.token, await jpeg(600, 600), { purpose: "organizer_logo" });
    await runJob(logo);
    res = await api()
      .patch("/api/v1/me/organizer-profile")
      .set(bearer(org.token))
      .send({ logoUploadId: logo });
    expect(res.status).toBe(200);
    expect(res.body.profile.logoUrl).toMatch(/\/media\/organizer_logo\/.+\/lg\.webp$/);
  });
});
