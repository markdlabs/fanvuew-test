import { describe, expect, it } from "vitest";

import type { AppListing } from "@/lib/fanvue/types";

import { reviewListings } from "./rules";

/** A listing that passes every check, to start your tests from. */
const cleanListing: AppListing = {
  uuid: "00000000-0000-4000-8000-00000000c1ea",
  name: "Post Planner",
  tagline: "Plan and schedule your posts in one calendar",
  description: "A weekly content calendar with drag-and-drop scheduling and reminders.",
  logoUrl: "https://placehold.co/256x256/png?text=PP",
  appUrl: "https://postplanner.app",
  pricingType: "monthly",
  rating: { average: 4.5, count: 40 },
  developer: { name: "Quarterlight", handle: "quarterlight" },
  descriptionTitle: "Never miss a posting slot",
  descriptionBody:
    "Post Planner shows your upcoming week at a glance, suggests gaps, and reminds you before each slot.",
  highlights: ["Weekly calendar", "Drag-and-drop scheduling", "Reminders"],
  heroImageUrl: "https://placehold.co/1200x630/png?text=Post+Planner",
  previewImageUrls: [
    "https://placehold.co/800x500/png?text=Preview+1",
    "https://placehold.co/800x500/png?text=Preview+2",
  ],
  galleryImageUrls: ["https://placehold.co/1280x800/png?text=Calendar"],
  pricingPlans: [
    {
      uuid: "00000000-0000-4000-8000-00000000c1eb",
      name: "Pro",
      description: "Unlimited scheduled posts.",
      billingType: "recurring",
      interval: "monthly",
      price: 999,
      currencyCode: "USD",
      status: "active",
      highlights: ["Unlimited posts", "Email reminders"],
    },
  ],
  ratingDistribution: null,
};

/** Findings for one listing on its own. Pass several listings when a rule compares them. */
const findingsFor = (listing: AppListing) => reviewListings([listing])[0]!.issues;

describe("moderation rules", () => {
  it("returns no findings for a clean listing", () => {
    expect(findingsFor(cleanListing)).toEqual([]);
  });

  it("flags a listing with the same screenshot twice (2.3)", () => {
    const padded: AppListing = {
      ...cleanListing,
      previewImageUrls: [cleanListing.previewImageUrls[0]!, cleanListing.previewImageUrls[0]!],
    };

    expect(findingsFor(padded).map((issue) => issue.rule)).toEqual(["2.3"]);
  });

  it("warns, rather than blocks, on too few screenshots (2.3)", () => {
    const single = listingWith({ previewImageUrls: [cleanListing.previewImageUrls[0]!] });

    expect(findingsUnder("2.3", single).map((issue) => issue.severity)).toEqual(["warn"]);
  });

  // Your tests. `npm run test:watch` reruns them as you save.
  // `spec.test.ts` says which listings must be flagged. Your tests say why.
});

const listingWith = (patch: Partial<AppListing>): AppListing => ({ ...cleanListing, ...patch });
const rulesFor = (listing: AppListing) => [...new Set(findingsFor(listing).map((issue) => issue.rule))];
const findingsUnder = (rule: string, listing: AppListing) =>
  findingsFor(listing).filter((issue) => issue.rule === rule);
const plan = (patch: Partial<AppListing["pricingPlans"][number]>) => ({ ...cleanListing.pricingPlans[0]!, ...patch });

describe("2.1 production ready", () => {
  it.each([
    ["descriptionBody", { descriptionBody: "TODO: rewrite before launch." }, "TODO"],
    ["description", { description: "Lorem ipsum dolor sit amet." }, "Lorem"],
    ["tagline", { tagline: "Coming soon: smarter scheduling" }, "Coming soon"],
    ["descriptionTitle", { descriptionTitle: "TBD" }, "TBD"],
    ["name", { name: "Post Planner FIXME" }, "FIXME"],
    ["highlights", { highlights: ["Weekly calendar", "placeholder"] }, "placeholder"],
    ["description", { description: "Sample text goes here." }, "Sample text"],
  ])("flags a draft marker in %s", (_field, patch, marker) => {
    const findings = findingsUnder("2.1", listingWith(patch));

    expect(findings).toHaveLength(1);
    expect(findings[0]!.matched).toContain(marker);
  });

  it("flags empty listing highlights", () => {
    expect(rulesFor(listingWith({ highlights: [] }))).toEqual(["2.1"]);
  });

  // Assumption, not in the doc: the code-style markers (TODO, TBD, FIXME) are matched
  // in capitals only, so ordinary words such as a "todo list" app pass.
  it("does not flag the ordinary word 'todo'", () => {
    expect(rulesFor(listingWith({ description: "A shared todo list for you and your editor." }))).toEqual([]);
  });

  it("does not match a marker inside another word", () => {
    expect(rulesFor(listingWith({ description: "Ipsumtracker-free reporting, no placeholders needed." }))).toEqual([]);
  });
});

