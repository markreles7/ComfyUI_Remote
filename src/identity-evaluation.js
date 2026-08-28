import { insightFaceModelRoot } from "./interactive-cast/anchor-verification.js";
import { runPythonJson } from "./interactive-cast/python-tools.js";

export const IDENTITY_STATUSES = Object.freeze({
  PASS: "PASS",
  WARNING: "WARNING",
  FAIL: "FAIL",
  NOT_EVALUATED: "NOT_EVALUATED",
  ENGINE_UNAVAILABLE: "ENGINE_UNAVAILABLE",
  UNSUPPORTED_SUBJECT: "UNSUPPORTED_SUBJECT",
});

const MANUAL_REVIEW_STATUSES = new Set(["PENDING", "APPROVED", "REJECTED"]);

function text(value, max = 1000) {
  return String(value || "").trim().slice(0, max);
}

function warnings(value) {
  return (Array.isArray(value) ? value : value ? [value] : [])
    .map((item) => text(item, 500))
    .filter(Boolean);
}

export function normalizeManualReview(raw = {}) {
  const status = MANUAL_REVIEW_STATUSES.has(raw?.status) ? raw.status : "PENDING";
  return {
    status,
    reviewedAt: text(raw?.reviewedAt, 80) || null,
    reviewedBy: text(raw?.reviewedBy, 80) || null,
    notes: text(raw?.notes, 1000),
  };
}

export function mapIdentityScore(score, thresholds = {}) {
  if (score === null || score === undefined || score === "" || !Number.isFinite(Number(score))) {
    return IDENTITY_STATUSES.NOT_EVALUATED;
  }
  const value = Number(score);
  const pass = Number(thresholds.pass);
  const warning = Number(thresholds.warning);
  if (!Number.isFinite(pass) || !Number.isFinite(warning) || warning > pass) {
    throw new Error("Threshold Identity provider non validi.");
  }
  if (value >= pass) return IDENTITY_STATUSES.PASS;
  if (value >= warning) return IDENTITY_STATUSES.WARNING;
  return IDENTITY_STATUSES.FAIL;
}

export function normalizeIdentityEvaluation(raw = {}) {
  const validStatuses = new Set(Object.values(IDENTITY_STATUSES));
  const legacyPerceptual = /perceptual|histogram|pixel|pgm/i.test(String(raw.engine || ""));
  const evaluations = legacyPerceptual ? [] : (Array.isArray(raw.evaluations) ? raw.evaluations : [])
    .map((item) => ({
      referenceId: text(item.referenceId, 100),
      score: item.score !== null && item.score !== undefined && item.score !== "" && Number.isFinite(Number(item.score))
        ? Number(item.score)
        : null,
      status: validStatuses.has(item.status) ? item.status : IDENTITY_STATUSES.NOT_EVALUATED,
      engine: text(item.engine || raw.engine, 160) || null,
      evaluatedAt: text(item.evaluatedAt, 80) || null,
      warnings: warnings(item.warnings),
    }))
    .filter((item) => item.referenceId);
  return {
    enabled: legacyPerceptual ? false : Boolean(raw.enabled),
    engine: legacyPerceptual ? null : text(raw.engine, 160) || null,
    subjectKindsSupported: legacyPerceptual
      ? []
      : (Array.isArray(raw.subjectKindsSupported) ? raw.subjectKindsSupported : []).filter((kind) => ["human", "animal", "other"].includes(kind)),
    thresholds: legacyPerceptual || !raw.thresholds ? null : {
      pass: Number(raw.thresholds.pass),
      warning: Number(raw.thresholds.warning),
    },
    evaluations,
    status: legacyPerceptual
      ? IDENTITY_STATUSES.NOT_EVALUATED
      : validStatuses.has(raw.status) ? raw.status : IDENTITY_STATUSES.NOT_EVALUATED,
    evaluatedAt: text(raw.evaluatedAt || raw.updatedAt, 80) || null,
    warnings: [
      ...(legacyPerceptual ? ["La precedente metrica percettiva è stata rimossa: non misurava l'identità."] : []),
      ...warnings(raw.warnings || raw.warning),
    ],
    providers: Array.isArray(raw.providers) ? raw.providers : [],
  };
}

function aggregateStatus(evaluations) {
  if (evaluations.some((item) => item.status === IDENTITY_STATUSES.FAIL)) return IDENTITY_STATUSES.FAIL;
  if (evaluations.some((item) => item.status === IDENTITY_STATUSES.WARNING)) return IDENTITY_STATUSES.WARNING;
  if (evaluations.some((item) => item.status === IDENTITY_STATUSES.ENGINE_UNAVAILABLE)) return IDENTITY_STATUSES.ENGINE_UNAVAILABLE;
  if (evaluations.some((item) => item.status === IDENTITY_STATUSES.UNSUPPORTED_SUBJECT)) return IDENTITY_STATUSES.UNSUPPORTED_SUBJECT;
  if (evaluations.length && evaluations.every((item) => item.status === IDENTITY_STATUSES.PASS)) return IDENTITY_STATUSES.PASS;
  return IDENTITY_STATUSES.NOT_EVALUATED;
}

function unavailableEvaluations(references, status, engine, message) {
  const now = new Date().toISOString();
  return references.map((reference) => ({
    referenceId: reference.id,
    score: null,
    status,
    engine,
    evaluatedAt: now,
    warnings: [message],
  }));
}

