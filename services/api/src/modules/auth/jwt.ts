import jwt from "jsonwebtoken";
import { env } from "@/config/env";

export interface JwtPayload {
  sub: string;
  iat?: number;
  exp?: number;
}

export function signToken(userId: string): string {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign({ sub: userId }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"],
  });
}

export function verifyToken(token: string): JwtPayload {
  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  if (!payload.sub) {
    throw new Error("Invalid token payload: missing sub");
  }
  return payload;
}

export function extractBearerToken(authHeader?: string): string | null {
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) return null;
  return token;
}