describe("6.2 valid, owned URL", () => {
  it.each([
    ["missing", null],
    ["empty", ""],
    ["not https", "http://postplanner.app"],
    ["no host", "/apps/postplanner"],
    ["an IPv4 host", "https://203.0.113.7/postplanner"],
    ["an IPv6 host", "https://[2001:db8::1]/postplanner"],
    ["fanvue.com", "https://fanvue.com/apps/postplanner"],
    ["a fanvue.com subdomain", "https://postplanner.fanvue.com"],
    ["parkingcrew.net", "https://postplanner.parkingcrew.net"],
    ["sedoparking.com", "https://postplanner.sedoparking.com"],
    ["afternic.com", "https://www.afternic.com/forsale/postplanner.io"],
    ["godaddysites.com", "https://postplanner.godaddysites.com"],
    ["wixsite.com", "https://postplanner.wixsite.com/home"],
  ])("flags an appUrl that is %s", (_reason, appUrl) => {
    const findings = findingsUnder("6.2", listingWith({ appUrl }));

    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((issue) => issue.field === "appUrl")).toBe(true);
  });

  it("reports each problem with the URL", () => {
    const codes = findingsUnder("6.2", listingWith({ appUrl: "http://linkpulse.parkingcrew.net" })).map(
      (issue) => issue.code,
    );

    expect(codes).toHaveLength(2);
  });

  // "Another domain with our name inside it is fine."
  it.each(["https://copilot-fanvue-tools.com", "https://notfanvue.com", "https://fanvue.com.postplanner.app"])(
    "accepts %s",
    (appUrl) => {
      expect(rulesFor(listingWith({ appUrl }))).toEqual([]);
    },
  );
});

describe("1.6 no promotion of other platforms", () => {
  it.each([
    "OnlyFans",
    "onlyfans",
    "ONLYFANS",
    "0nlyFans",
    "only.fans",
    "only-fans",
    "Only Fans",
    "Fansly",
    "Fans1y",
    "fans-ly",
    "Patreon",
    "LoyalFans",
    "ManyVids",
    "JustForFans",
    "Just.For.Fans",
  ])("flags %s and shows what matched", (mention) => {
    const findings = findingsUnder("1.6", listingWith({ tagline: `For creators moving over from ${mention}` }));

    expect(findings).toHaveLength(1);
    expect(findings[0]!.matched).toBe(mention);
  });

  it.each<[string, Partial<AppListing>]>([
    ["name", { name: "Patreon Bridge" }],
    ["description", { description: "Import your Patreon tiers." }],
    ["descriptionTitle", { descriptionTitle: "Leave Fansly behind" }],
    ["descriptionBody", { descriptionBody: "Works alongside ManyVids." }],
    ["highlights", { highlights: ["Weekly calendar", "OnlyFans import"] }],
  ])("checks the %s", (field, patch) => {
    const findings = findingsUnder("1.6", listingWith(patch));

    expect(findings).toHaveLength(1);
    expect(findings[0]!.field).toContain(field);
  });

  // "Ordinary English is not a mention."
  it.each([
    "Rewards for the only fans who tip",
    "the only fans you need to message",
    "Only fans who tip get a badge",
    "Not only fans but also collaborators",
  ])("does not flag the ordinary phrase %j", (tagline) => {
    expect(rulesFor(listingWith({ tagline }))).toEqual([]);
  });
});

