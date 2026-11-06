import { NotFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { toUserDto, type UserDto } from "./users.dto.js";

export async function getMe(userId: string): Promise<UserDto> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw NotFound("User");
  return toUserDto(user);
}
