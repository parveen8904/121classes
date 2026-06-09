// Marketing-facing description of each tier (what a student actually gets).
// Kept separate from the raw `plans.features` jsonb so the pricing page reads
// like a real plan comparison rather than a flag dump.

export type TierMeta = { tagline: string; features: string[] };

export const TIER_META: Record<string, TierMeta> = {
  bronze: {
    tagline: "Self-paced revision essentials to lock in the concepts.",
    features: [
      "First & second revision videos",
      "All topic videos",
      "Downloadable PDF notes & question banks",
      "Past examination questions",
    ],
  },
  silver: {
    tagline: "Revision plus practice and instant doubt-solving.",
    features: [
      "Everything in Bronze",
      "AI Ask-a-Doubt, guided by CA Parveen Sharma",
      "Subjective tests with AI evaluation",
      "Auto-graded MCQ tests",
    ],
  },
  gold: {
    tagline: "The complete 1:1 experience — nothing held back.",
    features: [
      "Everything in Silver",
      "Full coaching-class recordings",
      "Live classes on Zoom",
      "Priority doubt-solving",
    ],
  },
};

export const TIER_RANK: Record<string, number> = { bronze: 1, silver: 2, gold: 3 };
