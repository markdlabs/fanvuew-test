import type { AppListing, PricingPlan } from "@/lib/fanvue/types";

/**
 * The revision of `docs/listing-requirements.md` these rules implement ("Revision 3,
 * October 2026"). Bump it together with the rules when revision 4 lands, so every
 * stored finding says which revision it was made under.
 */
export const RULE_REVISION = "3";

/**
 * `reject`: the listing cannot go live as it is. `fix`: the developer can correct
 * it without anyone's judgement. `warn`: a person should look.
 */
export type Severity = "reject" | "fix" | "warn";

/**
 * One moderation finding on a listing.
 *
 * - `code`: stable machine-readable id for the check (e.g. `"too_few_screenshots"`).
 * - `rule`: section number from `docs/listing-requirements.md` (e.g. `"2.3"`).
 * - `severity`: what should happen next. You choose it per rule, and we will ask why.
 * - `message`: what a moderator reads.
 * - `field`: optional path into the listing, e.g. `appUrl` or `pricingPlans[0].price`.
 * - `matched`: optional text in the listing that triggered the finding.
 * - `relatedUuid`: optional other listing in a 4.2 pair.
 *
 * The specs read only `rule`, `severity`, `code` and `message`. Add fields if a
 * finding needs to carry more, such as the text matched or the other listing
 * in a 4.2 pair.
 */
export type Issue = {
  code: string;
  rule: string;
  severity: Severity;
  message: string;
  field?: string;
  matched?: string;
  relatedUuid?: string;
};

/** One listing and everything the rules found on it. */
export type Review = {
  listing: AppListing;
  issues: Issue[];
};

/**
 * Severity per finding, in one place so the choices can be read and argued with.
 *
 * - `fix`: the developer edits one field and nobody needs to judge anything.
 * - 1.6: the plain name is copy to delete (`fix`); a disguised spelling means
 *   someone tried to get past the filter (`reject`).
 * - 6.2: a host the developer cannot own (Fanvue's, a parked or site-builder
 *   placeholder, a bare IP) means there is no owned product to list (`reject`).
 * - 2.3: too few screenshots is `warn`: a person looks before it blocks anything.
 * - 4.2: near-identical copy is `warn`, as "a person decides which one came first".
 *   Word-for-word identical copy (after ignoring case, punctuation and the app's
 *   name) is a template resubmission, so both are `reject`.
 */
const SEVERITY = {
  draft_copy: "fix",
  too_few_screenshots: "warn",
  empty_highlights: "fix",
  competitor_named: "fix",
  competitor_disguised: "reject",
  app_url_missing: "fix",
  app_url_not_https: "fix",
  app_url_no_host: "fix",
  app_url_ip_host: "reject",
  app_url_fanvue_domain: "reject",
  app_url_placeholder_host: "reject",
  price_out_of_range: "fix",
  price_unverifiable_currency: "fix",
  free_plan_missing: "fix",
  duplicate_listing: "warn",
  duplicate_listing_identical: "reject",
} as const satisfies Record<string, Severity>;

type Code = keyof typeof SEVERITY;

const finding = (code: Code, rule: string, message: string, extra: Partial<Issue> = {}): Issue => ({
  code,
  rule,
  severity: SEVERITY[code],
  message,
  ...extra,
});

/**
 * Reviews a set of listings and returns the findings for each, in the order
 * they came in.
 *
 * Takes the whole set because 4.2 compares listings to each other. You decide
 * how to organise the code inside.
 *
 * Pure: no I/O, and the same input always gives the same output.
 */
export function reviewListings(listings: AppListing[]): Review[] {
  const duplicates = findDuplicates(listings);
  return listings.map((listing, index) => ({
    listing,
    issues: [...checkListing(listing), ...(duplicates.get(index) ?? [])],
  }));
}

/** Every check that only needs the one listing in front of it. */
function checkListing(listing: AppListing): Issue[] {
  return [
    ...checkCompetitorMentions(listing),
    ...checkDraftCopy(listing),
    ...checkScreenshotCount(listing),
    ...checkPricing(listing),
    ...checkAppUrl(listing),
  ];
}

type CopyField = { field: string; text: string };

/**
 * "All copy a user can read before opening the app. That is the app name, tagline,
 * description, description title, description body and listing highlights." (1.6)
 * 2.1 and 3.3 read the same fields.
 */
