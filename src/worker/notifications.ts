import { newId } from "../app/ids.js";
import type { Phase1Repository } from "../app/repositories/types.js";
import type { DiscordSender } from "../bot/discord-sender.js";
import { isNotificationSendClaim, notificationSendClaimPrefix } from "../shared/notifications.js";

type NotificationSendRepository = Pick<
  Phase1Repository,
  | "listNotifications"
  | "claimPendingNotificationSend"
  | "markClaimedNotificationSent"
  | "markClaimedNotificationFailed"
>;

function notificationClaimToken(): string {
  return `${notificationSendClaimPrefix}${newId()}`;
}

export async function sendPendingNotifications(
  repository: NotificationSendRepository,
  sender: DiscordSender,
): Promise<void> {
  const notifications = (await repository.listNotifications()).filter(
    (notification) => notification.status === "pending" && notification.sentMessageId === null,
  );
  for (const notification of notifications) {
    const claimToken = notificationClaimToken();
    const claimed = await repository.claimPendingNotificationSend(notification.id, claimToken);
    if (claimed === null || !isNotificationSendClaim(claimed.sentMessageId)) {
      continue;
    }
    try {
      const result = await sender.sendAdminNotification(claimed);
      await repository.markClaimedNotificationSent(claimed.id, claimToken, result.sentMessageId);
    } catch (error) {
      await repository.markClaimedNotificationFailed(
        claimed.id,
        claimToken,
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
