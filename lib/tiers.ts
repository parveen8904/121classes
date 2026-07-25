// Marketing-facing description of each tier (what a student actually gets).
// Bronze is FREE for everyone; Silver adds tests; Gold adds premium classes.

export type TierMeta = { tagline: string; features: string[] };

export const TIER_META: Record<string, TierMeta> = {
  bronze: {
    tagline: "Free for everyone — core lectures & notes.",
    features: [
      "Revision & topic videos",
      "Downloadable PDF notes & question banks",
      "Past examination questions",
      "No payment needed",
    ],
  },
  silver: {
    tagline: "Everything free, plus tests & doubt-solving.",
    features: [
      "Everything in Bronze (free)",
      "Auto-graded MCQ tests",
      "Subjective tests with AI evaluation",
      "AI Ask-a-Doubt, guided by CA Parveen Sharma",
    ],
  },
  gold: {
    tagline: "The complete experience — premium classes + FREE printed books.",
    features: [
      "📦 FREE printed books couriered to you on 9+ month plans (book PDFs are free for every student)",
      "⏱️ 2× watch time per class — revision videos UNLIMITED, open till validity ends",
      "Everything in Silver",
      "Premium full coaching-class videos",
      "Live classes on Zoom",
      "Priority doubt-solving",
    ],
  },
};

export const TIER_RANK: Record<string, number> = { bronze: 1, silver: 2, gold: 3 };
