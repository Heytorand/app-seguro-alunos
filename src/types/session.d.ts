import "express-session";

declare module "express-session" {
  interface SessionData {
    flash?: string | null;
    userId?: number;
    userName?: string;
    userRole?: string;
  }
}

export {};