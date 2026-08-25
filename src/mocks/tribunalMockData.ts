export type ExecutionMode = "shared" | "separate";
export type AdvocateSide = "PRO" | "CON";
export type Verdict = "GUILTY" | "NOT_GUILTY";
export type ParticipantStatus =
  | "Waiting"
  | "Running"
  | "Retrying"
  | "Complete"
  | "Failed";

export type ParticipantKind = "advocate" | "judge";

export type Participant = {
  id: ParticipantId;
  label: string;
  kind: ParticipantKind;
  side?: AdvocateSide;
};

export type ParticipantId =
  | "advocate-pro-1"
  | "advocate-pro-2"
  | "advocate-con-1"
  | "advocate-con-2"
  | "judge-1"
  | "judge-2"
  | "judge-3";

export type MockModel = {
  id: string;
  displayName: string;
  priceLabel: string;
  classification: "Free" | "Paid";
  eligible: boolean;
};

export type EconomicsRow = {
  participant: string;
  attempt: number;
  model: string;
  input: number | "Unavailable";
  output: number | "Unavailable";
  total: number | "Unavailable";
  cost: string | "Unavailable";
  latency: string;
  status: "Success" | "Failed";
};

export const advocateParticipants: Participant[] = [
  { id: "advocate-pro-1", label: "PRO I", kind: "advocate", side: "PRO" },
  { id: "advocate-pro-2", label: "PRO II", kind: "advocate", side: "PRO" },
  { id: "advocate-con-1", label: "CON I", kind: "advocate", side: "CON" },
  { id: "advocate-con-2", label: "CON II", kind: "advocate", side: "CON" }
];

export const judgeParticipants: Participant[] = [
  { id: "judge-1", label: "Judge I", kind: "judge" },
  { id: "judge-2", label: "Judge II", kind: "judge" },
  { id: "judge-3", label: "Judge III", kind: "judge" }
];

export const allParticipants = [...advocateParticipants, ...judgeParticipants];

export const mockModels: MockModel[] = [
  {
    id: "mock/free-deliberator",
    displayName: "Mock Free Deliberator",
    priceLabel: "Free mock option",
    classification: "Free",
    eligible: true
  },
  {
    id: "mock/low-cost-judge",
    displayName: "Mock Low-Cost Judge",
    priceLabel: "$0.05 / 1M input · $0.10 / 1M output",
    classification: "Paid",
    eligible: true
  },
  {
    id: "mock/deep-review",
    displayName: "Mock Deep Review",
    priceLabel: "$0.30 / 1M input · $0.60 / 1M output",
    classification: "Paid",
    eligible: true
  }
];

export const defaultPersonalityByParticipant: Record<ParticipantId, string> = {
  "advocate-pro-1": "Precise, evidence-focused, and calm under pressure.",
  "advocate-pro-2": "Story-driven, persuasive, and attentive to motive.",
  "advocate-con-1": "Skeptical, procedural, and careful about burden of proof.",
  "advocate-con-2": "Plainspoken, practical, and focused on alternative explanations.",
  "judge-1": "Methodical and statute-minded, with concise reasoning.",
  "judge-2": "Contextual and fairness-oriented, weighing competing narratives.",
  "judge-3": "Strict about evidence quality and explicit uncertainty."
};

export const mockJudgeVotes = [
  {
    judge: "Judge I",
    verdict: "GUILTY" as Verdict,
    model: "Mock Free Deliberator",
    personality: defaultPersonalityByParticipant["judge-1"],
    reasoning:
      "The first judge finds the PRO arguments more internally consistent and gives greater weight to the admitted timeline."
  },
  {
    judge: "Judge II",
    verdict: "NOT_GUILTY" as Verdict,
    model: "Mock Low-Cost Judge",
    personality: defaultPersonalityByParticipant["judge-2"],
    reasoning:
      "The second judge sees reasonable uncertainty in the CON explanation and does not treat confidence as proof."
  },
  {
    judge: "Judge III",
    verdict: "GUILTY" as Verdict,
    model: "Mock Free Deliberator",
    personality: defaultPersonalityByParticipant["judge-3"],
    reasoning:
      "The third judge accepts that the record supports the exact question more strongly than the competing account."
  }
];

export const mockAdvocateSpeeches = [
  {
    participant: "PRO I",
    side: "PRO",
    model: "Mock Free Deliberator",
    personality: defaultPersonalityByParticipant["advocate-pro-1"],
    speech:
      "The strongest PRO account is that the admitted facts form a coherent sequence. The conduct, timing, and stated question align without requiring speculative gaps."
  },
  {
    participant: "PRO II",
    side: "PRO",
    model: "Mock Low-Cost Judge",
    personality: defaultPersonalityByParticipant["advocate-pro-2"],
    speech:
      "The PRO side frames the case as a deliberate choice with observable consequences. The narrative is simple, consistent, and supported by the Charge Sheet."
  },
  {
    participant: "CON I",
    side: "CON",
    model: "Mock Free Deliberator",
    personality: defaultPersonalityByParticipant["advocate-con-1"],
    speech:
      "The CON position is that the question has not been proven with enough precision. Alternative explanations remain plausible and should not be swept aside."
  },
  {
    participant: "CON II",
    side: "CON",
    model: "Mock Deep Review",
    personality: defaultPersonalityByParticipant["advocate-con-2"],
    speech:
      "A practical reading leaves room for mistake, ambiguity, or incomplete context. The Tribunal should resist turning an incomplete record into certainty."
  }
];

export const mockEconomicsRows: EconomicsRow[] = [
  {
    participant: "PRO I",
    attempt: 1,
    model: "mock/free-deliberator",
    input: 1210,
    output: 420,
    total: 1630,
    cost: "$0.00",
    latency: "0.8s",
    status: "Success"
  },
  {
    participant: "CON II",
    attempt: 1,
    model: "mock/deep-review",
    input: "Unavailable",
    output: "Unavailable",
    total: "Unavailable",
    cost: "Unavailable",
    latency: "1.1s",
    status: "Failed"
  },
  {
    participant: "CON II",
    attempt: 2,
    model: "mock/deep-review",
    input: 1310,
    output: 390,
    total: 1700,
    cost: "$0.04",
    latency: "1.3s",
    status: "Success"
  }
];

export const mockHistoryCases = [
  {
    id: "hist-1",
    defendant: "Alex Rowan",
    exactQuestion: "Did Alex knowingly violate the shared lab protocol?",
    date: "2026-08-20",
    executionMode: "Shared Model",
    status: "Completed",
    verdict: "GUILTY",
    cost: "$0.17"
  },
  {
    id: "hist-2",
    defendant: "Dana Vale",
    exactQuestion: "Was Dana responsible for the disputed project outage?",
    date: "2026-08-21",
    executionMode: "Separate Models",
    status: "Completed",
    verdict: "NOT_GUILTY",
    cost: "$0.12"
  },
  {
    id: "hist-3",
    defendant: "Morgan Lee",
    exactQuestion: "Did Morgan breach the group submission agreement?",
    date: "2026-08-22",
    executionMode: "Shared Model",
    status: "Failed",
    verdict: null,
    cost: "$0.03 partial"
  }
];
