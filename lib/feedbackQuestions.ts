// THE TEN QUESTIONS.
//
// Kept in one place because they appear in three: the form, the admin report,
// and any email that asks for them. Changing a wording in one and not the
// others is how a report comes to average two different questions together.
//
// Every one is about something we can actually act on. "How likely are you to
// recommend us" earns its place because it is the single number that moves when
// anything else is wrong; the rest name a specific part of the service, so a
// low score points at the thing to fix rather than at a mood.

export type FeedbackField = {
  key: string;
  label: string;
  /** Said under the question, where the wording alone could be read two ways. */
  hint?: string;
};

export const FEEDBACK_RATINGS: FeedbackField[] = [
  { key: "overall", label: "Overall, how happy are you with CA Parveen Sharma Classes?" },
  { key: "classes_quality", label: "The classes themselves — how well is the subject taught?" },
  { key: "material_quality", label: "The notes, question bank and papers — how useful are they?" },
  { key: "answer_accuracy", label: "When you ask a doubt, how correct is the answer you get?", hint: "On WhatsApp, Telegram, or the Ask-your-doubt box in a class." },
  { key: "answer_speed", label: "How quickly do your doubts get answered?" },
  { key: "paper_checking", label: "When your written paper is checked, how fair and useful is the marking?", hint: "Leave blank if you have not had a paper checked yet." },
  { key: "planner_useful", label: "How useful is the study planner?", hint: "Leave blank if you have not built one." },
  { key: "app_experience", label: "How well do the website and the mobile app work for you?" },
  { key: "would_recommend", label: "How likely are you to recommend us to another CA student?" },
];

export const FEEDBACK_TEXT: FeedbackField[] = [
  { key: "what_went_wrong", label: "Has anything gone wrong, or been frustrating?", hint: "Please be blunt. A specific complaint is worth more to us than a good score." },
  { key: "how_to_improve", label: "What is the one thing we should improve first?" },
];

/** 1 to 5, said in words rather than left as bare numbers. */
export const SCALE: { value: number; label: string }[] = [
  { value: 1, label: "Poor" },
  { value: 2, label: "Below average" },
  { value: 3, label: "Alright" },
  { value: 4, label: "Good" },
  { value: 5, label: "Excellent" },
];

export const ALL_RATING_KEYS = FEEDBACK_RATINGS.map((f) => f.key);
