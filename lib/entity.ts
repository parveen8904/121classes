// WHO THIS SITE IS, SAID ONCE, IN THE ONE FORM A MACHINE READS.
//
// A Knowledge Panel is not something Google is asked for. It appears when Google
// becomes confident that a scattering of mentions across the web all refer to
// ONE entity, and it needs three things to get there: a stable identifier, the
// same facts wherever it looks, and links out to profiles it can already
// recognise as the same person.
//
// Everything here exists to make that resolution possible:
//
//   · THE IDENTIFIERS NEVER CHANGE. #person, #org and #website are the anchors.
//     Every page that mentions him points at #person by @id rather than
//     describing him again. Two hundred and thirty articles each declaring their
//     own loose "CA Parveen Sharma" are two hundred and thirty entities to
//     Google; the same articles pointing at one @id are two hundred and thirty
//     signals about one man.
//
//   · NOTHING GOES IN THAT IS NOT TRUE AND CHECKABLE. Structured data is a claim
//     made to a machine, and an inflated one is worse than none: it is exactly
//     what Google's spam systems look for. The 36 years, the two subjects and
//     the Gurugram office are the approved facts, and each is stated elsewhere
//     on the site in the same words. Nothing here is aspirational.
//
//   · THE SPELLING IS PINNED. Search Console shows "Praveen" outranking
//     "Parveen" — 865 impressions against 376 — so both spellings are declared
//     as alternate names. That is how Google joins the two, and it is the proper
//     field for it rather than working the misspelling into prose.

export const SITE = "https://caparveensharma.com";
export const PERSON_ID = `${SITE}/#person`;
export const ORG_ID = `${SITE}/#org`;
export const WEBSITE_ID = `${SITE}/#website`;

/** Point at him from anywhere — an article's author, a course's teacher. */
export const personRef = { "@id": PERSON_ID } as const;
export const orgRef = { "@id": ORG_ID } as const;

/** The office students can actually come to. Must match the Google Business
 *  Profile character for character — a differing address is how Google decides
 *  two mentions are two different businesses. The REGISTERED address (Nirman
 *  Vihar) belongs on tax invoices only and must never appear here. */
export const OFFICE = {
  "@type": "PostalAddress",
  streetAddress: "W6/30, DLF Phase 3, Sector 24",
  addressLocality: "Gurugram",
  addressRegion: "Haryana",
  postalCode: "122010",
  addressCountry: "IN",
} as const;

export const PUBLIC_PHONE = "+91-9810012674";

/** What he teaches and what he is qualified in. Google reads knowsAbout as a
 *  claim of expertise, so every line here is backed by the qualifications and
 *  committee work below — not by what would be useful to rank for. */
export const KNOWS_ABOUT = [
  "Financial Reporting",
  "Indian Accounting Standards (Ind AS)",
  "Advanced Accounting",
  "Accounting Standards",
  "US GAAP",
  "Valuation",
  "Management Accounting",
  "Consolidated financial statements",
  "Business combinations",
  "Chartered Accountancy education",
];

/**
 * THE RECORD, AND WHY IT IS HERE.
 *
 * A Knowledge Panel is Google deciding it knows who someone is, and it decides
 * that from facts it can corroborate elsewhere: a university, a qualifying year,
 * an award, a professional body, a published book. Popularity is not evidence;
 * a verifiable record is. These come from his own professional profile.
 *
 * Each of these is checkable against ICAI records, the university, or the
 * publisher. Nothing that the source itself hedged — "reportedly", "published
 * biographies state" — has been promoted into structured data, because a claim
 * made to a machine should be one that survives being checked.
 */
export const CREDENTIALS = [
  {
    "@type": "EducationalOccupationalCredential",
    credentialCategory: "Professional qualification",
    name: "Chartered Accountant",
    recognizedBy: { "@type": "Organization", name: "The Institute of Chartered Accountants of India" },
    dateCreated: "1996",
  },
  {
    "@type": "EducationalOccupationalCredential",
    credentialCategory: "Certificate",
    name: "ICAI Certificate Course in Valuation",
    recognizedBy: { "@type": "Organization", name: "The Institute of Chartered Accountants of India" },
    dateCreated: "2010-01",
  },
  {
    "@type": "EducationalOccupationalCredential",
    credentialCategory: "Post-graduate specialisation",
    name: "Indian Accounting Standards and US GAAP",
    dateCreated: "2007-07",
  },
];

