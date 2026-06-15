import "express-session";
declare module "express-session" {
  interface SessionData { userId: number; userName: string; userRole: string; flash: string|null; }
}
import "express-session";

declare module "express-session" {
  interface SessionData {
    flash?: string;
    userId?: number;
    userName?: string;
    userRole?: string;
  }
}0

export {};
