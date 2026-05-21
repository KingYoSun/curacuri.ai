export const notificationSendClaimPrefix = "sending:";

export function isNotificationSendClaim(value: string | null): boolean {
  return value?.startsWith(notificationSendClaimPrefix) ?? false;
}