function copyFields(listing: AppListing): CopyField[] {
  return [
    { field: "name", text: listing.name },
    { field: "tagline", text: listing.tagline },
    { field: "description", text: listing.description },
    { field: "descriptionTitle", text: listing.descriptionTitle },
    { field: "descriptionBody", text: listing.descriptionBody },
    ...listing.highlights.map((text, index) => ({ field: `highlights[${index}]`, text })),
  ];
}

const quoted = (texts: string[]) => texts.map((text) => `"${text}"`).join(", ");

// ---------------------------------------------------------------------------
// 1.6 No promotion of other platforms
// ---------------------------------------------------------------------------

/** "In this revision, the competing platforms are" these, split into their words. */
const COMPETITORS: { name: string; words: string[] }[] = [
  { name: "OnlyFans", words: ["Only", "Fans"] },
  { name: "Fansly", words: ["Fansly"] },
  { name: "Patreon", words: ["Patreon"] },
  { name: "LoyalFans", words: ["Loyal", "Fans"] },
  { name: "ManyVids", words: ["Many", "Vids"] },
  { name: "JustForFans", words: ["Just", "For", "Fans"] },
];

/** "Digits in place of letters (`0nlyFans`, `Fans1y`)". */
const LOOKALIKES: Record<string, string> = { o: "o0", l: "l1", i: "i1", e: "e3", a: "a4", s: "s5" };

/** "Separators between the words or inside a name (`only.fans`, `only-fans`, `fans-ly`)". */
const SEPARATOR = "[._\\-]";

