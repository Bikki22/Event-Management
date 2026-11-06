import type { User } from "../../generated/prisma/client.js";

/** Public user shape. Built explicitly so internal fields (passwordHash, status) never leak. */
export interface UserDto {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: User["role"];
  emailVerified: boolean;
  createdAt: string;
}

export const toUserDto = (u: User): UserDto => ({
  id: u.id,
  email: u.email,
  fullName: u.fullName,
  phone: u.phone,
  role: u.role,
  emailVerified: u.emailVerifiedAt !== null,
  createdAt: u.createdAt.toISOString(),
});
