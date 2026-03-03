export interface SuperAdminNotificationUser {
  email: string | null;
  notificationPreferences: unknown;
}

export interface SuperAdminNotificationEnv {
  superAdminNotifyEmail?: string | null;
  managedServiceNotifyEmail?: string | null;
  johnnyEmail?: string | null;
}

export const shouldReceiveSuperAdminSignupEmail = (prefs: unknown): boolean => {
  if (!prefs || typeof prefs !== "object") return true;
  const teamUpdates = (prefs as Record<string, unknown>).teamUpdates;
  return typeof teamUpdates === "boolean" ? teamUpdates : true;
};

export const resolveSuperAdminNotificationRecipients = (
  users: SuperAdminNotificationUser[],
  env: SuperAdminNotificationEnv
): string[] => {
  const recipients = new Set<string>();

  for (const user of users) {
    const email = String(user.email || "").trim().toLowerCase();
    if (!email) continue;
    if (!shouldReceiveSuperAdminSignupEmail(user.notificationPreferences)) continue;
    recipients.add(email);
  }

  const fallbackRaw = [
    env.superAdminNotifyEmail,
    env.managedServiceNotifyEmail,
    env.johnnyEmail,
  ]
    .filter((value): value is string => Boolean(value))
    .join(",");

  if (!fallbackRaw) return Array.from(recipients);

  fallbackRaw
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
    .forEach((email) => recipients.add(email));

  return Array.from(recipients);
};
