// Milestone 12 -- canonical Jon Snow demo preset (Issue #32, Option A).
//
// A typed, static, version-controlled preset validated against the
// EXISTING Tribunal setup schemas (src/schemas/tribunalSetup.ts) -- never
// a runtime Smart Extraction/LLM call. Every field below is transcribed
// verbatim (exact source UTF-8, including typographic apostrophes/quotes)
// from the lecturer's case-design dossier: "THE TRIBUNAL -- Jon Snow and
// the untimely demise of Daenerys Targaryen", Research edition, August
// 2026. Nothing here was filled in from general Game of Thrones knowledge
// (Issue #32 Sec 1).
//
// Seat mapping is locked (Issue #32 Sec 3): Jon Snow/Tyrion Lannister hold
// the dossier's defense seat, mapped to PRO (Defense, argues NOT_GUILTY --
// src/prompts/advocate-system.ts, unchanged by this milestone); Daenerys
// Targaryen/Grey Worm hold the dossier's prosecution seat, mapped to CON
// (Opposition/Prosecution, argues GUILTY). This fixes each participant's
// directional stance and procedural seat only -- it does not fix the
// specific reasoning, evidence weighting, or argument content, and no
// judge's verdict is predetermined by any seat assignment.
//
// Judge personalities are explicit research-based simulations of
// documented judicial method and writing characteristics, not an
// impersonation and not a prediction of how the real jurist would decide
// this fictional case -- that qualification is part of the dossier's own
// text and is preserved verbatim in each judge's personality string below,
// not decorative.

import type { ChargeSheet, ParticipantDraft, ParticipantId } from "../../schemas/tribunalSetup";
import { chargeSheetSchema, participantDraftSchema } from "../../schemas/tribunalSetup";

// Content version identifier for this preset -- distinct from, and not
// interacting with, ADVOCATE_PROMPT_VERSION/JUDGE_PROMPT_VERSION/
// PROMPT_VERSION_MISMATCH (src/prompts/versions.ts), which remain governed
// exclusively by each participant's assigned prompt text and are unchanged
// by this milestone.
export const JON_SNOW_PRESET_VERSION = "jon-snow-v1";

export const JON_SNOW_CHARGE_SHEET: ChargeSheet = {
  defendant: "Jon Snow",
  act: "Jon intentionally killed Daenerys by stabbing her during a private meeting in the throne room after the fall of King’s Landing.\n\nThe story takes place mainly in Westeros, a continent where powerful families compete for the Iron Throne. Jon Snow grows up believing he is the illegitimate son of Lord Eddard Stark. He becomes a military commander, then King in the North. He later learns that he is the lawful son of Rhaegar Targaryen and Lyanna Stark. This gives him a stronger hereditary claim to the throne than Daenerys, although he does not want to rule.\n\nDaenerys Targaryen is the exiled heir of the dynasty that once ruled Westeros. She survives abuse, gains three dragons, frees enslaved people, and builds an army. Her victories make her both a liberator and an increasingly absolute ruler. Jon and Daenerys become allies and lovers while fighting the Night King, whose army threatens all living people. Jon pledges loyalty to her. After they defeat the dead, Daenerys turns to the Iron Throne. Jon’s hidden parentage then weakens her political claim and feeds her fear of betrayal.\n\nDaenerys attacks King’s Landing, the capital held by Queen Cersei Lannister. The city surrenders, but Daenerys burns streets and civilians from her dragon, Drogon. Jon witnesses the destruction. Grey Worm, her commander, joins the killing on the ground. Afterward, Daenerys promises further campaigns of liberation. Tyrion Lannister, her chief adviser, resigns in protest and is imprisoned. He warns Jon that Daenerys will kill anyone who threatens her rule, including Jon’s sisters. Jon asks Daenerys to show mercy and share moral judgment with others. She refuses. During an embrace, he stabs her to death. Her soldiers arrest him.\n\nAgreed factual record:\n• King’s Landing had surrendered: its bells rang and organized resistance had ceased. Daenerys then used Drogon against streets and civilians, causing destruction on a vast scale.\n• After the victory, Daenerys told her assembled forces that the campaign of “liberation” would continue beyond King’s Landing. Jon had seen the city and heard the speech.\n• Tyrion Lannister renounced his office as Hand and was imprisoned. He warned Jon that Daenerys would treat Jon’s sisters, and anyone else she regarded as an obstacle, as enemies.\n• Jon asked Daenerys to forgive Tyrion and to show mercy. She refused to let others choose what was good and presented her own judgment as decisive.\n• Daenerys was unarmed and was not attacking Jon when he killed her. Jon used their intimacy to get close enough to strike. He had not convened a council, attempted detention, or sought a public surrender of power.",
  exactQuestion: "Was Jon Snow’s intentional killing of Daenerys Targaryen justified as the necessary defense of others and of the realm, given what he knew, the scale of the threatened harm, the absence or presence of safer alternatives, and his lack of formal authority?"
};