function competitorPattern(words: string[]): RegExp {
  const letter = (char: string) => `[${LOOKALIKES[char.toLowerCase()] ?? char.toLowerCase()}]`;
  const word = (text: string) => [...text].map(letter).join(`${SEPARATOR}?`);
  // Between two words a space is allowed too; `isNameNotGrammar` decides whether it counts.
  const body = words.map(word).join(`(?:${SEPARATOR}|\\s+)?`);
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

const COMPETITOR_PATTERNS = COMPETITORS.map((competitor) => ({
  ...competitor,
  pattern: competitorPattern(competitor.words),
}));

/**
 * "Ordinary English is not a mention." A spelling split by spaces counts only when
 * every word is capitalised, as a name is (`Only Fans`). `the only fans who tip` and
 * `Only fans who tip` are grammar. "We would rather miss a disguised name than
 * reject a legitimate listing for its sentence structure."
 */
function isNameNotGrammar(matched: string): boolean {
  const parts = matched.split(/\s+/);
  return parts.length === 1 || parts.every((part) => /^[\p{Lu}\p{N}]/u.test(part));
}

function checkCompetitorMentions(listing: AppListing): Issue[] {
  const issues: Issue[] = [];
  for (const { field, text } of copyFields(listing)) {
    for (const { name, pattern } of COMPETITOR_PATTERNS) {
      for (const match of text.matchAll(pattern)) {
        const matched = match[0];
        if (!isNameNotGrammar(matched)) continue;
        // Anything but the exact spelling is disguised: digits, separators or "unusual casing".
        const disguised = matched !== name;
        issues.push(
          finding(
            disguised ? "competitor_disguised" : "competitor_named",
            "1.6",
            disguised
              ? `Names competing platform ${name}, disguised as "${matched}", in ${field}.`
              : `Names competing platform ${name} in ${field}.`,
            { field, matched },
          ),
        );
      }
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 2.1 Production ready
// ---------------------------------------------------------------------------

/**
 * "`lorem`, `ipsum`, `TODO`, `TBD`, `FIXME`, `coming soon`, `placeholder`, `sample text`."
 * The doc writes the code markers in capitals; matching them only in capitals keeps
 * ordinary words such as a "todo list" out (an assumption, not in the doc).
 */
const DRAFT_MARKERS = [/\b(?:TODO|TBD|FIXME)\b/g, /\b(?:lorem|ipsum|coming\s+soon|placeholder|sample\s+text)\b/gi];

function checkDraftCopy(listing: AppListing): Issue[] {
  const issues: Issue[] = copyFields(listing).flatMap(({ field, text }) => {
    const markers = DRAFT_MARKERS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));
    if (markers.length === 0) return [];
    return [
      finding("draft_copy", "2.1", `Draft or placeholder copy in ${field}: ${quoted(markers)}.`, {
        field,
        matched: markers.join(", "),
      }),
    ];
  });

  // "Empty listing highlights also break this rule."
  if (listing.highlights.every((highlight) => highlight.trim() === "")) {
    issues.push(finding("empty_highlights", "2.1", "The listing has no highlights.", { field: "highlights" }));
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 2.3 Listing quality
// ---------------------------------------------------------------------------

/** We've implemented this rule for you as an example. Rule 2.3: a listing needs at least two unique screenshots. */
function checkScreenshotCount(listing: AppListing): Issue[] {
  const distinct = new Set(listing.previewImageUrls).size;
  if (distinct >= 2) return [];

  return [
    finding(
      "too_few_screenshots",
      "2.3",
      distinct === listing.previewImageUrls.length
        ? `Only ${distinct} screenshot${distinct === 1 ? "" : "s"}; rule 2.3 needs two.`
        : `${listing.previewImageUrls.length} screenshots but only ${distinct} distinct; rule 2.3 needs two.`,
      { field: "previewImageUrls" },
    ),
  ];
}

// ---------------------------------------------------------------------------
// 3.3 Pricing accuracy
// ---------------------------------------------------------------------------

/** "A paid plan costs between $3.99 and $500.00", in US cents. */
const MIN_PRICE_USD_CENTS = 399;
const MAX_PRICE_USD_CENTS = 50_000;

/** "If the copy advertises a free plan (`free plan`, `free tier`, `free forever`, `free to start`)". */
const FREE_PLAN_CLAIM = /\bfree\s+(?:plans?|tiers?|forever|to\s+start)\b/gi;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const isFree = (plan: PricingPlan) => plan.billingType === "free";
/**
 * "Pricing shown to a creator." A withdrawn plan is "Taken down. Not purchasable", so it
 * is neither checked nor counted as the free plan (an assumption, not in the doc). A plan
 * pending setup "activates automatically", so it is checked.
 */
const isShown = (plan: PricingPlan) => plan.status !== "withdrawn";

function checkPricing(listing: AppListing): Issue[] {
  const issues: Issue[] = [];

  listing.pricingPlans.forEach((plan, index) => {
    if (!isShown(plan) || isFree(plan)) return;
    const where = `pricingPlans[${index}]`;

    // "Do not guess an exchange rate or treat the number as dollars."
    if (plan.currencyCode.toUpperCase() !== "USD") {
      issues.push(
        finding(
          "price_unverifiable_currency",
          "3.3",
          `Plan "${plan.name}" is priced in ${plan.currencyCode}; the supported range is in USD and cannot be checked.`,
          { field: `${where}.currencyCode`, matched: plan.currencyCode },
        ),
      );
      return;
    }

    if (plan.price < MIN_PRICE_USD_CENTS || plan.price > MAX_PRICE_USD_CENTS) {
      issues.push(
        finding(
          "price_out_of_range",
          "3.3",
          `Plan "${plan.name}" costs ${dollars(plan.price)}; paid plans must cost ${dollars(MIN_PRICE_USD_CENTS)} to ${dollars(MAX_PRICE_USD_CENTS)}.`,
          { field: `${where}.price`, matched: dollars(plan.price) },
        ),
      );
    }
  });

  const hasFreePlan = listing.pricingPlans.some((plan) => isShown(plan) && isFree(plan));
  if (!hasFreePlan) {
    const claims = copyFields(listing).flatMap(({ field, text }) =>
      [...text.matchAll(FREE_PLAN_CLAIM)].map((match) => ({ field, matched: match[0] })),
    );
    if (claims.length > 0) {
      issues.push(
        finding(
          "free_plan_missing",
          "3.3",
          `The copy advertises ${quoted(claims.map((claim) => claim.matched))} but the listing has no free plan.`,
          { field: claims[0]!.field, matched: claims.map((claim) => claim.matched).join(", ") },
        ),
      );
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// 6.2 Valid, owned URL
// ---------------------------------------------------------------------------

/** "The hosts we see are `parkingcrew.net`, `sedoparking.com`, `afternic.com`, `godaddysites.com`, `wixsite.com`". */
const PLACEHOLDER_HOSTS = ["parkingcrew.net", "sedoparking.com", "afternic.com", "godaddysites.com", "wixsite.com"];

/** The domain itself or a subdomain of it. "Another domain with our name inside it is fine." */
const isOnDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
const isIpAddress = (host: string) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.startsWith("[");

function checkAppUrl(listing: AppListing): Issue[] {
  const field = "appUrl";
  const raw = listing.appUrl?.trim();
  if (!raw) return [finding("app_url_missing", "6.2", "The listing has no appUrl.", { field })];

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [finding("app_url_no_host", "6.2", `appUrl "${raw}" has no host.`, { field, matched: raw })];
  }

  const issues: Issue[] = [];
  const extra = { field, matched: raw };
  if (url.protocol !== "https:") {
    issues.push(finding("app_url_not_https", "6.2", `appUrl "${raw}" is not https.`, extra));
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "") {
    issues.push(finding("app_url_no_host", "6.2", `appUrl "${raw}" has no host.`, extra));
  } else if (isIpAddress(host)) {
    issues.push(finding("app_url_ip_host", "6.2", `appUrl "${raw}" uses an IP address, not an owned domain.`, extra));
  } else if (isOnDomain(host, "fanvue.com")) {
    issues.push(
      finding("app_url_fanvue_domain", "6.2", `appUrl "${raw}" is on fanvue.com, not the developer's domain.`, extra),
    );
  } else {
    const placeholder = PLACEHOLDER_HOSTS.find((domain) => isOnDomain(host, domain));
    if (placeholder) {
      issues.push(
        finding(
          "app_url_placeholder_host",
          "6.2",
          `appUrl "${raw}" is on ${placeholder}, a parking or site-builder host.`,
          extra,
        ),
      );
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 4.2 Originality
// ---------------------------------------------------------------------------

/**
 * Two descriptions are the same listing when this share of their three-word phrases
 * overlaps (Jaccard). "How close two descriptions must be to count as the same listing
 * is a judgement call." See the PR / README notes for how this number was chosen.
 */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.5;
const SHINGLE_SIZE = 3;

const tokens = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** "Compare `description` and `descriptionBody` together, and ignore case, punctuation and the app's own name." */
function shingles(listing: AppListing): Set<string> {
  const words = tokens(`${listing.description} ${listing.descriptionBody}`);
  const name = tokens(listing.name);
  const kept: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    if (name.length > 0 && name.every((part, offset) => words[index + offset] === part)) {
      index += name.length - 1;
      continue;
    }
    kept.push(words[index]!);
  }
  const result = new Set<string>();
  for (let index = 0; index + SHINGLE_SIZE <= kept.length; index += 1) {
    result.add(kept.slice(index, index + SHINGLE_SIZE).join(" "));
  }
  return result;
}

/** Every pair of listings from different developers whose descriptions match, scored. */
export function duplicatePairs(listings: AppListing[]): { a: number; b: number; similarity: number }[] {
  const sets = listings.map(shingles);
  const handles = listings.map((listing) => listing.developer.handle?.trim().toLowerCase() || null);

  // Inverted index, so only listings that share at least one phrase are compared.
  const postings = new Map<string, number[]>();
  sets.forEach((set, index) => {
    for (const shingle of set) {
      const list = postings.get(shingle);
      if (list) list.push(index);
      else postings.set(shingle, [index]);
    }
  });

  const pairs: { a: number; b: number; similarity: number }[] = [];
  sets.forEach((set, a) => {
    const shared = new Map<number, number>();
    for (const shingle of set) {
      for (const b of postings.get(shingle)!) if (b > a) shared.set(b, (shared.get(b) ?? 0) + 1);
    }
    for (const [b, count] of shared) {
      // "Two listings with the same `developer.handle` never match each other under this rule."
      if (handles[a] !== null && handles[a] === handles[b]) continue;
      pairs.push({ a, b, similarity: count / (set.size + sets[b]!.size - count) });
    }
  });
  return pairs;
}

function findDuplicates(listings: AppListing[]): Map<number, Issue[]> {
  const byListing = new Map<number, Issue[]>();
  const flag = (self: number, other: number, similarity: number) => {
    const match = listings[other]!;
    const identical = similarity === 1;
    const issue = finding(
      identical ? "duplicate_listing_identical" : "duplicate_listing",
      "4.2",
      `Description matches "${match.name}" by ${match.developer.handle ?? "an unknown developer"} (${identical ? "identical copy" : `${Math.round(similarity * 100)}% of phrases shared`}). A person decides which came first.`,
      { field: "description", relatedUuid: match.uuid, matched: match.name },
    );
    byListing.set(self, [...(byListing.get(self) ?? []), issue]);
  };

  for (const { a, b, similarity } of duplicatePairs(listings)) {
    if (similarity < DUPLICATE_SIMILARITY_THRESHOLD) continue;
    flag(a, b, similarity);
    flag(b, a, similarity);
  }
  return byListing;
}
