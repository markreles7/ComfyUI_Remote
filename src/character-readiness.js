import { IDENTITY_STATUSES, normalizeIdentityEvaluation, normalizeManualReview } from "./identity-evaluation.js";

const COVERAGE = {
  human: [
    { id: "front", label: "Front", roles: ["head_front", "full_body_front", "expression_neutral"] },
    { id: "threeQuarter", label: "3/4", roles: ["head_3q_left", "head_3q_right", "full_body_3q"] },
    { id: "profile", label: "Profile", roles: ["profile_left", "profile_right"] },
    { id: "fullBody", label: "Full Body", roles: ["full_body_front", "full_body_back", "full_body_3q", "walking"] },
  ],
  animal: [
    { id: "front", label: "Front", roles: ["head_front", "full_body_front"] },
    { id: "threeQuarter", label: "3/4", roles: ["head_3q_left", "head_3q_right", "full_body_rear_3q"] },
    { id: "profile", label: "Profile", roles: ["profile_left", "profile_right", "full_body_side"] },
    { id: "fullBody", label: "Full Body", roles: ["full_body_front", "full_body_side", "full_body_rear_3q", "standing", "walking"] },
  ],
  other: [
    { id: "front", label: "Front", roles: ["front_view"] },
    { id: "threeQuarter", label: "3/4", roles: ["three_quarter_left", "three_quarter_right"] },
    { id: "profile", label: "Side", roles: ["side_left", "side_right"] },
    { id: "detail", label: "Detail", roles: ["detail_primary", "functional_pose", "scale_context"] },
  ],
};

function coverageFor(kind) {
  return COVERAGE[kind] || COVERAGE.other;
}
function identityGate(reference, evaluation) {
  const manual = normalizeManualReview(reference.manualReview);
  if (manual.status === "REJECTED") return { state: "rejected", source: "manual" };
  if (manual.status === "APPROVED") return { state: "pass", source: "manual" };
  if (evaluation?.status === IDENTITY_STATUSES.PASS) return { state: "pass", source: "engine" };
  if ([IDENTITY_STATUSES.WARNING, IDENTITY_STATUSES.FAIL].includes(evaluation?.status)) {
    return { state: "warning", source: "engine" };
  }
  return { state: "review", source: "manual-required" };
}

export function buildCharacterReadiness(character = {}) {
  const references = Array.isArray(character.references) ? character.references : [];
  const approved = references.filter((reference) => reference.status !== "rejected");
  const hero = approved.find((reference) => reference.id === character.heroImage)
    || approved.find((reference) => reference.type === "hero");
  const plan = character.referencePlan || null;
  const kind = plan?.subjectKind || character.subjectKind || "other";
  const planItems = Array.isArray(plan?.items) ? plan.items : [];
  const approvedById = new Map(approved.map((reference) => [reference.id, reference]));
  const approvedPlanItems = planItems.filter((item) => item.approvedReferenceId && approvedById.has(item.approvedReferenceId));
  const approvedRoles = new Set(approvedPlanItems.map((item) => item.referenceRole));
  const groups = coverageFor(kind).map((group) => ({
    ...group,
    approved: group.roles.some((role) => approvedRoles.has(role)),
  }));
  const coveredRoles = new Set(groups.flatMap((group) => group.roles));
  const additionalItems = planItems.filter((item) => !coveredRoles.has(item.referenceRole));
  const additionalApproved = additionalItems.filter((item) => approvedRoles.has(item.referenceRole)).length;
  const additionalTarget = Math.min(2, additionalItems.length);
  const minimumApproved = Math.min(planItems.length, groups.length + additionalTarget);
  const coverageComplete = Boolean(plan)
    && groups.every((group) => group.approved)
    && approvedPlanItems.length >= minimumApproved;

  const identityEvaluation = normalizeIdentityEvaluation(character.identityEvaluation || {});
  const evaluations = new Map(identityEvaluation.evaluations.map((item) => [item.referenceId, item]));
  const identityItems = approvedPlanItems
    .map((item) => approvedById.get(item.approvedReferenceId))
    .filter(Boolean)
    .map((reference) => ({
      referenceId: reference.id,
      ...identityGate(reference, evaluations.get(reference.id)),
    }));
  const hasWarning = identityItems.some((item) => item.state === "warning");
  const needsReview = identityItems.some((item) => item.state === "review");
  const manualUsed = identityItems.some((item) => item.source === "manual");
  const engineVerified = identityItems.length > 0 && identityItems.every((item) => item.source === "engine" && item.state === "pass");

  let status;
  if (!hero) status = "Needs Hero";
  else if (!coverageComplete) status = "Incomplete";
  else if (hasWarning) status = "Identity Warning";
  else if (needsReview) status = "Needs Review";
  else status = "Ready";

  return {
    status,
    subjectKind: kind,
    coverageComplete,
    minimumApproved,
    approvedPlanReferences: approvedPlanItems.length,
    totalPlanReferences: planItems.length,
    rows: [
      { id: "hero", label: "Hero", approved: Boolean(hero) },
      ...groups.map(({ id, label, approved: isApproved }) => ({ id, label, approved: isApproved })),
      { id: "additional", label: "Additional", approved: additionalApproved >= additionalTarget, count: additionalApproved, target: additionalTarget },
    ],
    identity: {
      status: hasWarning
        ? "Warning"
        : needsReview ? "Revisione manuale"
          : engineVerified ? "Verificata"
            : manualUsed ? "Revisione manuale completata" : "Non valutata",
      engine: identityEvaluation.engine,
      evaluations: identityEvaluation.evaluations,
      manualUsed,
      hasWarning,
      needsReview,
    },
  };
}
