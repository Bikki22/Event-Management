import type { Event, TicketType } from "../../generated/prisma/client.js";
import { writeAudit } from "../../lib/audit.js";
import {
  Conflict,
  isCheckViolation,
  isUniqueViolation,
  NotFound,
  PreconditionFailed,
  Unprocessable,
} from "../../lib/errors.js";
import { prisma, type DbOrTx } from "../../lib/prisma.js";
import type { AuthContext } from "../../middleware/auth.js";
import { toManageTicketType, toPublicTicketType, type ManageTicketTypeDto } from "./events.dto.js";
import type { CreateTicketTypeBody, UpdateTicketTypeBody } from "./events.schemas.js";
import { canView, findOwned, isManager, loadFull } from "./events.service.js";

const TX_OPTS = { maxWait: 2_000, timeout: 5_000 } as const;

const committed = (t: TicketType) => t.quantitySold + t.quantityReserved;

function assertEditableEvent(e: Event) {
  if (e.status === "cancelled" || e.status === "completed") {
    throw Conflict("EVENT_NOT_EDITABLE", `Tickets of a ${e.status} event can't change`);
  }
}

function assertSalesWindow(e: Event, start: Date | null, end: Date | null) {
  if (start && end && end <= start) {
    throw Unprocessable("INVALID_SALES_WINDOW", "salesEndAt must be after salesStartAt");
  }
  if (end && end > e.endsAt) {
    throw Unprocessable("INVALID_SALES_WINDOW", "Sales can't end after the event ends");
  }
  if (start && start >= e.endsAt) {
    throw Unprocessable("INVALID_SALES_WINDOW", "Sales must start before the event ends");
  }
}

/** A published event must always keep at least one active ticket type. */
async function assertNotLastActive(e: Event, ticketTypeId: string, db: DbOrTx) {
  if (e.status !== "published") return;
  const others = await db.ticketType.count({
    where: { eventId: e.id, isActive: true, id: { not: ticketTypeId } },
  });
  if (others === 0) {
    throw Conflict(
      "LAST_TICKET_TYPE",
      "A published event needs at least one active ticket type; cancel the event instead",
    );
  }
}

const nameTaken = () =>
  Conflict("TICKET_TYPE_EXISTS", "This event already has a ticket type with that name");

export async function list(eventId: string, auth?: AuthContext) {
  const e = await loadFull(eventId);
  if (!canView(e, auth)) throw NotFound("Event");
  return isManager(e, auth)
    ? e.ticketTypes.map((t) => toManageTicketType(t, e))
    : e.ticketTypes.filter((t) => t.isActive).map((t) => toPublicTicketType(t, e));
}

export async function create(
  auth: AuthContext,
  eventId: string,
  input: CreateTicketTypeBody,
  ip: string | null,
): Promise<ManageTicketTypeDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      const e = await findOwned(auth, eventId, tx);
      assertEditableEvent(e);
      assertSalesWindow(e, input.salesStartAt ?? null, input.salesEndAt ?? null);
      if (input.minPerOrder > input.quantityTotal) {
        throw Unprocessable("INVALID_QUANTITY", "minPerOrder can't exceed quantityTotal");
      }
      const t = await tx.ticketType.create({
        data: { ...input, price: BigInt(input.price), eventId },
      });
      await writeAudit(
        {
          actorId: auth.userId,
          action: "ticket_type.created",
          entityType: "ticket_type",
          entityId: t.id,
          ip,
          diff: { eventId, name: t.name, price: input.price, quantityTotal: t.quantityTotal },
        },
        tx,
      );
      return toManageTicketType(t, e);
    }, TX_OPTS);
  } catch (err) {
    if (isUniqueViolation(err, "name")) throw nameTaken();
    throw err;
  }
}

/**
 * Optimistic locking via If-Match. Once tickets are sold or held, the price is locked and the
 * total can't drop below sold + reserved (the DB CHECK is the final guard against a race with
 * a booking that lands between our read and write).
 */
export async function update(
  auth: AuthContext,
  eventId: string,
  ticketTypeId: string,
  expectedVersion: number,
  input: UpdateTicketTypeBody,
  ip: string | null,
): Promise<ManageTicketTypeDto> {
  try {
    return await prisma.$transaction(async (tx) => {
      const e = await findOwned(auth, eventId, tx);
      assertEditableEvent(e);
      const t = await tx.ticketType.findFirst({ where: { id: ticketTypeId, eventId } });
      if (!t) throw NotFound("Ticket type");
      if (t.version !== expectedVersion) throw PreconditionFailed();

      if (input.price !== undefined && BigInt(input.price) !== t.price && committed(t) > 0) {
        throw Conflict(
          "PRICE_LOCKED",
          "The price can't change after tickets were sold or reserved",
        );
      }
      const total = input.quantityTotal ?? t.quantityTotal;
      if (total < committed(t)) {
        throw Conflict(
          "QUANTITY_BELOW_SOLD",
          `${committed(t)} tickets are already sold or reserved; the total can't go below that`,
        );
      }
      const min = input.minPerOrder ?? t.minPerOrder;
      const max = input.maxPerOrder ?? t.maxPerOrder;
      if (min > max)
        throw Unprocessable("INVALID_QUANTITY", "minPerOrder can't exceed maxPerOrder");
      assertSalesWindow(
        e,
        input.salesStartAt !== undefined ? input.salesStartAt : t.salesStartAt,
        input.salesEndAt !== undefined ? input.salesEndAt : t.salesEndAt,
      );
      if (input.isActive === false && t.isActive) await assertNotLastActive(e, t.id, tx);

      const { count } = await tx.ticketType.updateMany({
        where: { id: ticketTypeId, version: expectedVersion },
        data: {
          ...input,
          ...(input.price !== undefined ? { price: BigInt(input.price) } : {}),
          version: { increment: 1 },
        },
      });
      if (count === 0) throw PreconditionFailed();

      await writeAudit(
        {
          actorId: auth.userId,
          action: "ticket_type.updated",
          entityType: "ticket_type",
          entityId: ticketTypeId,
          ip,
          diff: { eventId, fields: Object.keys(input) },
        },
        tx,
      );
      const after = await tx.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
      return toManageTicketType(after, e);
    }, TX_OPTS);
  } catch (err) {
    if (isUniqueViolation(err, "name")) throw nameTaken();
    if (isCheckViolation(err, "ticket_types_stock")) {
      throw Conflict("QUANTITY_BELOW_SOLD", "Tickets were just sold; the total can't go that low");
    }
    throw err;
  }
}

/** Only ticket types with no sales or holds can be deleted; otherwise deactivate them. */
export async function remove(
  auth: AuthContext,
  eventId: string,
  ticketTypeId: string,
  ip: string | null,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const e = await findOwned(auth, eventId, tx);
    assertEditableEvent(e);
    const t = await tx.ticketType.findFirst({ where: { id: ticketTypeId, eventId } });
    if (!t) throw NotFound("Ticket type");
    if (committed(t) > 0) {
      throw Conflict(
        "TICKET_TYPE_HAS_SALES",
        "Tickets of this type were sold or reserved; set isActive to false instead",
      );
    }
    if (t.isActive) await assertNotLastActive(e, t.id, tx);
    await tx.ticketType.delete({ where: { id: ticketTypeId } });
    await writeAudit(
      {
        actorId: auth.userId,
        action: "ticket_type.deleted",
        entityType: "ticket_type",
        entityId: ticketTypeId,
        ip,
        diff: { eventId, name: t.name },
      },
      tx,
    );
  }, TX_OPTS);
}