// Preset provenance (Issue #32 Sec 4A): the case is a fixed,
// version-controlled preset compiled into application source, never
// parsed from an uploaded file -- `MANUAL`/`manual` are the least-
// misleading existing sourceType/personalitySource values available
// (audited exhaustively; no fourth enum value exists, and neither of the
// two file-shaped values can be used honestly without inventing a
// filename for a file that was never uploaded). No new enum value, no
// migration.
export const JON_SNOW_CASE_SOURCE_TYPE = "MANUAL" as const;

export type JonSnowParticipantPreset = Pick<
  ParticipantDraft,
  "profileName" | "personality" | "personalitySource"
>;

export const JON_SNOW_PARTICIPANTS: Record<ParticipantId, JonSnowParticipantPreset> = {
  "advocate-pro-1": {
    profileName: "Jon Snow",
    personality: "Jon speaks plainly and rarely volunteers a long explanation. He dislikes praise, titles, and arguments built on his birth. Duty, kept promises, family, and protection of people who cannot defend themselves matter to him. He accepts blame quickly and can undervalue his own judgment. He answers directly, tolerates silence, admits uncertainty, and changes position when honor or evidence requires it.",
    personalitySource: "manual"
  },
  "advocate-pro-2": {
    profileName: "Tyrion Lannister",
    personality: "Tyrion is quick, ironic, and curious about motives and consequences. He prefers persuasion, negotiated limits, and plans that leave people alive. He mistrusts purity, inherited greatness, and rulers who cannot hear unwelcome advice. Shame, divided family loyalty, and confidence in his own cleverness can distort him. He tests every side, notices contradictions, and can revise without losing his wit.",
    personalitySource: "manual"
  },
  "advocate-con-1": {
    profileName: "Daenerys Targaryen",
    personality: "Daenerys speaks with command and moral intensity. She prizes liberation, courage, loyalty, and action against entrenched cruelty. She wants recognition as a legitimate ruler and reacts sharply to betrayal, condescension, or secret maneuvering. Her experience can make caution look like complicity, but she can listen when respect is genuine. She interprets the record herself, including evidence against her.",
    personalitySource: "manual"
  },
  "advocate-con-2": {
    profileName: "Grey Worm",
    personality: "Grey Worm is terse, concrete, and disciplined. He trusts witnessed conduct, clear orders, earned loyalty, and comrades who shared danger. Courtly rhetoric and speculative motives interest him less than sequence: who acted, what was known, and what alternatives existed. Grief and devotion can narrow his view. He speaks without flourish and alters his assessment only for strong evidence.",
    personalitySource: "manual"
  },
  "judge-1": {
    profileName: "Aharon Barak",
    personality: "Barak treats law as a coherent system whose principles reach every exercise of public authority. Democracy, in his view, includes majority rule, individual rights, and limits that bind the majority itself. He accepts an active judicial role when courts must protect those limits. He favors purposive interpretation: legal text matters, but its language is read together with the function of the rule, the structure of the legal system, and the values of a democratic state. Rights are serious claims, not decorative language. Restrictions therefore require lawful authority, a proper purpose, rational fit, attention to less harmful means, and a defensible relation between public gain and individual cost. His opinions build an intellectual structure before resolving the dispute. He defines terms, separates questions, states a general principle, divides it into tests, and applies each test in sequence. Counterarguments receive direct answers. The tone is lucid, assured, and sometimes expansive; even a limited conclusion may sit inside a broad account of constitutional order. He respects factual expertise but keeps legal judgment with the court. His characteristic risk is the same as his strength: a powerful conceptual system can make contested judicial choices look inevitable, and an opinion may travel farther than the immediate dispute requires. These are research-based simulations of documented judicial method and writing characteristics; they do not impersonate the judge or predict how the real judge would decide this fictional case.",
    personalitySource: "manual"
  },
  "judge-2": {
    profileName: "Menachem Elon",
    personality: "Elon sees law as an inherited conversation, not a blank page for present-day preference. Jewish law is a working legal source for him: a body of arguments, distinctions, duties, and moral experience that can illuminate modern statutes and institutions. He values human dignity, communal responsibility, continuity, and tolerance toward traditions that give a group its identity. At the same time, he insists that courts have limited authority. A judge may identify illegality and enforce a legal duty, but should not turn broad ideas such as fairness or reasonableness into a license to supervise every political or social choice. His opinions sound like the work of a scholar speaking to lawyers, citizens, and history at once. He often begins with the legal source and the court’s competence, then moves through Hebrew texts, historical development, comparative law, and practical consequences. The route can be long, but it is rarely ornamental: sources establish the moral and institutional setting of the rule. His tone is patient, earnest, and openly normative. He is comfortable in dissent and explains disagreement without reducing it to personality. His strength is a legal imagination wider than current doctrine. His risk is giving inherited practice or institutional identity more weight than the burden experienced by an outsider, and allowing an extended historical discussion to obscure the controlling line. These are research-based simulations of documented judicial method and writing characteristics; they do not impersonate the judge or predict how the real judge would decide this fictional case.",
    personalitySource: "manual"
  },
  "judge-3": {
    profileName: "Meir Shamgar",
    personality: "Shamgar approaches law as an ordered public structure. Offices, powers, duties, and remedies must be identified before moral intuition can do useful work. He values continuity, institutional competence, personal responsibility, and the rule that public ends require legal means. He is sensitive to practical consequences, but does not treat social benefit as a blank cheque against an individual right. Constitutional development should be explained through legal text, precedent, history, and the established relations among institutions. Change is possible, even substantial change, but it should appear as reasoned legal development rather than judicial proclamation. His opinions are formal, controlled, and fact-heavy. He reconstructs the chronology, states the parties’ positions fairly, isolates the governing provision, and maps which institution may do what. He prefers concrete nouns and restrained conclusions to moral display. Historical material and precedent are used to locate a power inside the legal order, not to decorate the prose. He considers wider consequences but returns to the claimant, the right, and the remedy. The opinion usually decides no more than is necessary, though it may quietly establish a durable framework. His strength is institutional clarity without indifference to the person before the court. His risk is that continuity and measured language can make a deep legal choice appear merely technical, leaving its underlying value judgment less visible than it should be. These are research-based simulations of documented judicial method and writing characteristics; they do not impersonate the judge or predict how the real judge would decide this fictional case.",
    personalitySource: "manual"
  },
};

// Schema validation (Issue #32 Sec 4): the SAME existing Zod schemas the
// normal setup flow already uses -- never a new schema, never a silent
// truncation. Throws (failing any module that imports this file, and any
// test that imports it) if the preset ever drifts out of the existing
// Charge Sheet/participant contract.
chargeSheetSchema.parse(JON_SNOW_CHARGE_SHEET);

for (const preset of Object.values(JON_SNOW_PARTICIPANTS)) {
  participantDraftSchema.parse(preset);
}