export class InsightFaceBuffaloLProvider {
  constructor({ root, outputDirectory = "", runner = runPythonJson } = {}) {
    this.id = "insightface-buffalo-l";
    this.engine = "InsightFace buffalo_l";
    this.subjectKindsSupported = ["human"];
    this.thresholds = {
      pass: Number(process.env.CHARACTER_INSIGHTFACE_PASS_THRESHOLD || 0.32),
      warning: Number(process.env.CHARACTER_INSIGHTFACE_WARNING_THRESHOLD || 0.22),
    };
    this.root = root;
    this.outputDirectory = outputDirectory;
    this.runner = runner;
  }

  async capabilities() {
    const modelRoot = insightFaceModelRoot(this.outputDirectory);
    if (!modelRoot) {
      return {
        id: this.id,
        engine: this.engine,
        available: false,
        subjectKindsSupported: this.subjectKindsSupported,
        thresholds: this.thresholds,
        warnings: ["Modello reale InsightFace buffalo_l non trovato."],
      };
    }
    const result = await this.runner({
      root: this.root,
      environment: "comfyui",
      scriptName: "evaluate-character-identity.py",
      args: ["capabilities", "--model-root", modelRoot],
      timeout: 60_000,
    });
    const available = Boolean(result.ok && result.data?.available);
    return {
      id: this.id,
      engine: this.engine,
      available,
      modelRoot,
      subjectKindsSupported: this.subjectKindsSupported,
      thresholds: this.thresholds,
      providers: result.data?.providers || [],
      warnings: available ? [] : [result.data?.error || result.error || "Runtime InsightFace non disponibile."],
    };
  }

  async evaluate({ hero, references }) {
    const capability = await this.capabilities();
    if (!capability.available) throw new Error(capability.warnings[0]);
    const args = ["evaluate", "--model-root", capability.modelRoot, "--hero", hero.path];
    for (const reference of references) args.push("--reference", `${reference.id}=${reference.path}`);
    const result = await this.runner({
      root: this.root,
      environment: "comfyui",
      scriptName: "evaluate-character-identity.py",
      args,
      timeout: 300_000,
    });
    if (!result.ok || result.data?.status !== "completed") {
      throw new Error(result.data?.error || result.error || "Valutazione InsightFace fallita.");
    }
    return result.data.evaluations || [];
  }
}

export class IdentityEvaluationService {
  constructor({ providers = [] } = {}) {
    this.providers = providers;
  }

  async capabilities() {
    return Promise.all(this.providers.map((provider) => provider.capabilities()));
  }

  async evaluate({ subjectKind, hero, references = [] } = {}) {
    const evaluatedAt = new Date().toISOString();
    const capabilities = await this.capabilities();
    const supporting = capabilities.filter((item) => item.subjectKindsSupported.includes(subjectKind));
    if (!supporting.length) {
      const engine = capabilities[0]?.engine || null;
      const evaluations = unavailableEvaluations(
        references,
        IDENTITY_STATUSES.UNSUPPORTED_SUBJECT,
        engine,
        `Nessun engine disponibile supporta subjectKind=${subjectKind}. Usa la revisione manuale.`,
      );
      return normalizeIdentityEvaluation({
        enabled: false,
        engine,
        subjectKindsSupported: capabilities.flatMap((item) => item.subjectKindsSupported),
        evaluations,
        status: IDENTITY_STATUSES.UNSUPPORTED_SUBJECT,
        evaluatedAt,
        providers: capabilities,
      });
    }
    const capability = supporting.find((item) => item.available);
    if (!capability) {
      const selected = supporting[0];
      const message = selected.warnings?.[0] || `${selected.engine} non disponibile. Usa la revisione manuale.`;
      const evaluations = unavailableEvaluations(references, IDENTITY_STATUSES.ENGINE_UNAVAILABLE, selected.engine, message);
      return normalizeIdentityEvaluation({
        enabled: false,
        engine: selected.engine,
        subjectKindsSupported: selected.subjectKindsSupported,
        thresholds: selected.thresholds,
        evaluations,
        status: IDENTITY_STATUSES.ENGINE_UNAVAILABLE,
        evaluatedAt,
        warnings: [message],
        providers: capabilities,
      });
    }
    const provider = this.providers.find((item) => item.id === capability.id);
    try {
      const rawEvaluations = await provider.evaluate({ hero, references });
      const byId = new Map(rawEvaluations.map((item) => [item.referenceId, item]));
      const evaluations = references.map((reference) => {
        const raw = byId.get(reference.id) || {};
        const score = raw.score !== null && raw.score !== undefined && raw.score !== "" && Number.isFinite(Number(raw.score))
          ? Number(raw.score)
          : null;
        return {
          referenceId: reference.id,
          score,
          status: score == null ? IDENTITY_STATUSES.NOT_EVALUATED : mapIdentityScore(score, capability.thresholds),
          engine: capability.engine,
          evaluatedAt,
          warnings: warnings(raw.warnings),
        };
      });
      return normalizeIdentityEvaluation({
        enabled: true,
        engine: capability.engine,
        subjectKindsSupported: capability.subjectKindsSupported,
        thresholds: capability.thresholds,
        evaluations,
        status: aggregateStatus(evaluations),
        evaluatedAt,
        providers: capabilities,
      });
    } catch (error) {
      const evaluations = unavailableEvaluations(
        references,
        IDENTITY_STATUSES.ENGINE_UNAVAILABLE,
        capability.engine,
        error.message,
      );
      return normalizeIdentityEvaluation({
        enabled: false,
        engine: capability.engine,
        subjectKindsSupported: capability.subjectKindsSupported,
        thresholds: capability.thresholds,
        evaluations,
        status: IDENTITY_STATUSES.ENGINE_UNAVAILABLE,
        evaluatedAt,
        warnings: [error.message],
        providers: capabilities,
      });
    }
  }
}
