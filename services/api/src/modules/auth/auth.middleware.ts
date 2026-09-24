import type { Request, Response, NextFunction } from "express";
import { extractBearerToken, verifyToken } from "../auth/jwt";
import { prisma } from "../../db/prisma";
import { env } from "../../config/env";
import { logger } from "../../config/logger";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      currentUser?: {
        id: string;
        email: string;
        name: string;
      };
    }
  }
}

/**
 * 认证中间件。
 *
 * 优先级：
 *   1) 如果请求带了内部专用 Token (X-Internal-Token) 且匹配 env.API_INTERNAL_TOKEN：
 *      当作「ai-worker 内部回调」，给一个内部虚拟用户，跳过 JWT 校验。
 *      这样 ai-worker 写 highlights / 更新 job 状态时不需要做注册登录。
 *   2) 如果开发环境设置了 DEV_BYPASS_AUTH=true：
 *      所有请求一律当作 DEV_FIXED_USER，跳过 JWT，方便本地/联调时不用登录。
 *   3) 否则：用 Authorization: Bearer <JWT> 正常校验用户。
 *
 * TODO(Auth): 接入 Supabase / Firebase / NextAuth 等正式账号体系时，
 *             把 JWT 部分替换成对应服务的 token 验证逻辑即可，currentUser 字段结构不用改。
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // --- 1) 内部 Token：ai-worker → API 专用 ---
  const internalTokenHeader = req.headers["x-internal-token"];
  const internalToken = Array.isArray(internalTokenHeader)
    ? internalTokenHeader[0]
    : internalTokenHeader;
  if (env.API_INTERNAL_TOKEN && internalToken === env.API_INTERNAL_TOKEN) {
    req.currentUser = {
      id: "user_internal_ai_worker",
      email: "internal@shoot-the-ball.local",
      name: "AI Worker (Internal)",
    };
    next();
    return;
  }
  if (
    internalToken &&
    env.API_INTERNAL_TOKEN &&
    internalToken !== env.API_INTERNAL_TOKEN
  ) {
    logger.warn({}, "requireAuth: X-Internal-Token mismatch, rejecting");
    res.status(401).json({ error: "Unauthorized: invalid internal token" });
    return;
  }

  // --- 2) 开发环境：bypass 登录 ---
  if (env.DEV_BYPASS_AUTH) {
    req.currentUser = {
      id: env.DEV_FIXED_USER_ID,
      email: env.DEV_FIXED_USER_EMAIL,
      name: env.DEV_FIXED_USER_NAME,
    };
    next();
    return;
  }

  // --- 3) 正常 JWT 校验 ---
  const bearer = extractBearerToken(req.headers.authorization);
  if (!bearer) {
    res.status(401).json({ error: "Unauthorized: missing token" });
    return;
  }
  if (!env.JWT_SECRET) {
    logger.error({}, "requireAuth: JWT_SECRET is not configured");
    res.status(500).json({ error: "Auth misconfigured on server" });
    return;
  }

  try {
    const payload = verifyToken(bearer);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, name: true },
    });
    if (!user) {
      res.status(401).json({ error: "Unauthorized: user not found" });
      return;
    }
    req.currentUser = user;
    next();
  } catch (err) {
    logger.warn({ err }, "requireAuth: JWT verification failed");
    res.status(401).json({ error: "Unauthorized: invalid token" });
  }
}