describe("3.3 pricing accuracy", () => {
  it.each([
    ["below $3.99", 398],
    ["above $500.00", 50001],
  ])("flags a USD plan priced %s", (_reason, price) => {
    const findings = findingsUnder("3.3", listingWith({ pricingPlans: [plan({ price })] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]!.field).toBe("pricingPlans[0].price");
  });

  it.each([399, 50000])("accepts a USD plan at the edge of the range (%i)", (price) => {
    expect(rulesFor(listingWith({ pricingPlans: [plan({ price })] }))).toEqual([]);
  });

  it("flags a paid plan in another currency even when the number looks in range", () => {
    const findings = findingsUnder("3.3", listingWith({ pricingPlans: [plan({ currencyCode: "EUR", price: 1299 })] }));

    expect(findings).toHaveLength(1);
    expect(findings[0]!.message).toContain("EUR");
  });

  it("does not range-check a free plan, whatever its currency", () => {
    const free = plan({ billingType: "free", interval: null, price: 0, currencyCode: "EUR" });

    expect(rulesFor(listingWith({ pricingPlans: [free, plan({})] }))).toEqual([]);
  });

  it("checks a plan that is pending setup", () => {
    expect(rulesFor(listingWith({ pricingPlans: [plan({ status: "pending_setup", price: 62500 })] }))).toEqual(["3.3"]);
  });

  // Assumption, not in the doc: a withdrawn plan is not shown to a creator, so its price
  // is not checked and it does not count as the free plan the copy promises.
  it("does not range-check a withdrawn plan", () => {
    const withdrawn = plan({ status: "withdrawn", price: 65000 });

    expect(rulesFor(listingWith({ pricingPlans: [plan({}), withdrawn] }))).toEqual([]);
  });

  it.each(["free plan", "Free tier", "free forever", "free to start"])(
    "flags copy that advertises a %s with no free plan",
    (phrase) => {
      const findings = findingsUnder("3.3", listingWith({ descriptionBody: `Start on the ${phrase} today.` }));

      expect(findings).toHaveLength(1);
      expect(findings[0]!.matched).toBe(phrase);
    },
  );

  it("accepts free-plan copy when the listing has a free plan", () => {
    const free = plan({ billingType: "free", interval: null, price: 0 });

    expect(rulesFor(listingWith({ descriptionBody: "Free forever for one account.", pricingPlans: [free] }))).toEqual(
      [],
    );
  });

  it("flags free-plan copy when the only free plan is withdrawn", () => {
    const free = plan({ billingType: "free", interval: null, price: 0, status: "withdrawn" });

    expect(rulesFor(listingWith({ tagline: "Free tier included", pricingPlans: [plan({}), free] }))).toEqual(["3.3"]);
  });
});

describe("4.2 originality", () => {
  const original = listingWith({
    uuid: "00000000-0000-4000-8000-0000000000a1",
    name: "Creator Copilot",
    developer: { name: "Copilot Works", handle: "copilotworks" },
    description: "An inbox assistant that drafts replies, sorts fans by spend and flags the chats worth your time.",
    descriptionBody:
      "Creator Copilot turns your inbox into a workflow: it drafts replies in your voice, sorts fans by spend, and surfaces the conversations most likely to convert this week.",
  });
  const copy = listingWith({
    uuid: "00000000-0000-4000-8000-0000000000a2",
    name: "Copilot for Creators",
    developer: { name: "Brightpath Apps", handle: "brightpath" },
    description: "AN INBOX ASSISTANT that drafts replies; sorts fans by spend, and flags the chats worth your time!",
    descriptionBody:
      "Copilot for Creators turns your inbox into a workflow - it drafts replies in your voice, sorts fans by spend and surfaces the conversations most likely to convert this week.",
  });

  const rulesByName = (listings: AppListing[]) =>
    Object.fromEntries(
      reviewListings(listings).map(({ listing, issues }) => [listing.name, issues.map((issue) => issue.rule)]),
    );

  it("flags both listings when two developers submit the same copy, ignoring case, punctuation and the app name", () => {
    expect(rulesByName([original, copy, cleanListing])).toEqual({
      "Creator Copilot": ["4.2"],
      "Copilot for Creators": ["4.2"],
      "Post Planner": [],
    });
  });

  it("names the other listing in each finding", () => {
    const [first, second] = reviewListings([original, copy]);

    expect(first!.issues[0]!.relatedUuid).toBe(copy.uuid);
    expect(first!.issues[0]!.message).toContain("Copilot for Creators");
    expect(second!.issues[0]!.relatedUuid).toBe(original.uuid);
  });

  it("warns on near-identical copy and rejects word-for-word identical copy", () => {
    const identical = {
      ...copy,
      description: original.description,
      descriptionBody: original.descriptionBody.replace("Creator Copilot", "Copilot for Creators"),
    };
    const nearCopy = { ...copy, descriptionBody: copy.descriptionBody.replace("sorts fans", "ranks fans") };

    expect(reviewListings([original, identical]).map(({ issues }) => issues[0]!.severity)).toEqual([
      "reject",
      "reject",
    ]);
    expect(reviewListings([original, nearCopy]).map(({ issues }) => issues[0]!.severity)).toEqual(["warn", "warn"]);
  });

  it("does not compare listings from the same developer", () => {
    const sameDeveloper = { ...copy, developer: original.developer };

    expect(rulesByName([original, sameDeveloper])).toEqual({ "Creator Copilot": [], "Copilot for Creators": [] });
  });

  it("does not flag two unrelated descriptions", () => {
    const other = { ...cleanListing, uuid: copy.uuid, developer: copy.developer };

    expect(rulesByName([original, other])).toEqual({ "Creator Copilot": [], "Post Planner": [] });
  });
});
