"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";

import {
  getInitialFunnelView,
  isRetentionOfferApplied,
  shouldShowFreshStartAction,
  type FunnelView,
} from "@/lib/landing-state";
import { buildPriceTiers, getOfferConfig, type OfferKind } from "@/lib/pricing";

type Gender = "male" | "female";
type Goal = "lose_weight" | "gain_muscle" | "keep_fit" | "get_toned";
type ActivityLevel = "sedentary" | "light" | "moderate" | "high";
type PacePreference = "gentle" | "standard" | "aggressive";
type WorkoutLocation = "home" | "gym" | "mixed";
type DietPreference = "balanced" | "high_protein" | "vegetarian" | "low_carb";
type StressLevel = "low" | "medium" | "high";
type MainBarrier = "no_time" | "cravings" | "motivation" | "knowledge" | "injury";
type SubscriptionPlan = "trial" | "monthly" | "quarterly";

type FormState = {
  gender: Gender | "";
  age: string;
  heightCm: string;
  weightKg: string;
  targetWeightKg: string;
  goal: Goal | "";
  pacePreference: PacePreference | "";
  activityLevel: ActivityLevel | "";
  workoutDaysPerWeek: string;
  sessionMinutes: string;
  workoutLocation: WorkoutLocation | "";
  dietPreference: DietPreference | "";
  sleepHours: string;
  stressLevel: StressLevel | "";
  mainBarrier: MainBarrier | "";
  healthDataConsent: boolean;
  wellnessEligible: boolean;
};

type LeadState = {
  name: string;
  email: string;
};

type AssessmentPayload = Partial<{
  gender: Gender;
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
  goal: Goal;
  pacePreference: PacePreference;
  activityLevel: ActivityLevel;
  workoutDaysPerWeek: number;
  sessionMinutes: number;
  workoutLocation: WorkoutLocation;
  dietPreference: DietPreference;
  sleepHours: number;
  stressLevel: StressLevel;
  mainBarrier: MainBarrier;
  healthDataConsent: boolean;
  wellnessEligible: boolean;
}>;

type AssessmentResponse = {
  sessionId: string;
  healthDataConsent: boolean;
  assessment: AssessmentPayload | null;
  step: number;
  completed: boolean;
  version: number;
};

type PlanPreview = {
  id: string;
  title: string;
  preview: string;
};

type PlanSection = PlanPreview & {
  items: string[];
};

type PlanDetailGroup = {
  title: string;
  items: string[];
};

type ResultsResponse = {
  sessionId: string;
  subscriptionStatus: "free" | "active";
  needPaywall: boolean;
  lockedFields?: string[];
  lockedSections?: string[];
  result: {
    bmi: number;
    bmiCategory: string;
    recommendedCaloriesRange?: string;
    recommendedCalories?: number;
    targetDate?: string | null;
    calculationDetails?: {
      projectionStatus: "projected" | "not_projected" | "maintenance";
      method: string;
      policyVersion: string;
      REE: number;
      TDEE: number;
      actualEnergyDifference: number;
      assumptions: Record<string, unknown>;
    };
    planPreview?: PlanPreview[];
    plan?: {
      summary: {
        pacePreference: PacePreference;
        workoutDaysPerWeek: number;
        sessionMinutes: number;
        workoutLocation: WorkoutLocation;
        dietPreference: DietPreference;
      };
      sections: PlanSection[];
    };
  };
};

type EditBaseline = {
  version: number;
};

type SavedChangesPending = {
  version: number;
  phase: "submit" | "results";
};

type ProjectionStatus = "projected" | "not_projected" | "maintenance";

type QuestionStep = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  fields: (keyof FormState)[];
};

type Option = {
  value: string;
  label: string;
  helper: string;
  mark: string;
};

const sessionStorageKey = "vitalpath-session-id";
const exitOfferStorageKey = "vitalpath-show-exit-offer";
const retentionOfferStorageKey = "vitalpath-retention-offer-session-id";

const initialForm: FormState = {
  gender: "",
  age: "",
  heightCm: "",
  weightKg: "",
  targetWeightKg: "",
  goal: "",
  pacePreference: "",
  activityLevel: "",
  workoutDaysPerWeek: "",
  sessionMinutes: "",
  workoutLocation: "",
  dietPreference: "",
  sleepHours: "",
  stressLevel: "",
  mainBarrier: "",
  healthDataConsent: false,
  wellnessEligible: false,
};

const initialLead: LeadState = {
  name: "",
  email: "",
};

const questionSteps: QuestionStep[] = [
  {
    id: "gender",
    eyebrow: "Personalize",
    title: "Which biological sex should we use for the estimate?",
    description: "This only sets the BMR formula coefficient for the metabolism calculation.",
    fields: ["gender"],
  },
  {
    id: "age",
    eyebrow: "Basics",
    title: "How old are you?",
    description: "Age changes metabolism estimates, so this stays part of the server calculation.",
    fields: ["age"],
  },
  {
    id: "body",
    eyebrow: "Body metrics",
    title: "Add your current and target body metrics.",
    description: "We use metric units only in this challenge: centimeters and kilograms.",
    fields: ["heightCm", "weightKg", "targetWeightKg"],
  },
  {
    id: "goal",
    eyebrow: "Goal",
    title: "What result are you working toward?",
    description: "Your goal shapes calorie guidance and the tone of your training plan.",
    fields: ["goal"],
  },
  {
    id: "pace",
    eyebrow: "Pace",
    title: "Choose the pace that feels realistic.",
    description: "A sustainable pace keeps the recommendation safer and easier to follow.",
    fields: ["pacePreference"],
  },
  {
    id: "activity",
    eyebrow: "Activity",
    title: "How active are you right now?",
    description: "This feeds the TDEE activity multiplier before the plan is generated.",
    fields: ["activityLevel"],
  },
  {
    id: "training",
    eyebrow: "Training rhythm",
    title: "Design your weekly training rhythm.",
    description: "The plan adapts to your available days, session length and training place.",
    fields: ["workoutDaysPerWeek", "sessionMinutes", "workoutLocation"],
  },
  {
    id: "nutrition",
    eyebrow: "Nutrition",
    title: "Pick the eating style you can keep.",
    description: "This does not replace medical advice; it only shapes practical plan copy.",
    fields: ["dietPreference"],
  },
  {
    id: "recovery",
    eyebrow: "Recovery",
    title: "How is your recovery baseline?",
    description: "Sleep and stress adjust the recovery guidance in your final plan.",
    fields: ["sleepHours", "stressLevel"],
  },
  {
    id: "barrier",
    eyebrow: "Final fit",
    title: "What usually gets in the way?",
    description: "We use this to make the daily actions feel less generic.",
    fields: ["mainBarrier", "healthDataConsent", "wellnessEligible"],
  },
];

const workoutDayOptions: Option[] = [
  { value: "2", label: "1-2 days", helper: "Low pressure, easy to keep consistent.", mark: "2" },
  { value: "3", label: "3 days", helper: "Balanced baseline for most routines.", mark: "3" },
  { value: "4", label: "4 days", helper: "More structure without crowding recovery.", mark: "4" },
  { value: "5", label: "5 days", helper: "Frequent training with lighter recovery days.", mark: "5" },
  { value: "6", label: "6-7 days", helper: "High frequency; plan keeps intensity managed.", mark: "6+" },
];

const sessionLengthOptions: Option[] = [
  { value: "30", label: "≤30 min", helper: "Short sessions for busy days.", mark: "30" },
  { value: "45", label: "30-45 min", helper: "A compact but complete workout block.", mark: "45" },
  { value: "60", label: "45-60 min", helper: "Standard full-session training.", mark: "60" },
  { value: "90", label: "60-90 min", helper: "Longer sessions with warm-up and accessories.", mark: "90" },
  { value: "120", label: "90-120 min", helper: "Extended training for higher volume days.", mark: "120" },
  { value: "150", label: "120+ min", helper: "For two-hour-plus sessions; plan uses a 150 min anchor.", mark: "2h+" },
];