export const MEMBER_OF = [
  { "@type": "Organization", name: "The Institute of Chartered Accountants of India", alternateName: "ICAI" },
  { "@type": "Organization", name: "The Institute of Cost Accountants of India", alternateName: "ICWAI" },
  { "@type": "Organization", name: "The Institute of Company Secretaries of India", alternateName: "ICSI" },
];

/**
 * Every profile that is verifiably his.
 *
 * sameAs is the single strongest signal for entity resolution: it tells Google
 * that the YouTube channel, the Instagram account and the older site are the
 * same man as this one. Only URLs we can stand behind go in — a guessed profile
 * that turns out to be someone else's teaches Google the wrong thing about him.
 */
export function sameAsFrom(settings: Map<string, string | null>): string[] {
  const fromSettings = [
    "support_youtube", "support_instagram", "support_twitter", "support_facebook",
  ]
    .map((k) => settings.get(k))
    .filter((u): u is string => Boolean(u && u.startsWith("http")));

  // His own long-standing site and company — his before this portal existed,
  // and the strongest link there is between the two names.
  return [...new Set([...fromSettings, "https://aldine.edu.in"])];
}

/** The man. One definition, used by the layout and by the faculty page. */
export function personNode(p: { sameAs: string[]; image?: string | null }) {
  return {
    "@type": "Person",
    "@id": PERSON_ID,
    name: "CA Parveen Sharma",
    alternateName: ["CA Praveen Sharma", "Praveen Sharma", "Parveen Sharma"],
    honorificPrefix: "CA",
    jobTitle: "Chartered Accountant and educator",
    description:
      "CA Parveen Sharma is a Chartered Accountant and accounting educator who has taught Accountancy for over 36 years. He qualified in 1996 with a place in the merit list at both Intermediate and Final, scored 100% in Accountancy at the University of Delhi and won the Gold Medal at the 1990 Accounts Olympiad. He has served on ICAI's Board of Studies and its Accounting Standards committees, and teaches Financial Reporting for the CA Final and Advanced Accounting for CA Intermediate.",
    alumniOf: { "@type": "CollegeOrUniversity", name: "University of Delhi", sameAs: "https://www.du.ac.in" },
    award: [
      "Gold Medal, Accounts Olympiad (1990)",
      "100% marks in Accountancy, University of Delhi",
      "Merit list, CA Intermediate and CA Final",
    ],
    hasCredential: CREDENTIALS,
    memberOf: MEMBER_OF,
    hasOccupation: {
      "@type": "Occupation",
      name: "Chartered Accountant",
      occupationalCategory: "Accounting education",
    },
    // The page that is ABOUT him, rather than the site he happens to run. Google
    // wants one authoritative page per entity and this is it.
    url: `${SITE}/faculty`,
    mainEntityOfPage: `${SITE}/faculty`,
    ...(p.image ? { image: p.image } : {}),
    knowsAbout: KNOWS_ABOUT,
    knowsLanguage: ["en", "hi"],
    nationality: { "@type": "Country", name: "India" },
    worksFor: orgRef,
    workLocation: { "@type": "Place", address: OFFICE },
    sameAs: p.sameAs,
  };
}

/** The teaching business. */
export function orgNode(p: { sameAs: string[]; logo?: string }) {
  return {
    "@type": "EducationalOrganization",
    "@id": ORG_ID,
    name: "CA Parveen Sharma — Personalised Learning",
    alternateName: ["CA Parveen Sharma Classes", "Aldine CA"],
    url: SITE,
    logo: p.logo ?? `${SITE}/icon-512.png`,
    image: p.logo ?? `${SITE}/icon-512.png`,
    description:
      "Coaching for Financial Reporting (CA Final) and Advanced Accounting (CA Intermediate), taught by CA Parveen Sharma.",
    founder: personRef,
    employee: personRef,
    address: OFFICE,
    telephone: PUBLIC_PHONE,
    areaServed: { "@type": "Country", name: "India" },
    sameAs: p.sameAs,
  };
}

/** The site itself — this is what decides the site name Google prints under a
 *  result, instead of guessing it from the domain. */
export function websiteNode() {
  return {
    "@type": "WebSite",
    "@id": WEBSITE_ID,
    url: SITE,
    name: "CA Parveen Sharma",
    alternateName: "CA Praveen Sharma",
    inLanguage: "en-IN",
    publisher: orgRef,
  };
}
