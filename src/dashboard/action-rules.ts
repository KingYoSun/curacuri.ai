import { faqCandidateStatuses, type AutoReply, type FaqCandidateStatus } from "../shared/types.js";

export function canModerateAutoReply(status: AutoReply["status"]): boolean {
  return status === "pending_approval";
}

export function allowedFaqStatusTransitions(
  status: FaqCandidateStatus,
): readonly FaqCandidateStatus[] {
  return faqCandidateStatuses.filter((candidateStatus) => candidateStatus !== status);
}