export default function Home() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [serverStep, setServerStep] = useState(0);
  const [activeStep, setActiveStep] = useState(0);
  const [form, setForm] = useState<FormState>(initialForm);
  const [lead, setLead] = useState<LeadState>(initialLead);
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [view, setView] = useState<FunnelView>(getInitialFunnelView);
  const [status, setStatus] = useState("Preparing your assessment");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const [offerApplied, setOfferApplied] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>("monthly");
  const [paymentConfirmed, setPaymentConfirmed] = useState(false);
  const [exitOfferSeen, setExitOfferSeen] = useState(false);
  const [sessionWasRestored, setSessionWasRestored] = useState(false);
  const [conflictPending, setConflictPending] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editBaseline, setEditBaseline] = useState<EditBaseline | null>(null);
  const [savedChangesPending, setSavedChangesPending] = useState<SavedChangesPending | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState(9 * 60 + 42);

  const currentStep = questionSteps[activeStep];
  const currentErrors = useMemo(() => validateStep(activeStep, form), [activeStep, form]);
  const progressPercent = ((activeStep + 1) / questionSteps.length) * 100;
  const showFreshStartAction = shouldShowFreshStartAction({ sessionWasRestored });

  useLayoutEffect(() => {
    if (window.localStorage.getItem(sessionStorageKey)) {
      // 已有 session 时必须在首屏绘制前切到恢复态，避免结果页刷新闪回首页。
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setView("bootstrapping");
    }
  }, []);

  useEffect(() => {
    void bootstrapSession();
    // 首次进入时创建/恢复匿名 session；后续交互都复用同一条后端会话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (view !== "results" || !results?.needPaywall) return;

    const timer = window.setInterval(() => {
      setCountdownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [results?.needPaywall, view]);

  useEffect(() => {
    function onMouseLeave(event: MouseEvent) {
      if (event.clientY <= 0 && view === "results" && results?.needPaywall && !exitOfferSeen) {
        setExitOfferSeen(true);
        setOfferOpen(true);
      }
    }

    document.addEventListener("mouseleave", onMouseLeave);
    return () => document.removeEventListener("mouseleave", onMouseLeave);
  }, [exitOfferSeen, results?.needPaywall, view]);

  useEffect(() => {
    if (view !== "results" || !results?.needPaywall || offerApplied) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      window.sessionStorage.setItem(exitOfferStorageKey, "1");
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [offerApplied, results?.needPaywall, view]);

  const updateField = useCallback(<K extends keyof FormState>(field: K, value: FormState[K]) => {
    if (field === "goal") {
      const message = goalDirectionMessage(value as Goal, Number(form.weightKg), Number(form.targetWeightKg));
      if (message) {
        setError(message);
        return;
      }
      setError(null);
    }
    setForm((current) => ({ ...current, [field]: value }));
  }, [form.targetWeightKg, form.weightKg]);

  async function bootstrapSession() {
    const storedSessionId = window.localStorage.getItem(sessionStorageKey);
    try {
      setBusy(true);
      setError(null);
      setStatus("Preparing your assessment");

      if (storedSessionId) {
        setSessionId(storedSessionId);
        setOfferApplied(
          isRetentionOfferApplied({
            sessionId: storedSessionId,
            claimedSessionId: readRetentionOfferSessionId(),
          }),
        );
        const restoredCompleted = await restoreAssessment(storedSessionId, false, true);
        if (!restoredCompleted) setView("landing");
        setSessionWasRestored(true);
        setStatus("Ready");
        return;
      }

      const nextSessionId = await createSession();
      window.localStorage.setItem(sessionStorageKey, nextSessionId);
      clearRetentionOfferSessionId();
      setSessionId(nextSessionId);
      setOfferApplied(false);
      setSelectedPlan("monthly");
      setPaymentConfirmed(false);
      setConflictPending(false);
      setEditing(false);
      setEditBaseline(null);
      setSavedChangesPending(null);
      // 第一次进入时虽然会写 localStorage，但不把它当成“可重新开始”的旧会话。
      setSessionWasRestored(false);
      const restoredCompleted = await restoreAssessment(nextSessionId, false, false);
      if (!restoredCompleted) setView("landing");
      setStatus("Ready");
    } catch (caught) {
      setSessionId(storedSessionId);
      setSessionWasRestored(Boolean(storedSessionId));
      setError(messageFrom(caught));
      setStatus("Setup failed");
    } finally {
      setBusy(false);
    }
  }

  async function createSession() {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await readBody<{ sessionId: string }>(response);
    if (!body.sessionId) throw new Error("Session response did not include a sessionId.");
    return body.sessionId;
  }

  async function restoreAssessment(
    nextSessionId: string,
    switchView = true,
    restoreCompletedView = switchView,
    loadCompletedResult = restoreCompletedView,
  ) {
    const response = await fetch(`/api/assessment?sessionId=${encodeURIComponent(nextSessionId)}`);
    const body = await readBody<AssessmentResponse>(response);

    setVersion(body.version);
    setServerStep(body.step);
    setForm(formFromAssessment(body));

    if (body.completed && loadCompletedResult) {
      try {
        await loadResults(nextSessionId, restoreCompletedView);
      } catch (caught) {
        if (isResultRecoveryError(caught)) {
          setResults(null);
          await restoreAssessment(nextSessionId, false, false, false);
          setError("This report is out of date. Review the saved answers and generate it again.");
          setStatus("Report needs review");
          setView("funnel");
          return true;
        }
        throw caught;
      }
      return true;
    }

    setActiveStep(Math.min(body.step, questionSteps.length - 1));
    return false;
  }

  async function continueStep() {
    if (!sessionId || busy) return;

    const validationErrors = validateStep(activeStep, form);
    if (validationErrors.length > 0) {
      setError(validationErrors[0]);
      return;
    }

    if (editing) {
      if (activeStep < questionSteps.length - 1) {
        setError(null);
        setActiveStep((step) => step + 1);
        setStatus("Draft updated");
        return;
      }
      await saveEditedPlan();
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setStatus(activeStep === questionSteps.length - 1 ? "Generating plan" : "Saving answer");

      const response = await fetch("/api/assessment", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          step: activeStep + 1,
          version,
          data: payloadForStep(activeStep, form),
        }),
      });
      const body = await readBody<{ step: number; version: number; completed: boolean }>(response);

      setVersion(body.version);
      setServerStep(body.step);
      setConflictPending(false);

      if (activeStep < questionSteps.length - 1) {
        setActiveStep((step) => step + 1);
        setStatus("Answer saved");
        return;
      }

      await submitAndLoadResults(sessionId, false, body.version);
      setStatus("Report generated");
      setView("lead");
    } catch (caught) {
      setError(messageFrom(caught));
      setStatus("Save failed");
      if (caught instanceof ApiClientError && caught.code === "version_conflict") {
        setConflictPending(true);
        setError("Your saved answers changed elsewhere. Your current draft is preserved.");
      }
    } finally {
      setBusy(false);
    }
  }

  function beginEditing() {
    if (!results || busy) return;
    setEditBaseline({ version });
    setEditing(true);
    setConflictPending(false);
    setError(null);
    setActiveStep(0);
    setView("funnel");
    setStatus("Editing your answers");
  }

  async function saveEditedPlan() {
    if (!sessionId || busy || !editBaseline) return;

    const allErrors = questionSteps.flatMap((_, step) => validateStep(step, form));
    if (allErrors.length > 0) {
      const firstInvalidStep = questionSteps.findIndex((_, step) => validateStep(step, form).length > 0);
      setActiveStep(firstInvalidStep === -1 ? activeStep : firstInvalidStep);
      setError(allErrors[0]);
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setStatus("Saving updated answers");
      const data = questionSteps.reduce<AssessmentPayload>(
        (payload, _, step) => ({ ...payload, ...payloadForStep(step, form) }),
        {},
      );
      const response = await fetch("/api/assessment", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          step: questionSteps.length,
          version: editBaseline.version,
          data,
        }),
      });
      const body = await readBody<{ step: number; version: number; completed: boolean }>(response);

      setVersion(body.version);
      setServerStep(body.step);
      setResults(null);
      setEditing(false);
      setEditBaseline(null);
      setSavedChangesPending({ version: body.version, phase: "submit" });
      setStatus("Generating updated plan");
      try {
        await submitEditedPlan(body.version);
        setSavedChangesPending(null);
        setStatus("Plan updated");
      } catch (caught) {
        setError(`Your answers were saved, but the updated plan could not be generated. Retry to continue. ${messageFrom(caught)}`);
        setStatus("Plan update needs retry");
        setView("funnel");
      }
    } catch (caught) {
      setError(messageFrom(caught));
      setStatus("Save failed");
      if (caught instanceof ApiClientError && caught.code === "version_conflict") {
        setConflictPending(true);
        setError("Your saved answers changed elsewhere. Your current draft is preserved.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function retrySavedPlan() {
    if (!sessionId || busy || savedChangesPending === null) return;
    try {
      setBusy(true);
      setError(null);
      setStatus("Generating updated plan");
      if (savedChangesPending.phase === "submit") {
        await submitEditedPlan(savedChangesPending.version);
      } else {
        setGenerating(true);
        try {
          await loadResults(sessionId, true);
        } finally {
          setGenerating(false);
        }
      }
      setSavedChangesPending(null);
      setStatus("Plan updated");
    } catch (caught) {
      setError(`Your answers are saved, but the updated plan is still unavailable. Retry again. ${messageFrom(caught)}`);
      setStatus("Plan update needs retry");
    } finally {
      setBusy(false);
    }
  }

  async function submitEditedPlan(nextVersion: number) {
    setGenerating(true);
    try {
      const response = await fetch("/api/assessment/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, version: nextVersion }),
      });
      await readBody<{ ok: true; resultId: string }>(response);
      setSavedChangesPending({ version: nextVersion, phase: "results" });
      await loadResults(sessionId, true);
    } finally {
      setGenerating(false);
    }
  }

  async function cancelEditing() {
    if (!sessionId || busy || !editBaseline) return;

    try {
      setBusy(true);
      setError(null);
      setStatus("Checking saved plan");
      const assessmentResponse = await fetch(`/api/assessment?sessionId=${encodeURIComponent(sessionId)}`);
      const assessment = await readBody<AssessmentResponse>(assessmentResponse);
      const resultsResponse = await fetch(`/api/results?sessionId=${encodeURIComponent(sessionId)}`);
      const latestResults = await readBody<ResultsResponse>(resultsResponse);

      setVersion(assessment.version);
      setServerStep(assessment.step);
      setForm(formFromAssessment(assessment));
      setResults(latestResults);
      setEditing(false);
      setEditBaseline(null);
      setConflictPending(false);
      setPaymentConfirmed(false);
      setView("results");
      setStatus(assessment.version === editBaseline.version ? "Back to plan" : "Latest plan loaded");
    } catch (caught) {
      if (isResultRecoveryError(caught)) {
        setResults(null);
        try {
          await restoreAssessment(sessionId, false, false, false);
          setEditing(false);
          setEditBaseline(null);
          setView("funnel");
          setError("Your saved plan changed elsewhere. Review the latest answers before continuing.");
          setStatus("Plan needs review");
        } catch (refreshError) {
          setError(`We could not refresh your saved plan. Your draft is still here. ${messageFrom(refreshError)}`);
          setStatus("Refresh failed");
        }
      } else {
        setError(`We could not verify the saved plan. Your draft is still here. ${messageFrom(caught)}`);
        setStatus("Cancel needs retry");
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitAndLoadResults(nextSessionId: string, switchView = true, nextVersion = version) {
    setGenerating(true);
    try {
      await Promise.all([
        (async () => {
          const submitResponse = await fetch("/api/assessment/submit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: nextSessionId, version: nextVersion }),
          });
          await readBody<{ ok: true; resultId: string }>(submitResponse);
          await loadResults(nextSessionId, switchView);
        })(),
        wait(1200),
      ]);
    } finally {
      setGenerating(false);
    }
  }

  async function submitLeadContact() {
    if (!sessionId || busy) return;

    const validationError = validateLead(lead);
    if (validationError) {
      setError(validationError);
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setStatus("Saving report access");

      const response = await fetch("/api/sessions/lead", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          name: lead.name,
          email: lead.email,
        }),
      });
      await readBody(response);
      setStatus("Report ready");
      setView("results");
    } catch (caught) {
      setError(messageFrom(caught));
      setStatus("Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function loadResults(nextSessionId = sessionId, switchView = true) {
    if (!nextSessionId) return;
    const response = await fetch(`/api/results?sessionId=${encodeURIComponent(nextSessionId)}`);
    const body = await readBody<ResultsResponse>(response);
    setResults(body);
    if (switchView) setView("results");
    const shouldShowExitOffer = window.sessionStorage.getItem(exitOfferStorageKey) === "1";
    window.sessionStorage.removeItem(exitOfferStorageKey);
    if (body.needPaywall && shouldShowExitOffer) {
      setExitOfferSeen(true);
      setOfferOpen(true);
    }
  }

  async function recoverFromResultConflict(nextSessionId: string) {
    setResults(null);
    try {
      await restoreAssessment(nextSessionId, false, false, false);
      setError("This report is out of date. Review the saved answers and generate it again.");
      setStatus("Report needs review");
      setView("funnel");
    } catch (caught) {
      setError(`We could not refresh your saved answers. Retry without losing this session. ${messageFrom(caught)}`);
      setStatus("Refresh failed");
    }
  }

  async function unlockPlan(plan: SubscriptionPlan = selectedPlan) {
    if (!sessionId || busy || !results?.needPaywall) return;

    if (paymentConfirmed) {
      await retryReport();
      return;
    }

    try {
      setBusy(true);
      setError(null);
      setStatus("Unlocking plan");

      const response = await fetch("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, plan }),
      });
      await readBody(response);
      setPaymentConfirmed(true);
      try {
        await loadResults(sessionId, true);
      } catch (caught) {
        if (isResultRecoveryError(caught)) {
          await recoverFromResultConflict(sessionId);
          return;
        }
        setError(`Payment succeeded, but the report could not be loaded. Retry reading it. ${messageFrom(caught)}`);
        setStatus("Report load failed");
        return;
      }
      setOfferOpen(false);
      window.sessionStorage.removeItem(exitOfferStorageKey);
      setStatus("Full plan unlocked");
    } catch (caught) {
      setError(messageFrom(caught));
      setStatus("Payment failed");
    } finally {
      setBusy(false);
    }
  }

  async function retryReport() {
    if (!sessionId || busy) return;
    try {
      setBusy(true);
      setError(null);
      setStatus("Reloading report");
      await loadResults(sessionId, true);
      setStatus("Full plan unlocked");
    } catch (caught) {
      if (isResultRecoveryError(caught)) {
        await recoverFromResultConflict(sessionId);
      } else {
        setError(`The report could not be loaded. Retry again without paying again. ${messageFrom(caught)}`);
        setStatus("Report load failed");
      }
    } finally {
      setBusy(false);
    }
  }

  async function loadSavedAnswers() {
    if (!sessionId || busy) return;
    try {
      setBusy(true);
      setError(null);
      if (editing) {
        const assessmentResponse = await fetch(`/api/assessment?sessionId=${encodeURIComponent(sessionId)}`);
        const assessment = await readBody<AssessmentResponse>(assessmentResponse);
        const nextForm = formFromAssessment(assessment);
        let latestResults = results;
        if (assessment.completed) {
          const resultsResponse = await fetch(`/api/results?sessionId=${encodeURIComponent(sessionId)}`);
          latestResults = await readBody<ResultsResponse>(resultsResponse);
        }
        setVersion(assessment.version);
        setServerStep(assessment.step);
        setForm(nextForm);
        setResults(latestResults);
        setEditBaseline({ version: assessment.version });
      } else {
        await restoreAssessment(sessionId, false, false, false);
      }
      setConflictPending(false);
      setStatus("Saved answers loaded");
    } catch (caught) {
      setError(`Saved answers could not be loaded. Your draft is still here. ${messageFrom(caught)}`);
      setStatus("Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  function backStep() {
    setError(null);
    setActiveStep((step) => Math.max(0, step - 1));
    setView("funnel");
  }

  function resetSetup() {
    window.localStorage.removeItem(sessionStorageKey);
    clearRetentionOfferSessionId();
    setError(null);
    setResults(null);
    setForm(initialForm);
    setLead(initialLead);
    setActiveStep(0);
    setOfferApplied(false);
    setSelectedPlan("monthly");
    setPaymentConfirmed(false);
    setConflictPending(false);
    setEditing(false);
    setEditBaseline(null);
    setSavedChangesPending(null);
    setSessionWasRestored(false);
    window.sessionStorage.removeItem(exitOfferStorageKey);
    setView("bootstrapping");
    void bootstrapSession();
  }

  function retrySetup() {
    setError(null);
    setView("bootstrapping");
    void bootstrapSession();
  }

  if (status === "Setup failed") {
    return (
      <main className="page-frame">
        <section className="app-card setup-card">
          <p className="wordmark">VitalPath</p>
          <p className="eyebrow">Setup failed</p>
          <h1>We could not start your assessment.</h1>
          <p className="support-copy">
            We could not load your saved assessment. Retry keeps this anonymous session; start fresh only if you explicitly want a new one.
          </p>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button" type="button" disabled={busy} onClick={retrySetup}>
            Retry setup
          </button>
          {sessionWasRestored ? (
            <button className="text-button" type="button" disabled={busy} onClick={resetSetup}>
              Start fresh as a new user
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  if (view === "bootstrapping") {
    return (
      <main className="page-frame">
        <section className="app-card generating-card" aria-label="Restoring assessment">
          <p className="wordmark">VitalPath</p>
          <div className="loader-ring" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">Restoring your plan</p>
          <h1>Preparing your saved report.</h1>
          <p className="support-copy">
            We are checking your saved session and subscription state before showing the next
            screen.
          </p>
        </section>
      </main>
    );
  }

  if (view === "landing") {
    return (
      <main className="editorial-landing">
        <header className="editorial-header">
          <p className="wordmark">VitalPath<span className="brand-leaf" aria-hidden="true">↗</span></p>
          <span className="header-note">A little more you.</span>
        </header>
        <section className="landing-composition" aria-label="Your path to wellbeing">
          <div className="landing-story">
            <p className="editorial-kicker">Wellbeing, made personal.</p>
            <h1>A healthier life.<br /><em>At your pace.</em></h1>
            <p className="landing-deck">A considered plan for how you move, eat and recover. Built around your body. Made for your everyday.</p>
            <div className="landing-actions">
            {results ? (
              <button className="primary-button" type="button" aria-label="View my plan" onClick={() => setView("results")}>
                View my plan
              </button>
            ) : (
              <button
                className="primary-button"
                type="button"
                disabled={busy || !sessionId}
                aria-label={busy ? "Preparing…" : "Start"}
                onClick={() => setView("funnel")}
              >
                {busy ? "Preparing…" : "Start"}
              </button>
            )}
            {showFreshStartAction ? (
              <button className="text-button" type="button" disabled={busy} onClick={resetSetup}>
                Start fresh as a new user
              </button>
            ) : null}
            </div>
          </div>
          <figure className="landing-landscape">
            <div className="landscape-photo" role="img" aria-label="Morning light falling through a quiet green forest" />
            <figcaption><span>Room to grow.</span><span>One day at a time.</span></figcaption>
          </figure>
        </section>
        <section className="landing-approach" aria-labelledby="approach-title">
          <div><p className="editorial-kicker">A plan that fits</p><h2 id="approach-title">Your life comes first.</h2></div>
          <p>Start with a few questions about your body, your goals and your week. We turn your answers into a practical starting point you can come back to.</p>
          <ul><li>Movement that fits your schedule</li><li>Nutrition with a clear direction</li><li>Space for rest and recovery</li></ul>
        </section>
        <footer className="editorial-footer"><span>VitalPath · Personal wellbeing</span><span>A planning aid, not medical advice.</span></footer>
      </main>
    );
  }

  if (generating) {
    return (
      <main className="page-frame">
        <section className="app-card generating-card" aria-label="Generating report">
          <p className="wordmark">VitalPath</p>
          <div className="loader-ring" aria-hidden="true">
            <span />
          </div>
          <p className="eyebrow">Generating report</p>
          <h1>Building your metabolic plan.</h1>
          <p className="support-copy">
            We are calculating BMI, calorie guidance, target timing and your first plan preview from
            the answers saved on the server.
          </p>
          <div className="generation-steps" aria-hidden="true">
            <span>Calculating BMI</span>
            <span>Estimating calories</span>
            <span>Drafting plan preview</span>
          </div>
        </section>
      </main>
    );
  }

  if (view === "lead" && results) {
    return (
      <main className="page-frame">
        <section className="app-card lead-card" aria-label="Save generated report">
          <p className="wordmark">VitalPath</p>
          <p className="eyebrow">Report generated</p>
          <h1>Your plan is ready. Where should we save it?</h1>
          <p className="support-copy">
            Add your name and email to associate contact details with this session.
          </p>

          <div className="lead-summary">
            <span>BMI {results.result.bmi.toFixed(1)}</span>
            <span>{titleCase(results.result.bmiCategory)}</span>
            <span>{results.result.recommendedCaloriesRange ?? "Detailed plan ready"}</span>
          </div>

          <div className="field-stack">
            <fieldset className="form-fieldset" disabled={busy}>
              <TextField
                label="Name"
                value={lead.name}
                placeholder="Full name"
                onChange={(value) => setLead((current) => ({ ...current, name: value }))}
              />
              <TextField
                label="Email"
                value={lead.email}
                placeholder="you@example.com"
                type="email"
                onChange={(value) => setLead((current) => ({ ...current, email: value }))}
              />
            </fieldset>
          </div>

          {error ? <div className="form-error">{error}</div> : null}

          <div className="action-stack">
            <button className="primary-button" type="button" disabled={busy} onClick={submitLeadContact}>
              View my report
            </button>
            <button className="text-button" type="button" disabled={busy} onClick={() => setView("funnel")}>
              Back to answers
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (view === "results" && results) {
    const currentWeight = Number(form.weightKg);
    const targetWeight = Number(form.targetWeightKg);
    const targetDate = results.result.targetDate;
    const hasProjection = Number.isFinite(currentWeight) && Number.isFinite(targetWeight) && currentWeight !== targetWeight;
    const locked = results.needPaywall;
    const projectionStatus = results.result.calculationDetails?.projectionStatus;

    return (
      <main className="page-frame results-frame editorial-results">
        <header className="result-topbar">
          <p className="wordmark">VitalPath</p>
          <div className="result-topbar-right">
            {locked && !paymentConfirmed ? (
              <DiscountTimer seconds={countdownSeconds} />
            ) : (
              <span className="unlock-pill">
                <span aria-hidden="true" />
                Plan unlocked
              </span>
            )}
            {locked && !paymentConfirmed ? (
              <button className="topbar-cta" type="button" disabled={busy} onClick={() => unlockPlan(selectedPlan)}>
                Get my plan
              </button>
            ) : paymentConfirmed && results.needPaywall ? (
              <button className="topbar-cta" type="button" disabled={busy} onClick={retryReport}>
                Retry report
              </button>
            ) : (
              <button className="text-button" type="button" disabled={busy} onClick={beginEditing}>
                Edit answers
              </button>
            )}
            {locked && !paymentConfirmed ? (
              <button className="text-button" type="button" disabled={busy} onClick={beginEditing}>
                Edit answers
              </button>
            ) : null}
          </div>
        </header>

        <section className="results-card" aria-label="Generated plan">
          <div className="result-hero">
            <p className="eyebrow">Your personalized plan</p>
            <h1>{planHeadline(locked)}</h1>
            <p className="support-copy">
              {planSubhead(hasProjection, currentWeight, targetWeight, targetDate, projectionStatus, locked)}
            </p>
          </div>

          <div className="report-section-heading"><span>01 / The starting point</span><h2 className="section-title">Your health snapshot</h2></div>
          <div className="bento-grid">
            <div className="bento-cell bento-projection">
              <div className="bento-label">
                <ChartIcon />
                <span>Weight projection</span>
              </div>
              <WeightProjection
                currentWeight={currentWeight}
                targetWeight={targetWeight}
                locked={locked}
              />
            </div>

            <BmiCell bmi={results.result.bmi} category={results.result.bmiCategory} />

            <div className={`bento-cell bento-stat ${locked ? "locked" : ""}`}>
              <div className="bento-label">
                <FlameIcon />
                <span>Daily intake</span>
              </div>
              <strong className={locked ? "locked-value" : ""}>
                {locked
                  ? results.result.recommendedCaloriesRange ?? "0000"
                  : `${results.result.recommendedCalories}`}
              </strong>
              <small>{locked ? "kcal range hidden" : "kcal per day"}</small>
              {locked ? (
                <span className="lock-tag">
                  <LockIcon /> Locked
                </span>
              ) : null}
            </div>

            <div className={`bento-cell bento-stat ${locked ? "locked" : ""}`}>
              <div className="bento-label">
                <TargetIcon />
                <span>Goal date</span>
              </div>
              <strong className={locked ? "locked-value" : ""}>
                {locked ? "Mmm 00" : targetDate ? shortDate(targetDate) : projectionStatus === "maintenance" ? "Maintenance" : "No date estimated"}
              </strong>
              <small>{locked ? "scenario outcome hidden" : targetDate ? "scenario estimate" : projectionStatus === "maintenance" ? "equal-weight scenario" : "outside one-year scenario"}</small>
              {locked ? (
                <span className="lock-tag">
                  <LockIcon /> Locked
                </span>
              ) : null}
            </div>
          </div>

          <div className="report-section-heading"><span>02 / Your everyday</span><h2 className="section-title">Small steps. A clear direction.</h2></div>
          <PlanSections results={results} onUnlock={() => unlockPlan(selectedPlan)} busy={busy} />

          <MilestoneTimeline targetDate={targetDate} projectionStatus={projectionStatus} />

          <MethodNote />

          {locked && !paymentConfirmed ? (
            <PaywallCard
              busy={busy}
              countdownSeconds={countdownSeconds}
              offerApplied={offerApplied}
              selectedPlan={selectedPlan}
              onSelectPlan={setSelectedPlan}
              onUnlock={unlockPlan}
            />
          ) : paymentConfirmed && results.needPaywall ? (
            <section className="paywall-card" aria-label="Report retry">
              <p className="eyebrow">Payment confirmed</p>
              <h2>Your plan is paid. Reload the report to continue.</h2>
              <button className="coral-button" type="button" disabled={busy} onClick={retryReport}>
                Retry report
              </button>
            </section>
          ) : (
            <UnlockedCard results={results} />
          )}

          <FaqSection locked={locked} />

          {error ? <div className="form-error">{error}</div> : null}

          <footer className="result-footer">
            <button className="text-button" type="button" disabled={busy} onClick={beginEditing}>
              Back to answers
            </button>
            {locked && !paymentConfirmed ? (
              <button className="text-button accent" type="button" onClick={() => setOfferOpen(true)}>
                I&apos;m not ready yet
              </button>
            ) : null}
          </footer>
        </section>

        {offerOpen ? (
          <ExitOfferModal
            onClose={() => setOfferOpen(false)}
            onClaim={() => {
              if (sessionId) persistRetentionOfferSessionId(sessionId);
              setOfferApplied(true);
              setSelectedPlan("quarterly");
              setOfferOpen(false);
            }}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main className="editorial-funnel">
      <section className="funnel-card" aria-label="Health assessment">
        <div className="brand-row">
          <p className="wordmark">VitalPath</p>
          <span className="status-pill">{status}</span>
        </div>

        <div className="progress-meta">
          <span>
            Step {activeStep + 1} of {questionSteps.length}
          </span>
          <span>{Math.min(serverStep, questionSteps.length)} saved</span>
        </div>
        <div className="progress-track" aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="question-layout">
        <div className="question-story">
        <p className="chapter-number" aria-hidden="true">{String(activeStep + 1).padStart(2, "0")}<span> / {questionSteps.length}</span></p>
        <div className="question-copy">
          <p className="eyebrow">{currentStep.eyebrow}</p>
          <h1>{currentStep.title}</h1>
          <p>{currentStep.description}</p>
        </div>

        </div>
        <div className="question-response">
        <fieldset className="form-fieldset" disabled={busy || savedChangesPending !== null}>
          <StepFields step={activeStep} form={form} updateField={updateField} />
        </fieldset>

        {conflictPending ? (
          <div className="form-error" role="alert">
            Another save changed this session. Your draft is still visible; loading saved answers will replace it.
            <button className="text-button" type="button" disabled={busy} onClick={loadSavedAnswers}>
              Load saved answers and replace this draft
            </button>
          </div>
        ) : null}
        {error ? <div className="form-error">{error}</div> : null}
        {currentErrors.length > 0 ? <div className="form-hint">{currentErrors[0]}</div> : null}

        {savedChangesPending !== null ? (
          <div className="form-error" role="alert">
            Your answers are saved, but the updated plan is not ready yet.
            <button className="text-button" type="button" disabled={busy} onClick={retrySavedPlan}>
              Retry generating the plan
            </button>
          </div>
        ) : null}

        <div className="action-stack">
          <button className="primary-button" type="button" disabled={busy || savedChangesPending !== null} onClick={continueStep}>
            {generating
              ? "Generating..."
              : editing && activeStep === questionSteps.length - 1
                ? "Save and update plan"
                : activeStep === questionSteps.length - 1
                ? "Generate my plan"
                : "Continue"}
          </button>
          {editing ? (
            <button className="text-button" type="button" disabled={busy} onClick={cancelEditing}>
              Cancel editing
            </button>
          ) : null}
          <button className="text-button" type="button" disabled={activeStep === 0 || busy || savedChangesPending !== null} onClick={backStep}>
            Back
          </button>
        </div>
        </div>
        </div>
        <footer className="question-footer"><span>Your pace. Your path.</span><span>{editing ? "Changes stay in draft until you update your plan." : "Your answers are saved as you continue."}</span></footer>
      </section>
    </main>
  );
}

function StepFields({
  step,
  form,
  updateField,
}: {
  step: number;
  form: FormState;
  updateField: <K extends keyof FormState>(field: K, value: FormState[K]) => void;
}) {
  if (step === 0) {
    return (
      <OptionGroup
        label="Select one"
        value={form.gender}
        options={[
          { value: "female", label: "Female", helper: "Uses the female BMR coefficient.", mark: "F" },
          { value: "male", label: "Male", helper: "Uses the male BMR coefficient.", mark: "M" },
        ]}
        onChange={(value) => updateField("gender", value as Gender)}
      />
    );
  }

  if (step === 1) {
    return (
      <NumberField
        label="Age"
        value={form.age}
        suffix="years"
        min={20}
        max={78}
        onChange={(value) => updateField("age", value)}
      />
    );
  }

  if (step === 2) {
    return (
      <div className="field-stack">
        <NumberField
          label="Height"
          value={form.heightCm}
          suffix="cm"
          min={130}
          max={220}
          onChange={(value) => updateField("heightCm", value)}
        />
        <NumberField
          label="Current weight"
          value={form.weightKg}
          suffix="kg"
          min={20}
          max={500}
          onChange={(value) => updateField("weightKg", value)}
        />
        <NumberField
          label="Target weight"
          value={form.targetWeightKg}
          suffix="kg"
          min={20}
          max={500}
          onChange={(value) => updateField("targetWeightKg", value)}
        />
      </div>
    );
  }

  if (step === 3) {
    return (
      <OptionGroup
        label="Main goal"
        value={form.goal}
        options={[
          { value: "lose_weight", label: "Lose weight", helper: "Create a calorie deficit.", mark: "01" },
          { value: "gain_muscle", label: "Gain muscle", helper: "Add a controlled surplus.", mark: "02" },
          { value: "keep_fit", label: "Keep fit", helper: "Maintain and stabilize habits.", mark: "03" },
          { value: "get_toned", label: "Get toned", helper: "Blend deficit with strength work.", mark: "04" },
        ]}
        onChange={(value) => updateField("goal", value as Goal)}
      />
    );
  }

  if (step === 4) {
    return (
      <OptionGroup
        label="Preferred pace"
        value={form.pacePreference}
        options={[
          { value: "gentle", label: "Gentle", helper: "Smaller changes, easier adherence.", mark: "G" },
          { value: "standard", label: "Standard", helper: "Balanced pace for most people.", mark: "S" },
          { value: "aggressive", label: "Ambitious", helper: "Faster intent without unsafe deficits.", mark: "A" },
        ]}
        onChange={(value) => updateField("pacePreference", value as PacePreference)}
      />
    );
  }

  if (step === 5) {
    return (
      <OptionGroup
        label="Activity level"
        value={form.activityLevel}
        options={[
          { value: "sedentary", label: "Sedentary", helper: "Mostly seated days.", mark: "1.2" },
          { value: "light", label: "Light", helper: "Light movement or 1-2 workouts.", mark: "1.37" },
          { value: "moderate", label: "Moderate", helper: "Regular weekly training.", mark: "1.55" },
          { value: "high", label: "High", helper: "Frequent training or active work.", mark: "1.72" },
        ]}
        onChange={(value) => updateField("activityLevel", value as ActivityLevel)}
      />
    );
  }

  if (step === 6) {
    return (
      <div className="field-stack">
        <OptionGroup
          label="Workout days"
          value={form.workoutDaysPerWeek}
          options={workoutDayOptions}
          onChange={(value) => updateField("workoutDaysPerWeek", value)}
        />
        <OptionGroup
          label="Session length"
          value={form.sessionMinutes}
          options={sessionLengthOptions}
          onChange={(value) => updateField("sessionMinutes", value)}
        />
        <OptionGroup
          label="Training place"
          value={form.workoutLocation}
          options={[
            { value: "home", label: "Home", helper: "Low setup, easy to repeat.", mark: "H" },
            { value: "gym", label: "Gym", helper: "More equipment and strength focus.", mark: "G" },
            { value: "mixed", label: "Mixed", helper: "Flexible home and gym sessions.", mark: "M" },
          ]}
          onChange={(value) => updateField("workoutLocation", value as WorkoutLocation)}
        />
      </div>
    );
  }

  if (step === 7) {
    return (
      <OptionGroup
        label="Nutrition style"
        value={form.dietPreference}
        options={[
          { value: "balanced", label: "Balanced", helper: "Simple portions and variety.", mark: "B" },
          { value: "high_protein", label: "High protein", helper: "Protein-first meals and snacks.", mark: "P" },
          { value: "vegetarian", label: "Vegetarian", helper: "Plant-forward protein choices.", mark: "V" },
          { value: "low_carb", label: "Lower carb", helper: "Carb-aware, not extreme.", mark: "L" },
        ]}
        onChange={(value) => updateField("dietPreference", value as DietPreference)}
      />
    );
  }

  if (step === 8) {
    return (
      <div className="field-stack">
        <NumberField
          label="Sleep"
          value={form.sleepHours}
          suffix="hours"
          min={0}
          max={16}
          onChange={(value) => updateField("sleepHours", value)}
        />
        <OptionGroup
          label="Stress level"
          value={form.stressLevel}
          options={[
            { value: "low", label: "Low", helper: "Recovery can progress steadily.", mark: "L" },
            { value: "medium", label: "Medium", helper: "Plan includes recovery guardrails.", mark: "M" },
            { value: "high", label: "High", helper: "Lower intensity when needed.", mark: "H" },
          ]}
          onChange={(value) => updateField("stressLevel", value as StressLevel)}
        />
      </div>
    );
  }

  return (
    <div className="field-stack">
      <OptionGroup
        label="Main barrier"
        value={form.mainBarrier}
        options={[
          { value: "no_time", label: "No time", helper: "Plan favors short, repeatable actions.", mark: "T" },
          { value: "cravings", label: "Cravings", helper: "Plan adds snack and meal structure.", mark: "C" },
          { value: "motivation", label: "Motivation", helper: "Plan starts with low-friction actions.", mark: "M" },
          { value: "knowledge", label: "Know-how", helper: "Plan reduces daily choices.", mark: "K" },
          { value: "injury", label: "Limitations", helper: "Plan keeps movement low-impact.", mark: "L" },
        ]}
        onChange={(value) => updateField("mainBarrier", value as MainBarrier)}
      />
      <label className={`consent-card ${form.healthDataConsent ? "selected" : ""}`}>
        <input
          type="checkbox"
          checked={form.healthDataConsent}
          onChange={(event) => updateField("healthDataConsent", event.target.checked)}
        />
        <span>
          <strong>I agree to use my health data.</strong>
          <small>Required so the server can calculate and store your personalized plan.</small>
        </span>
      </label>
      <label className={`consent-card ${form.wellnessEligible ? "selected" : ""}`}>
        <input
          type="checkbox"
          checked={form.wellnessEligible}
          onChange={(event) => updateField("wellnessEligible", event.target.checked)}
        />
        <span>
          <strong>I confirm this estimate applies to me.</strong>
          <small>I am not pregnant or breastfeeding and do not need medical supervision for this diet plan.</small>
        </span>
      </label>
    </div>
  );
}

function OptionGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="option-group">
      <label>{label}</label>
      <div className="option-stack">
        {options.map((option) => (
          <button
            className={`option-card ${value === option.value ? "selected" : ""}`}
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
          >
            <span className="option-mark">{option.mark}</span>
            <span className="option-copy">
              <strong>{option.label}</strong>
              <small>{option.helper}</small>
            </span>
            <span className="radio-dot" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  suffix,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  suffix: string;
  min: number;
  max: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="number-field">
      <span>{label}</span>
      <div className="number-input-wrap">
        <input
          inputMode="decimal"
          min={min}
          max={max}
          type="number"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <em>{suffix}</em>
      </div>
    </label>
  );
}

function TextField({
  label,
  value,
  placeholder,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  type?: "text" | "email";
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-field">
      <span>{label}</span>
      <input
        autoComplete="off"
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function WeightProjection({
  currentWeight,
  targetWeight,
  locked,
}: {
  currentWeight: number;
  targetWeight: number;
  locked: boolean;
}) {
  const hasWeights = Number.isFinite(currentWeight) && Number.isFinite(targetWeight);
  const isLoss = hasWeights ? targetWeight < currentWeight : true;
  const curvePath = isLoss
    ? "M14,34 C150,40 210,104 300,112 S470,138 506,140"
    : "M14,140 C150,138 210,70 300,60 S470,36 506,34";
  const fillPath = `${curvePath} L506,160 L14,160 Z`;
  const startY = isLoss ? 34 : 140;
  const endY = isLoss ? 140 : 34;
  const labelY = isLoss ? 24 : 154;
  const targetLabelY = isLoss ? 132 : 48;
  const currentLabel = hasWeights ? `${formatKg(currentWeight)} kg` : "Current weight";
  const endTag = locked
    ? hasWeights
      ? `${formatKg(targetWeight)} kg`
      : "Target"
    : hasWeights
      ? `${formatKg(targetWeight)} kg`
      : "Target weight";

  return (
    <div className={`projection-panel ${locked ? "locked" : ""}`} aria-label="Weight projection">
      <svg className="weight-curve" viewBox="0 0 520 170" role="img" aria-label="Weight projection curve">
        <defs>
          <linearGradient id="wcFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#315347" stopOpacity="0.16" />
            <stop offset="1" stopColor="#315347" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill="url(#wcFill)" />
        <path
          d={curvePath}
          fill="none"
          stroke="#315347"
          strokeLinecap="round"
          strokeWidth="2.5"
          strokeDasharray="4 0"
        />
        <circle cx="14" cy={startY} r="5" fill="#315347" />
        <circle cx="506" cy={endY} r="6" fill="#315347" stroke="#f7f8f2" strokeWidth="3" />
        <text x="20" y={labelY} fill="#8a8474" fontSize="12">
          Now · {currentLabel}
        </text>
        <text
          className={locked ? "curve-locked-label" : ""}
          x="500"
          y={targetLabelY}
          fill="#23271f"
          fontSize="12"
          fontWeight="600"
          textAnchor="end"
        >
          {endTag}
        </text>
      </svg>
    </div>
  );
}

function BmiCell({ bmi, category }: { bmi: number; category: string }) {
  const segments = [
    { key: "underweight", label: "Under", max: 18.5 },
    { key: "normal", label: "Normal", max: 25 },
    { key: "overweight", label: "Over", max: 30 },
    { key: "obese", label: "Obese", max: 40 },
  ];
  // 把 BMI 映射到 0-100% 的刻度位置（13.5-40 区间裁剪），四段等宽。
  const clamped = Math.min(40, Math.max(13.5, bmi));
  const stops = [13.5, 18.5, 25, 30, 40];
  let pointer = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const lo = stops[i];
    const hi = stops[i + 1];
    if (clamped <= hi) {
      pointer = (i + (clamped - lo) / (hi - lo)) * 25;
      break;
    }
    pointer = (i + 1) * 25;
  }
  const tone = category;

  return (
    <div className="bento-cell bento-bmi">
      <div className="bento-label">
        <HeartIcon />
        <span>Body mass index</span>
      </div>
      <div className="bmi-headline">
        <strong>{bmi.toFixed(1)}</strong>
        <em className={`metric-pill ${tone}`}>{titleCase(category)}</em>
      </div>
      <div className="bmi-scale" aria-hidden="true">
        <div className="bmi-bar">
          <span className="bmi-seg underweight" />
          <span className="bmi-seg normal" />
          <span className="bmi-seg overweight" />
          <span className="bmi-seg obese" />
          <span className="bmi-pointer" style={{ left: `${pointer}%` }} />
        </div>
        <div className="bmi-ticks">
          {segments.map((segment) => (
            <span key={segment.key}>{segment.label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

const planMeta: Record<
  string,
  { icon: () => ReactElement; lockedMore: string; previewLabel: string }
> = {
  workout: { icon: RunIcon, lockedMore: "6 more days", previewLabel: "Day 1 preview" },
  nutrition: { icon: SaladIcon, lockedMore: "20 meals", previewLabel: "Sample meal" },
  recovery: { icon: MoonIcon, lockedMore: "Full guide", previewLabel: "First step" },
  daily_actions: { icon: ChecklistIcon, lockedMore: "Daily steps", previewLabel: "Today's action" },
};

const fallbackLockedPlanSections: PlanPreview[] = [
  {
    id: "nutrition",
    title: "Nutrition plan",
    preview: "Meal structure, portions and weekly calorie adjustments.",
  },
  {
    id: "recovery",
    title: "Recovery plan",
    preview: "Sleep, stress and low-intensity recovery rules.",
  },
  {
    id: "daily_actions",
    title: "Daily actions",
    preview: "Daily checklist, habit triggers and progress review.",
  },
];

function PlanSections({
  results,
  onUnlock,
  busy,
}: {
  results: ResultsResponse;
  onUnlock: () => void;
  busy: boolean;
}) {
  if (results.result.plan) {
    return (
      <div className="plan-stack">
        <h2 className="section-title">What your plan includes</h2>
        {results.result.plan.summary ? (
          <p className="plan-summary-line">
            {summaryLine(results.result.plan.summary)}
          </p>
        ) : null}
        {results.result.plan.sections.map((section) => {
          const Icon = planMeta[section.id]?.icon ?? CheckIcon;
          return (
            <section className="plan-block" key={section.id}>
              <div className="plan-block-head">
                <span className="plan-icon">
                  <Icon />
                </span>
                <div className="plan-block-copy">
                  <p className="eyebrow">{section.title}</p>
                  <h3>{section.preview}</h3>
                </div>
              </div>
              <PlanDetailGroups groups={fullPlanDetailGroups(section)} />
            </section>
          );
        })}
      </div>
    );
  }

  const preview = results.result.planPreview ?? [];
  const previewSections = previewPlanSections(preview);

  return (
    <div className="plan-stack">
      <h2 className="section-title">What your plan includes</h2>
      <p className="plan-summary-line">
        A complete 4-part routine is already drafted from your answers. Each section shows one
        preview line now; the full detail unlocks with the subscription.
      </p>
      {previewSections.map((section) => {
        const meta = planMeta[section.id];
        const Icon = meta?.icon ?? CheckIcon;
        return (
          <section className="plan-block teaser preview-open" key={section.id}>
            <div className="plan-block-head">
              <span className="plan-icon">
                <Icon />
              </span>
              <div className="plan-block-copy">
                <p className="eyebrow">{section.title}</p>
                <h3>{section.preview}</h3>
              </div>
              <span className="preview-chip">
                {meta?.previewLabel ?? "Preview"}
              </span>
            </div>
            <PlanDetailGroups groups={previewPlanDetailGroups(section)} lockedFromIndex={0} />
            <div className="teaser-blur" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          </section>
        );
      })}
      <button className="plan-unlock-strip" type="button" disabled={busy} onClick={onUnlock}>
        <LockIcon />
        Unlock all {previewSections.length} sections and your full weekly schedule
        <ArrowIcon />
      </button>
    </div>
  );
}

function PlanDetailGroups({
  groups,
  locked = false,
  lockedFromIndex,
}: {
  groups: PlanDetailGroup[];
  locked?: boolean;
  lockedFromIndex?: number;
}) {
  return (
    <div className={`plan-detail-groups ${locked ? "is-locked" : ""}`}>
      {groups.map((group, index) => (
        <div
          className={`plan-detail-group ${
            lockedFromIndex !== undefined && index >= lockedFromIndex ? "is-blurred" : ""
          }`}
          key={group.title}
        >
          <strong>{group.title}</strong>
          <ul className="plan-items">
            {group.items.map((item, index) => (
              <li key={`${group.title}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function fullPlanDetailGroups(section: PlanSection): PlanDetailGroup[] {
  const [first, second, third] = section.items;

  if (section.id === "workout") {
    return [
      {
        title: "Weekly structure",
        items: [
          first ?? section.preview,
          second ?? "Keep each session short enough to complete on normal workdays.",
        ],
      },
      {
        title: "Execution notes",
        items: [
          third ?? "Use a lighter mobility day when soreness or stress is high.",
          "Treat missed sessions as reschedules, not failures, so the week stays recoverable.",
        ],
      },
      {
        title: "Progress check",
        items: [
          "Track completion, energy and soreness after each session.",
          "Only raise intensity after one consistent week, not after one strong day.",
        ],
      },
    ];
  }

  if (section.id === "nutrition") {
    return [
      {
        title: "Meal framework",
        items: [
          first ?? section.preview,
          second ?? "Plan snacks before the low-energy window so choices stay deliberate.",
        ],
      },
      {
        title: "Adjustment rule",
        items: [
          third ?? "Adjust portions weekly based on weight trend, not one noisy day.",
          "Keep the target simple: repeat meals that work before adding variety.",
        ],
      },
      {
        title: "What to watch",
        items: [
          "Use hunger, sleep and training performance as checks against an overly aggressive deficit.",
          "If adherence drops, simplify the meal template before changing the goal.",
        ],
      },
    ];
  }

  if (section.id === "recovery") {
    return [
      {
        title: "Baseline rule",
        items: [
          first ?? section.preview,
          second ?? "Choose lower intensity when stress is elevated.",
        ],
      },
      {
        title: "Recovery signals",
        items: [
          third ?? "Track energy for the first week before raising volume.",
          "Poor sleep, heavy soreness or low motivation move the next session down one level.",
        ],
      },
      {
        title: "Why it matters",
        items: [
          "Recovery protects consistency, which matters more than any single hard workout.",
          "The plan is designed to progress without forcing crash-diet or burnout patterns.",
        ],
      },
    ];
  }

  return [
    {
      title: "Daily anchor",
      items: [
        first ?? section.preview,
        second ?? "Block the action in your calendar before the day starts.",
      ],
    },
    {
      title: "Friction control",
      items: [
        third ?? "Review the plan each evening and choose tomorrow's smallest action.",
        "Keep the next step visible so you do not have to decide under stress.",
      ],
    },
    {
      title: "End-of-day review",
      items: [
        "Mark the action complete, skipped or rescheduled.",
        "Use the review to make tomorrow easier, not to punish today's miss.",
      ],
    },
  ];
}

function previewPlanDetailGroups(section: PlanPreview): PlanDetailGroup[] {
  return [
    {
      title: "Unlock adds",
      items: [
        previewDetailLine(section.id),
        `The full version expands this into ${planMeta[section.id]?.lockedMore.toLowerCase() ?? "more detail"}.`,
        "Member results also reveal the protected calories, target timing and complete execution order.",
      ],
    },
  ];
}

function previewPlanSections(preview: PlanPreview[]) {
  const usedIds = new Set(preview.map((section) => section.id));
  const fallback = fallbackLockedPlanSections.filter((section) => !usedIds.has(section.id));
  return [...preview, ...fallback].slice(0, 4);
}

function previewDetailLine(sectionId: string) {
  if (sectionId === "workout") return "You can see the weekly training rhythm before unlocking the exact progression.";
  if (sectionId === "nutrition") return "You can see the nutrition direction before unlocking meals and portion rules.";
  if (sectionId === "recovery") return "You can see the recovery baseline before unlocking stress and sleep adjustments.";
  return "You can see the first daily anchor before unlocking the full checklist.";
}

function MilestoneTimeline({
  targetDate,
  projectionStatus,
}: {
  targetDate?: string | null;
  projectionStatus?: "projected" | "not_projected" | "maintenance";
}) {
  const milestones = [
    {
      tag: "Start",
      title: "Build a repeatable routine",
      body: "Use the saved routine as a starting point and adjust it to your schedule and energy.",
    },
    {
      tag: "Regular review",
      title: "Review your response",
      body: "Track weight, energy and soreness over time; this estimate assumes intake and activity stay broadly stable.",
    },
    {
      tag: targetDate ? shortDate(targetDate) : projectionStatus === "maintenance" ? "Maintenance" : "No date estimated",
      title: "Choose the next adjustment",
      body: targetDate
        ? "The date is a simplified scenario estimate, so reassess it when your real-world trend changes."
        : "The model does not promise a target date here; review the target and choose adjustments with appropriate care.",
      gold: true,
    },
  ];

  return (
    <div className="milestones">
      <h2 className="section-title">Your road to results</h2>
      <ol className="milestone-list">
        {milestones.map((milestone, index) => (
          <li className={`milestone ${milestone.gold ? "gold" : ""}`} key={index}>
            <span className="milestone-node" aria-hidden="true" />
            <div className="milestone-body">
              <span className="milestone-tag">{milestone.tag}</span>
              <strong>{milestone.title}</strong>
              <p>{milestone.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function MethodNote() {
  return (
    <section className="social-proof" aria-label="Estimate method">
      <h2 className="section-title">How this estimate works</h2>
      <p>
        The report keeps Mifflin-St Jeor for resting energy, applies the selected activity multiplier,
        and uses a fixed-intake simplified energy-balance scenario for the projection. The result is
        a planning aid, not a clinical prediction; review it as your real-world trend changes.
      </p>
    </section>
  );
}

const faqItems = [
  {
    q: "What happens when I select a plan?",
    a: "This challenge uses a simulated payment for the current anonymous session. No real charge or payment account is created.",
  },
  {
    q: "Is my plan really personalized?",
    a: "Every plan is built from your answers — your goal, body metrics, activity level, schedule and the barrier you told us about. No two plans are identical.",
  },
  {
    q: "How are dates calculated?",
    a: "A paid report can show a date only when the simplified fixed-intake scenario reaches the target within one year. Equal-weight goals show maintenance, and other cases can have no date estimate.",
  },
  {
    q: "Do I need a gym or equipment?",
    a: "No. Your plan adapts to where you train — home, gym or a mix — using only what you have available.",
  },
];

function FaqSection({ locked }: { locked: boolean }) {
  return (
    <div className="faq">
      <h2 className="section-title">{locked ? "Before you decide" : "Good to know"}</h2>
      <div className="faq-list">
        {faqItems.map((item) => (
          <details className="faq-item" key={item.q}>
            <summary>
              <span>{item.q}</span>
              <span className="faq-plus" aria-hidden="true">
                <PlusIcon />
              </span>
            </summary>
            <p>{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}

function PaywallCard({
  busy,
  countdownSeconds,
  offerApplied,
  selectedPlan,
  onSelectPlan,
  onUnlock,
}: {
  busy: boolean;
  countdownSeconds: number;
  offerApplied: boolean;
  selectedPlan: SubscriptionPlan;
  onSelectPlan: (plan: SubscriptionPlan) => void;
  onUnlock: (plan: SubscriptionPlan) => void;
}) {
  const offerKind: OfferKind = offerApplied ? "retention" : "initial";
  const offer = getOfferConfig(offerKind);
  const priceTiers = buildPriceTiers(offerKind);

  return (
    <section className="paywall-card" aria-label="Payment offer">
      <div className="paywall-top">
        <p className="eyebrow">Unlock your full plan</p>
        <DiscountTimer seconds={countdownSeconds} inverted />
      </div>
      <h2>Get exact calories, the projection outcome and the full weekly plan.</h2>
      <p>
        {offer.headline} Everything you previewed above stays available to unlock in full,
        including the day-by-day schedule, meal ideas and recovery guide.
      </p>

      <div className="price-tiers">
        {priceTiers.map((tier) => (
          <button
            className={`price-tier ${planForTier(tier.id) === selectedPlan ? "selected" : ""}`}
            key={tier.id}
            type="button"
            onClick={() => onSelectPlan(planForTier(tier.id))}
          >
            {tier.popular ? <span className="tier-flag">Most popular</span> : null}
            <span className="tier-label">{tier.label}</span>
            <span className="tier-price">
              <strong>{tier.now}</strong>
              <em>{tier.old}</em>
            </span>
            <span className="tier-per">{tier.per}</span>
            <span className="tier-discount">{tier.discountLabel}</span>
            <span className="tier-radio" aria-hidden="true" />
          </button>
        ))}
      </div>

      <button
        className="coral-button"
        type="button"
        disabled={busy}
        onClick={() => onUnlock(selectedPlan)}
      >
        {offer.cta}
      </button>

      <small className="paywall-fineprint">
        Demo checkout: this button simulates payment for this session. No real charge is made.
      </small>
    </section>
  );
}

function planForTier(tierId: string): SubscriptionPlan {
  if (tierId === "1week") return "trial";
  if (tierId === "12weeks") return "quarterly";
  return "monthly";
}

function DiscountTimer({ seconds, inverted = false }: { seconds: number; inverted?: boolean }) {
  const { minutes, remainingSeconds } = countdownParts(seconds);

  return (
    <div className={`discount-timer ${inverted ? "inverted" : ""}`} aria-label="Discount countdown">
      <span className="discount-label">Discount is reserved for:</span>
      <span className="discount-time">
        <strong>{minutes}</strong>
        <small>minutes</small>
      </span>
      <span className="discount-separator">:</span>
      <span className="discount-time">
        <strong>{remainingSeconds}</strong>
        <small>seconds</small>
      </span>
    </div>
  );
}

function UnlockedCard({ results }: { results: ResultsResponse }) {
  const projectionStatus = results.result.calculationDetails?.projectionStatus;
  return (
    <section className="unlocked-card">
      <div className="unlocked-head">
        <span className="unlocked-icon">
          <CheckIcon />
        </span>
        <div>
          <p className="eyebrow">Full plan active</p>
          <h2>You&apos;re all set — everything below is unlocked.</h2>
        </div>
      </div>
      <div className="unlocked-stats">
        <div>
          <span>Daily intake</span>
          <strong>{results.result.recommendedCalories} kcal</strong>
        </div>
        <div>
          <span>Goal date</span>
          <strong>
            {results.result.targetDate
              ? shortDate(results.result.targetDate)
              : projectionStatus === "maintenance"
                ? "Maintenance"
                : "No date estimated"}
          </strong>
        </div>
      </div>
    </section>
  );
}

function ExitOfferModal({ onClose, onClaim }: { onClose: () => void; onClaim: () => void }) {
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Discount offer">
      <div className="offer-modal">
        <p className="eyebrow">Before you go</p>
        <h2>Unlock a 50% off exit offer.</h2>
        <p>
          Your current plan has 30% off. Apply this one-time 50% discount to unlock exact calories,
          the projection outcome and the full plan for less.
        </p>
        <div className="modal-actions">
          <button className="text-button" type="button" onClick={onClose}>
            Maybe later
          </button>
          <button className="primary-button" type="button" onClick={onClaim}>
            Apply 50% off
          </button>
        </div>
      </div>
    </div>
  );
}

function iconProps(extra?: string) {
  return {
    className: `icon ${extra ?? ""}`.trim(),
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function ChartIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 19V5M4 19h16" />
      <path d="M7 15l3.5-4 3 2.5L20 7" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 20s-7-4.6-9.2-9C1.3 8 2.6 5 5.6 5 7.4 5 8.8 6 12 9c3.2-3 4.6-4 6.4-4 3 0 4.3 3 2.8 6-2.2 4.4-9.2 9-9.2 9z" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 3c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1 0-1.5-.3-2.2C16 10 18 12.5 18 15a6 6 0 1 1-12 0c0-3.5 3-5.5 4-8 .5-1.3 1.3-2.7 2-4z" />
    </svg>
  );
}

function TargetIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

function RunIcon() {
  return (
    <svg {...iconProps()}>
      <circle cx="15.5" cy="5" r="1.6" />
      <path d="M5 21l3-4 3 1 1-4-3-2 4-3 2 3 3 1" />
    </svg>
  );
}

function SaladIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 11h16a8 8 0 0 1-16 0z" />
      <path d="M9 11c-.5-2 .5-4 2.5-4.5M14 11c0-2.5 1.5-3.5 3.5-3.5M12 4v2.5" />
      <path d="M7 19h10" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5 7.5 7.5 0 1 0 19 14.5z" />
    </svg>
  );
}

function ChecklistIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6l1 1 1.5-2M4 12l1 1 1.5-2M4 18l1 1 1.5-2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M5 12.5l4.5 4.5L19 6.5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 6v12M6 12h12" />
    </svg>
  );
}

function planHeadline(locked: boolean) {
  return locked ? "Your personalized plan is ready." : "Your personalized plan is unlocked.";
}

function planSubhead(
  hasProjection: boolean,
  currentWeight: number,
  targetWeight: number,
  targetDate: string | null | undefined,
  projectionStatus: ProjectionStatus | undefined,
  locked: boolean,
) {
  if (locked) {
    return "Built from your answers using a simplified energy-balance scenario. Unlock the full report to see its assumptions and outcome.";
  }
  if (!hasProjection) {
    return "This equal-weight goal is treated as maintenance; keep reviewing the plan as your routine changes.";
  }
  const direction = targetWeight < currentWeight ? "reach" : "build toward";
  const goal = `${direction} ${formatKg(targetWeight)} kg`;
  if (projectionStatus === "maintenance") {
    return "This scenario is treated as maintenance; review the plan as your routine changes.";
  }
  if (projectionStatus === "not_projected") {
    return `The simplified scenario did not reach ${goal} within one year; review the target and reassess regularly.`;
  }
  if (targetDate) {
    return `Under the simplified energy-balance scenario, you're on track to ${goal} by ${shortDate(targetDate)}.`;
  }
  return `The simplified scenario has no date estimate for ${goal}; review the target and reassess regularly.`;
}

function summaryLine(summary: {
  pacePreference: PacePreference;
  workoutDaysPerWeek: number;
  sessionMinutes: number;
  workoutLocation: WorkoutLocation;
  dietPreference: DietPreference;
}) {
  return `${titleCase(summary.pacePreference)} pace · ${summary.workoutDaysPerWeek} days/week · ${summary.sessionMinutes} min · ${titleCase(summary.workoutLocation)} · ${titleCase(summary.dietPreference)} nutrition`;
}

function payloadForStep(step: number, form: FormState): AssessmentPayload {
  if (step === 0) return { gender: form.gender as Gender };
  if (step === 1) return { age: toNumber(form.age) };
  if (step === 2) {
    return {
      heightCm: toNumber(form.heightCm),
      weightKg: toNumber(form.weightKg),
      targetWeightKg: toNumber(form.targetWeightKg),
    };
  }
  if (step === 3) return { goal: form.goal as Goal };
  if (step === 4) return { pacePreference: form.pacePreference as PacePreference };
  if (step === 5) return { activityLevel: form.activityLevel as ActivityLevel };
  if (step === 6) {
    return {
      workoutDaysPerWeek: toNumber(form.workoutDaysPerWeek),
      sessionMinutes: toNumber(form.sessionMinutes),
      workoutLocation: form.workoutLocation as WorkoutLocation,
    };
  }
  if (step === 7) return { dietPreference: form.dietPreference as DietPreference };
  if (step === 8) {
    return {
      sleepHours: toNumber(form.sleepHours),
      stressLevel: form.stressLevel as StressLevel,
    };
  }
  return {
    mainBarrier: form.mainBarrier as MainBarrier,
    healthDataConsent: form.healthDataConsent,
    wellnessEligible: form.wellnessEligible,
  };
}

function validateStep(step: number, form: FormState) {
  const errors: string[] = [];
  const required = questionSteps[step].fields;

  for (const field of required) {
    if (field === "healthDataConsent") {
      if (!form.healthDataConsent) errors.push("Please accept health data use before generating.");
      continue;
    }
    if (field === "wellnessEligible") {
      if (!form.wellnessEligible) errors.push("Confirm the estimate eligibility before generating.");
      continue;
    }

    if (form[field] === "") {
      errors.push(`Complete ${fieldLabel(field)} before continuing.`);
    }
  }

  if (step === 1) range(errors, "Age", form.age, 20, 78, true);
  if (step === 2) {
    range(errors, "Height", form.heightCm, 130, 220);
    range(errors, "Current weight", form.weightKg, 20, 500);
    range(errors, "Target weight", form.targetWeightKg, 20, 500);
    if (form.heightCm && form.weightKg && form.targetWeightKg) {
      const heightM = Number(form.heightCm) / 100;
      const currentBmi = Number(form.weightKg) / heightM ** 2;
      const targetBmi = Number(form.targetWeightKg) / heightM ** 2;
      if (currentBmi < 18.5 || currentBmi >= 40) errors.push("Current BMI must be 18.5 to below 40 for this estimate.");
      if (targetBmi < 18.5 || targetBmi >= 40) errors.push("Target BMI must be 18.5 to below 40 for this estimate.");
    }
  }
  if (step === 3 && form.goal) {
    const message = goalDirectionMessage(form.goal, Number(form.weightKg), Number(form.targetWeightKg));
    if (message) errors.push(message);
  }
  if (step === 6) {
    range(errors, "Workout days", form.workoutDaysPerWeek, 1, 7, true);
    range(errors, "Session minutes", form.sessionMinutes, 10, 240, true);
  }
  if (step === 8) range(errors, "Sleep hours", form.sleepHours, 0, 16);

  return errors;
}

function goalDirectionMessage(goal: Goal, currentWeight: number, targetWeight: number) {
  if (!Number.isFinite(currentWeight) || !Number.isFinite(targetWeight)) return null;
  if (goal === "lose_weight" && targetWeight >= currentWeight) {
    return "Lose weight needs a target below your current weight. Go back and update the body metrics.";
  }
  if (goal === "gain_muscle" && targetWeight <= currentWeight) {
    return "Gain muscle needs a target above your current weight. Go back and update the body metrics.";
  }
  if (goal === "keep_fit" && targetWeight !== currentWeight) {
    return "Keep fit uses an equal target weight. Go back and set the target to your current weight.";
  }
  if (goal === "get_toned" && targetWeight > currentWeight) {
    return "Get toned supports an equal or lower target weight. Go back and update the body metrics.";
  }
  return null;
}

function validateLead(lead: LeadState) {
  if (lead.name.trim().length === 0) return "Add your name before viewing the report.";
  if (lead.name.trim().length > 80) return "Name must be 80 characters or fewer.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email.trim())) return "Enter a valid email address.";
  return null;
}

function range(errors: string[], label: string, value: string, min: number, max: number, integer = false) {
  if (value === "") return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    errors.push(`${label} must be ${integer ? "an integer " : ""}between ${min} and ${max}.`);
  }
}

function formFromAssessment(response: AssessmentResponse): FormState {
  const assessment = response.assessment;
  if (!assessment) return { ...initialForm, healthDataConsent: response.healthDataConsent };

  return {
    gender: assessment.gender ?? "",
    age: valueToString(assessment.age),
    heightCm: valueToString(assessment.heightCm),
    weightKg: valueToString(assessment.weightKg),
    targetWeightKg: valueToString(assessment.targetWeightKg),
    goal: assessment.goal ?? "",
    pacePreference: assessment.pacePreference ?? "",
    activityLevel: assessment.activityLevel ?? "",
    workoutDaysPerWeek: valueToString(assessment.workoutDaysPerWeek),
    sessionMinutes: valueToString(assessment.sessionMinutes),
    workoutLocation: assessment.workoutLocation ?? "",
    dietPreference: assessment.dietPreference ?? "",
    sleepHours: valueToString(assessment.sleepHours),
    stressLevel: assessment.stressLevel ?? "",
    mainBarrier: assessment.mainBarrier ?? "",
    healthDataConsent: response.healthDataConsent,
    wellnessEligible: assessment.wellnessEligible ?? false,
  };
}

class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function readBody<T = unknown>(response: Response): Promise<T> {
  const text = await response.text();
  const body = parseJsonBody(text) as T & { message?: string; error?: string };

  if (!response.ok) {
    throw new ApiClientError(
      body.message ?? body.error ?? `Request failed with status ${response.status}`,
      response.status,
      body.error,
    );
  }

  return body;
}

function parseJsonBody(text: string) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: "Unexpected non-JSON server response" };
  }
}

function isResultRecoveryError(error: unknown) {
  return error instanceof ApiClientError && ["assessment_stale", "assessment_not_submitted"].includes(error.code ?? "");
}

function toNumber(value: string) {
  return Number(value);
}

function valueToString(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function fieldLabel(field: keyof FormState) {
  return field
    .replace(/([A-Z])/g, " $1")
    .replace("Cm", "cm")
    .replace("Kg", "kg")
    .toLowerCase();
}

function titleCase(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function shortDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

function formatKg(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function countdownParts(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return {
    minutes: String(minutes).padStart(2, "0"),
    remainingSeconds: String(remainingSeconds).padStart(2, "0"),
  };
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

function readRetentionOfferSessionId() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(retentionOfferStorageKey);
}

function persistRetentionOfferSessionId(nextSessionId: string) {
  window.localStorage.setItem(retentionOfferStorageKey, nextSessionId);
}

function clearRetentionOfferSessionId() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(retentionOfferStorageKey);
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
