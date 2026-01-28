import type { Request, Response, NextFunction } from "express";

export function rawBodySaver(req: Request, _res: Response, buf: Buffer) {
  // Store raw body exactly as received for HMAC verification
  (req as any).rawBody = buf.toString("utf8");
}

export function requireRawBody(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).rawBody) {
    return res.status(400).json({ error: "rawBody missing" });
  }
  next();
}
