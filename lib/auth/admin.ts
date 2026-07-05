/** Admin check based on the ADMIN_EMAILS env (comma-separated allowlist). */
export function isAdminEmail(email: string | null | undefined): boolean {
  const list = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !!email && list.includes(email.toLowerCase());
}
