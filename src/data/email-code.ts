import { createHmac, randomInt, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getSessionSecret } from "../config.ts";
import { ApiError } from "../http/errors.ts";
import { hashUserPassword } from "../security/user-password.ts";
import { withTransaction } from "./transaction.ts";

export type EmailCodePurpose = "REGISTER" | "RESET_PASSWORD" | "CHANGE_PASSWORD";
const lifetimeMs = 10 * 60 * 1000;
function digest(value: string) { return createHmac("sha256",getSessionSecret()).update(value).digest("hex"); }

/** Reserve before sending: concurrent requests cannot bypass the per-user cooldown. */
export async function issueEmailCode(db: DatabaseSync, userId: string, purpose: EmailCodePurpose,
  send: (email: string, code: string, purpose: EmailCodePurpose) => Promise<void>, now = new Date()) {
  let code = String(randomInt(1_000_000)).padStart(6,"0");
  const id = randomUUID();
  const email = withTransaction(db,()=>{
    const user=db.prepare("SELECT email,email_verified FROM users WHERE id=?").get(userId);
    if (!user || (purpose === "REGISTER" && user.email_verified === 1) ||
      (purpose === "CHANGE_PASSWORD" && user.email_verified !== 1)) throw new ApiError("USER_REQUIRED",401);
    const previous=db.prepare("SELECT id,code_hash,created_at FROM email_codes WHERE user_id=? AND purpose=?").get(userId,purpose);
    if(previous && now.getTime()-Date.parse(String(previous.created_at))<60_000) throw new ApiError("CODE_COOLDOWN",429);
    // Reissuing must invalidate the old digits, even in the rare random collision.
    while(previous && digest(`${previous.id}:${purpose}:${code}`) === previous.code_hash) {
      code = String(randomInt(1_000_000)).padStart(6,"0");
    }
    db.prepare(`INSERT INTO email_codes (id,user_id,purpose,code_hash,expires_at,created_at)
      VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,purpose) DO UPDATE SET
      id=excluded.id,code_hash=excluded.code_hash,expires_at=excluded.expires_at,created_at=excluded.created_at,
      attempt_count=0,used_at=NULL,grant_hash=NULL,grant_expires_at=NULL`).run(
        id,userId,purpose,digest(`${id}:${purpose}:${code}`),new Date(now.getTime()+lifetimeMs).toISOString(),now.toISOString());
    return String(user.email);
  });
  try { await send(email,code,purpose); }
  catch(error) {
    db.prepare("UPDATE email_codes SET used_at=? WHERE id=?").run(new Date().toISOString(),id);
    throw error;
  }
}

/** Return null instead of throwing within the transaction so failed attempts stay committed. */
export function verifyEmailCode(db: DatabaseSync,userId: string,purpose: EmailCodePurpose,code: string,now=new Date()): string | null {
  return withTransaction(db,()=>{
    const row=db.prepare("SELECT * FROM email_codes WHERE user_id=? AND purpose=?").get(userId,purpose);
    if(!row || row.used_at !== null || Number(row.attempt_count)>=5 || String(row.expires_at)<=now.toISOString()) return null;
    const actual=Buffer.from(digest(`${row.id}:${purpose}:${code}`),"hex");
    const expected=Buffer.from(String(row.code_hash),"hex");
    if(!/^\d{6}$/.test(code) || expected.length!==actual.length || !timingSafeEqual(expected,actual)) {
      db.prepare("UPDATE email_codes SET attempt_count=attempt_count+1,used_at=CASE WHEN attempt_count>=4 THEN ? ELSE used_at END WHERE id=?")
        .run(now.toISOString(),row.id);
      return null;
    }
    const grant=randomBytes(32).toString("base64url");
    db.prepare("UPDATE email_codes SET used_at=?,grant_hash=?,grant_expires_at=? WHERE id=?")
      .run(now.toISOString(),digest(grant),new Date(now.getTime()+lifetimeMs).toISOString(),row.id);
    return grant;
  });
}

export function finishPasswordCode(db: DatabaseSync,purpose: "RESET_PASSWORD" | "CHANGE_PASSWORD",grant:string,
  password:string,boundUserId?:string,now=new Date()):boolean {
  if(password.trim().length<8 || password.length>512) throw new ApiError("INVALID_PASSWORD",400);
  if(!/^[A-Za-z0-9_-]{43}$/.test(grant)) return false;
  if(purpose === "CHANGE_PASSWORD" && !boundUserId) return false;
  const passwordHash=hashUserPassword(password);
  return withTransaction(db,()=>{
    const row=db.prepare(`SELECT id,user_id FROM email_codes WHERE purpose=? AND grant_hash=? AND grant_expires_at>?
      AND (? IS NULL OR user_id=?)`).get(purpose,digest(grant),now.toISOString(),boundUserId??null,boundUserId??null);
    if(!row) return false;
    db.prepare("UPDATE users SET password_hash=?,updated_at=? WHERE id=?").run(passwordHash,now.toISOString(),row.user_id);
    // Consuming any password grant invalidates other pending password grants for this account.
    db.prepare("UPDATE email_codes SET used_at=?,grant_hash=NULL,grant_expires_at=NULL WHERE user_id=?")
      .run(now.toISOString(),row.user_id);
    db.prepare("DELETE FROM password_reset_tokens WHERE user_id=?").run(row.user_id);
    if(purpose==="RESET_PASSWORD") db.prepare("DELETE FROM user_sessions WHERE user_id=?").run(row.user_id);
    return true;
  });
}
