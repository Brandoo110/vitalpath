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
    targetDate?: string;
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

const sessionStorageKey = "health-funnel-session-id";
const exitOfferStorageKey = "health-funnel-show-exit-offer";
const retentionOfferStorageKey = "health-funnel-retention-offer-session-id";

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
    fields: ["mainBarrier", "healthDataConsent"],
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
  const [exitOfferSeen, setExitOfferSeen] = useState(false);
  const [sessionWasRestored, setSessionWasRestored] = useState(false);
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
    setForm((current) => ({ ...current, [field]: value }));
  }, []);

  async function bootstrapSession() {
    try {
      setBusy(true);
      setError(null);
      setStatus("Preparing your assessment");

      const storedSessionId = window.localStorage.getItem(sessionStorageKey);
      if (storedSessionId) {
        try {
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
        } catch (caught) {
          // 数据库被 reset 或 demo 数据被清理后，旧 localStorage 会导致恢复失败。
          if (!isRecoverableSessionError(caught)) throw caught;
          window.localStorage.removeItem(sessionStorageKey);
          clearRetentionOfferSessionId();
          setOfferApplied(false);
          setSessionWasRestored(false);
        }
      }

      const nextSessionId = await createSession();
      window.localStorage.setItem(sessionStorageKey, nextSessionId);
      clearRetentionOfferSessionId();
      setSessionId(nextSessionId);
      setOfferApplied(false);
      // 第一次进入时虽然会写 localStorage，但不把它当成“可重新开始”的旧会话。
      setSessionWasRestored(false);
      const restoredCompleted = await restoreAssessment(nextSessionId, false, false);
      if (!restoredCompleted) setView("landing");
      setStatus("Ready");
    } catch (caught) {
      setSessionId(null);
      setSessionWasRestored(false);
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
  ) {
    const response = await fetch(`/api/assessment?sessionId=${encodeURIComponent(nextSessionId)}`);
    const body = await readBody<AssessmentResponse>(response);

    setVersion(body.version);
    setServerStep(body.step);
    setForm(formFromAssessment(body));

    if (body.completed) {
      await loadResults(nextSessionId, restoreCompletedView);
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

      if (activeStep < questionSteps.length - 1) {
        setActiveStep((step) => step + 1);
        setStatus("Answer saved");
        return;
      }

      await submitAndLoadResults(sessionId, false);
      setStatus("Report generated");
      setView("lead");
    } catch (caught) {
      setError(messageFrom(caught));
      setStatus("Save failed");
      if (messageFrom(caught).toLowerCase().includes("version") && sessionId) {
        await restoreAssessment(sessionId);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitAndLoadResults(nextSessionId: string, switchView = true) {
    setGenerating(true);
    try {
      await Promise.all([
        (async () => {
          const submitResponse = await fetch("/api/assessment/submit", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: nextSessionId }),
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

  async function unlockPlan() {
    if (!sessionId || busy || !results?.needPaywall) return;

    try {
      setBusy(true);
      setError(null);
      setStatus("Unlocking plan");

      const response = await fetch("/api/pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, plan: offerApplied ? "quarterly" : "monthly" }),
      });
      await readBody(response);
      await loadResults(sessionId, true);
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
    setSessionWasRestored(false);
    window.sessionStorage.removeItem(exitOfferStorageKey);
    setView("bootstrapping");
    void bootstrapSession();
  }

  if (!sessionId && status === "Setup failed") {
    return (
      <main className="page-frame">
        <section className="app-card setup-card">
          <p className="wordmark">Better Health Plan</p>
          <p className="eyebrow">Setup failed</p>
          <h1>We could not start your assessment.</h1>
          <p className="support-copy">
            The saved session may be stale or the API could not create a new one. Retry clears the
            local session and asks the server for a fresh anonymous ID.
          </p>
          {error ? <div className="form-error">{error}</div> : null}
          <button className="primary-button" type="button" disabled={busy} onClick={resetSetup}>
            Retry setup
          </button>
        </section>
      </main>
    );
  }

  if (view === "bootstrapping") {
    return (
      <main className="page-frame">
        <section className="app-card generating-card" aria-label="Restoring assessment">
          <p className="wordmark">Better Health Plan</p>
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
      <main className="page-frame landing-frame">
        <section className="landing">
          <p className="wordmark">Better Health Plan</p>
          <p className="eyebrow">Personalized in minutes</p>
          <h1>Build a health plan that fits your body and your week.</h1>
          <p className="landing-sub">
            Answer a few quick questions about your goals, body and routine. We calculate your BMI,
            daily calories and a realistic target date, then build a workout, nutrition and recovery
            plan around them.
          </p>
          <ul className="landing-points">
            <li>
              <strong>Personalized</strong>
              Plan adapts to your goal, pace and weekly schedule.
            </li>
            <li>
              <strong>Science-based</strong>
              BMI, BMR and TDEE computed on the server, not guessed.
            </li>
            <li>
              <strong>Saved as you go</strong>
              Every step is stored, so you can pick up where you left off.
            </li>
          </ul>
          <div className="landing-actions">
            {results ? (
              <button className="primary-button" type="button" onClick={() => setView("results")}>
                View my plan
              </button>
            ) : (
              <button
                className="primary-button"
                type="button"
                disabled={busy || !sessionId}
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
        </section>
      </main>
    );
  }

  if (generating) {
    return (
      <main className="page-frame">
        <section className="app-card generating-card" aria-label="Generating report">
          <p className="wordmark">Better Health Plan</p>
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
          <p className="wordmark">Better Health Plan</p>
          <p className="eyebrow">Report generated</p>
          <h1>Your plan is ready. Where should we save it?</h1>
          <p className="support-copy">
            Add your name and email after generation so your report can be restored or sent later.
          </p>

          <div className="lead-summary">
            <span>BMI {results.result.bmi.toFixed(1)}</span>
            <span>{titleCase(results.result.bmiCategory)}</span>
            <span>{results.result.recommendedCaloriesRange ?? "Detailed plan ready"}</span>
          </div>

          <div className="field-stack">
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
    const hasProjection = Number.isFinite(currentWeight) && Number.isFinite(targetWeight);
    const locked = results.needPaywall;
    const planWeeks = projectionWeeks(currentWeight, targetWeight);

    return (
      <main className="page-frame results-frame">
        <header className="result-topbar">
          <p className="wordmark">Better Health Plan</p>
          <div className="result-topbar-right">
            {locked ? (
              <DiscountTimer seconds={countdownSeconds} />
            ) : (
              <span className="unlock-pill">
                <span aria-hidden="true" />
                Plan unlocked
              </span>
            )}
            {locked ? (
              <button className="topbar-cta" type="button" disabled={busy} onClick={unlockPlan}>
                Get my plan
              </button>
            ) : (
              <button className="text-button" type="button" onClick={() => setView("funnel")}>
                Edit answers
              </button>
            )}
          </div>
        </header>

        <section className="results-card" aria-label="Generated plan">
          <div className="result-hero">
            <p className="eyebrow">Your personalized plan</p>
            <h1>{planHeadline(hasProjection, planWeeks, locked)}</h1>
            <p className="support-copy">
              {planSubhead(hasProjection, currentWeight, targetWeight, targetDate, locked)}
            </p>
          </div>

          <h2 className="section-title">Your health snapshot</h2>
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
                {locked ? "Mmm 00" : targetDate ? shortDate(targetDate) : "On track"}
              </strong>
              <small>{locked ? "exact date hidden" : "at 0.75 kg / week"}</small>
              {locked ? (
                <span className="lock-tag">
                  <LockIcon /> Locked
                </span>
              ) : null}
            </div>
          </div>

          <PlanSections results={results} onUnlock={unlockPlan} busy={busy} />

          <MilestoneTimeline weeks={planWeeks} targetDate={targetDate} locked={locked} />

          <SocialProof />

          {locked ? (
            <PaywallCard
              busy={busy}
              countdownSeconds={countdownSeconds}
              offerApplied={offerApplied}
              onUnlock={unlockPlan}
            />
          ) : (
            <UnlockedCard results={results} />
          )}

          <FaqSection locked={locked} />

          {error ? <div className="form-error">{error}</div> : null}

          <footer className="result-footer">
            <button className="text-button" type="button" onClick={() => setView("funnel")}>
              Back to answers
            </button>
            {locked ? (
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
              setOfferOpen(false);
            }}
          />
        ) : null}
      </main>
    );
  }

  return (
    <main className="page-frame">
      <section className="app-card funnel-card" aria-label="Health assessment">
        <div className="brand-row">
          <p className="wordmark">Better Health Plan</p>
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

        <div className="question-copy">
          <p className="eyebrow">{currentStep.eyebrow}</p>
          <h1>{currentStep.title}</h1>
          <p>{currentStep.description}</p>
        </div>

        <StepFields step={activeStep} form={form} updateField={updateField} />

        {error ? <div className="form-error">{error}</div> : null}
        {currentErrors.length > 0 ? <div className="form-hint">{currentErrors[0]}</div> : null}

        <div className="action-stack">
          <button className="primary-button" type="button" disabled={busy} onClick={continueStep}>
            {generating
              ? "Generating..."
              : activeStep === questionSteps.length - 1
                ? "Generate my plan"
                : "Continue"}
          </button>
          <button className="text-button" type="button" disabled={activeStep === 0 || busy} onClick={backStep}>
            Back
          </button>
        </div>
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
        min={13}
        max={120}
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
          min={50}
          max={300}
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
            <stop offset="0" stopColor="#2c4a3b" stopOpacity="0.16" />
            <stop offset="1" stopColor="#2c4a3b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillPath} fill="url(#wcFill)" />
        <path
          d={curvePath}
          fill="none"
          stroke="#2c4a3b"
          strokeLinecap="round"
          strokeWidth="2.5"
          strokeDasharray="4 0"
        />
        <circle cx="14" cy={startY} r="5" fill="#2c4a3b" />
        <circle cx="506" cy={endY} r="6" fill="#c9a24b" stroke="#faf6ef" strokeWidth="3" />
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
  weeks,
  targetDate,
  locked,
}: {
  weeks: number | null;
  targetDate?: string;
  locked: boolean;
}) {
  const goalLabel = locked
    ? weeks
      ? `Week ${weeks}`
      : "Goal week"
    : targetDate
      ? shortDate(targetDate)
      : weeks
        ? `Week ${weeks}`
        : "Goal";
  const milestones = [
    {
      tag: "Week 1–2",
      title: "Build the habit",
      body: "Lock in your daily actions and ease into the training rhythm. Early wins keep you going.",
    },
    {
      tag: "Week 4",
      title: "Visible momentum",
      body: "Energy and strength climb as the plan adapts. Most people notice the first real change here.",
    },
    {
      tag: goalLabel,
      title: "Reach your goal",
      body: "Steady, sustainable progress lands you at your target without crash dieting.",
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

const socialTestimonials = [
  {
    quote:
      "I'd tried everything. The day-by-day plan finally made it click — down 6 kg and it never felt like a diet.",
    name: "Sarah M.",
    meta: "Lost 6 kg in 8 weeks",
  },
  {
    quote:
      "The calorie target and meal ideas took all the guesswork out. I actually look forward to the workouts now.",
    name: "David L.",
    meta: "Member since March",
  },
];

const pressLogos = ["Healthline", "Women's Health", "Good Housekeeping"];

function SocialProof() {
  return (
    <div className="social-proof">
      <div className="social-stats">
        <div>
          <strong>2.2M</strong>
          <span>plans created</span>
        </div>
        <div>
          <strong>
            4.6 <StarIcon />
          </strong>
          <span>average rating</span>
        </div>
        <div>
          <strong>93%</strong>
          <span>hit their goal</span>
        </div>
      </div>

      <div className="testimonials">
        {socialTestimonials.map((testimonial) => (
          <figure className="testimonial" key={testimonial.name}>
            <div className="testimonial-stars" aria-hidden="true">
              <StarIcon />
              <StarIcon />
              <StarIcon />
              <StarIcon />
              <StarIcon />
            </div>
            <blockquote>{testimonial.quote}</blockquote>
            <figcaption>
              <strong>{testimonial.name}</strong>
              <span>{testimonial.meta}</span>
            </figcaption>
          </figure>
        ))}
      </div>

      <div className="press-row">
        <span className="press-label">As featured in</span>
        <div className="press-logos">
          {pressLogos.map((logo) => (
            <span key={logo}>{logo}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

const faqItems = [
  {
    q: "Can I cancel anytime?",
    a: "Yes. You can cancel in one tap from your account — no calls, no forms. You keep access until the end of your billing period.",
  },
  {
    q: "Is my plan really personalized?",
    a: "Every plan is built from your answers — your goal, body metrics, activity level, schedule and the barrier you told us about. No two plans are identical.",
  },
  {
    q: "What if it doesn't work for me?",
    a: "You're covered by a 30-day money-back guarantee. If you follow the plan and don't see progress, we refund you in full.",
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
  onUnlock,
}: {
  busy: boolean;
  countdownSeconds: number;
  offerApplied: boolean;
  onUnlock: () => void;
}) {
  const [selected, setSelected] = useState("4weeks");
  const offerKind: OfferKind = offerApplied ? "retention" : "initial";
  const offer = getOfferConfig(offerKind);
  const priceTiers = buildPriceTiers(offerKind);

  return (
    <section className="paywall-card" aria-label="Payment offer">
      <div className="paywall-top">
        <p className="eyebrow">Unlock your full plan</p>
        <DiscountTimer seconds={countdownSeconds} inverted />
      </div>
      <h2>Get your exact calories, goal date and full weekly plan.</h2>
      <p>
        {offer.headline} Everything you previewed above stays available to unlock in full,
        including the day-by-day schedule, meal ideas and recovery guide.
      </p>

      <div className="price-tiers">
        {priceTiers.map((tier) => (
          <button
            className={`price-tier ${selected === tier.id ? "selected" : ""}`}
            key={tier.id}
            type="button"
            onClick={() => setSelected(tier.id)}
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

      <button className="coral-button" type="button" disabled={busy} onClick={onUnlock}>
        {offer.cta}
      </button>

      <ul className="paywall-trust">
        <li>
          <ShieldIcon /> 30-day money-back guarantee
        </li>
        <li>
          <LockIcon /> SSL-secured checkout
        </li>
        <li>
          <CardIcon /> Cancel anytime
        </li>
      </ul>
      <small className="paywall-fineprint">
        Demo checkout: clicking Get my plan simulates payment and unlocks this session · Trusted by
        2.2M members · 4.6★ average rating · secured by 256-bit encryption
      </small>
    </section>
  );
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
            {results.result.targetDate ? shortDate(results.result.targetDate) : "On track"}
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
          Your current plan has 30% off. Apply this one-time 50% discount to unlock the exact
          calories, target date and full plan for less.
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

function StarIcon() {
  return (
    <svg className="icon star" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 3.5l2.6 5.3 5.9.8-4.3 4.1 1 5.8L12 16.9 6.8 19.5l1-5.8L3.5 9.6l5.9-.8z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 3l7 2.5v5C19 16 16 19.5 12 21c-4-1.5-7-5-7-10.5v-5z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M7 15h3" />
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

function projectionWeeks(currentWeight: number, targetWeight: number): number | null {
  if (!Number.isFinite(currentWeight) || !Number.isFinite(targetWeight)) return null;
  const diff = Math.abs(currentWeight - targetWeight);
  if (diff === 0) return null;
  return Math.max(1, Math.ceil(diff / 0.75));
}

function planHeadline(hasProjection: boolean, weeks: number | null, locked: boolean) {
  if (hasProjection && weeks) {
    const weekLabel = weeks === 1 ? "1-week" : `${weeks}-week`;
    return locked ? `Your ${weekLabel} plan is ready.` : `Your ${weekLabel} plan is unlocked.`;
  }
  return locked ? "Your personalized plan is ready." : "Your personalized plan is unlocked.";
}

function planSubhead(
  hasProjection: boolean,
  currentWeight: number,
  targetWeight: number,
  targetDate: string | undefined,
  locked: boolean,
) {
  if (!hasProjection) {
    return "Built from your answers — your goal, body metrics, routine and recovery all shaped this plan.";
  }
  const direction = targetWeight < currentWeight ? "reach" : "build toward";
  const goal = `${direction} ${formatKg(targetWeight)} kg`;
  if (!locked && targetDate) {
    return `On a sustainable 0.75 kg/week pace, you're on track to ${goal} by ${shortDate(targetDate)}.`;
  }
  return `On a sustainable 0.75 kg/week pace, here's your path to ${goal} — unlock to see your exact goal date.`;
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

    if (form[field] === "") {
      errors.push(`Complete ${fieldLabel(field)} before continuing.`);
    }
  }

  if (step === 1) range(errors, "Age", form.age, 13, 120, true);
  if (step === 2) {
    range(errors, "Height", form.heightCm, 50, 300);
    range(errors, "Current weight", form.weightKg, 20, 500);
    range(errors, "Target weight", form.targetWeightKg, 20, 500);
  }
  if (step === 6) {
    range(errors, "Workout days", form.workoutDaysPerWeek, 1, 7, true);
    range(errors, "Session minutes", form.sessionMinutes, 10, 240, true);
  }
  if (step === 8) range(errors, "Sleep hours", form.sleepHours, 0, 16);

  return errors;
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

function isRecoverableSessionError(error: unknown) {
  return error instanceof ApiClientError && (error.status === 404 || error.code === "not_found");
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
