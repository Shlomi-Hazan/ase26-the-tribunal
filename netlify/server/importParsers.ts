import {
  chargeSheetSchema,
  packageSeatToParticipantId,
  packageSeats,
  personalityLimit,
  profileNameLimit,
  tribunalSetupDraftSchema,
  type ChargeSheet,
  type PackageSeat,
  type ParticipantDraft,
  type TribunalSetupDraft
} from "../../src/schemas/tribunalSetup";

export const importFileLimits = {
  chargeSheetBytes: 64 * 1024,
  personalityBytes: 16 * 1024,
  tribunalPackageBytes: 192 * 1024
} as const;

const allowedTextExtensions = new Set([".txt", ".md"]);
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

type ParseFieldOptions = {
  allowedFields: readonly string[];
  requiredFields: readonly string[];
  sectionLabel: string;
};

export class ImportValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.length > 0 ? errors.join(" ") : "Import validation failed.");
    this.name = "ImportValidationError";
    this.errors = errors;
  }
}

export function importJsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: jsonHeaders,
    body: JSON.stringify(body)
  };
}

export function parseChargeSheetImport(
  filename: string,
  bytes: Uint8Array
): ChargeSheet {
  assertFile(filename, bytes, importFileLimits.chargeSheetBytes);
  const text = decodeUtf8(bytes);
  const fields = parseMarkerFields(text, {
    allowedFields: ["DEFENDANT", "ACT", "QUESTION"],
    requiredFields: ["DEFENDANT", "ACT", "QUESTION"],
    sectionLabel: "Charge Sheet"
  });

  return validateChargeSheetFields(fields);
}

export function parsePersonalityImport(
  filename: string,
  bytes: Uint8Array
) {
  const safeFilename = assertFile(filename, bytes, importFileLimits.personalityBytes);
  const personality = decodeUtf8(bytes).replace(/\r\n?/g, "\n").trim();
  const errors: string[] = [];

  if (!personality) {
    errors.push("Personality text is required.");
  }

  if (personality.length > personalityLimit) {
    errors.push(`Personality exceeds ${personalityLimit} characters.`);
  }

  if (errors.length > 0) {
    throw new ImportValidationError(errors);
  }

  return {
    personality,
    filename: safeFilename
  };
}

export function parseTribunalPackageImport(
  filename: string,
  bytes: Uint8Array
): TribunalSetupDraft {
  const safeFilename = assertFile(
    filename,
    bytes,
    importFileLimits.tribunalPackageBytes
  );
  const text = decodeUtf8(bytes).replace(/\r\n?/g, "\n");
  const sections = parsePackageSections(text);
  const chargeFields = parseMarkerFields(sections.CHARGE_SHEET, {
    allowedFields: ["DEFENDANT", "ACT", "QUESTION"],
    requiredFields: ["DEFENDANT", "ACT", "QUESTION"],
    sectionLabel: "[CHARGE_SHEET]"
  });
  const chargeSheet = validateChargeSheetFields(chargeFields);
  const participants = Object.fromEntries(
    packageSeats.map((seat) => {
      const participantId = packageSeatToParticipantId[seat];
      const participant = parseParticipantSection(
        sections[seat],
        seat,
        safeFilename
      );

      return [participantId, participant];
    })
  );

  const result = tribunalSetupDraftSchema.safeParse({
    chargeSheet,
    participants,
    importSource: {
      type: "TRIBUNAL_PACKAGE_FILE",
      filename: safeFilename
    }
  });

  if (!result.success) {
    throw new ImportValidationError(
      result.error.issues.map((issue) => issue.message)
    );
  }

  return result.data;
}

function assertFile(filename: string, bytes: Uint8Array, maxBytes: number) {
  const safeFilename = sanitizeFilename(filename);

  if (bytes.byteLength === 0) {
    throw new ImportValidationError(["Uploaded file is empty."]);
  }

  if (bytes.byteLength > maxBytes) {
    throw new ImportValidationError([
      `Uploaded file exceeds ${Math.floor(maxBytes / 1024)} KiB.`
    ]);
  }

  return safeFilename;
}

export function sanitizeFilename(filename: string) {
  const trimmed = filename.trim();
  const lower = trimmed.toLowerCase();

  if (
    !trimmed ||
    trimmed.length > 255 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    throw new ImportValidationError(["Invalid filename."]);
  }

  if (
    ![...allowedTextExtensions].some((extension) => lower.endsWith(extension))
  ) {
    throw new ImportValidationError([
      "Unsupported file type. Use a .txt or .md file."
    ]);
  }

  return trimmed;
}

function decodeUtf8(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ImportValidationError(["Invalid UTF-8 text."]);
  }
}

function parseMarkerFields(text: string, options: ParseFieldOptions) {
  const values = new Map<string, string[]>();
  const seen = new Set<string>();
  const allowed = new Set(options.allowedFields);
  let currentField = "";

  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    const marker = line.match(/^([A-Z][A-Z0-9_ ]*):(.*)$/u);

    if (marker) {
      const field = marker[1];

      if (!allowed.has(field)) {
        throw new ImportValidationError([
          `Unsupported field ${field}: in ${options.sectionLabel}.`
        ]);
      }

      if (seen.has(field)) {
        throw new ImportValidationError([
          `Duplicate field ${field}: in ${options.sectionLabel}.`
        ]);
      }

      seen.add(field);
      currentField = field;
      values.set(field, [marker[2].trimStart()]);
      continue;
    }

    if (line.match(/^\[[A-Z0-9_]+\]$/u)) {
      throw new ImportValidationError([
        `Unexpected section marker ${line} in ${options.sectionLabel}.`
      ]);
    }

    if (!currentField) {
      if (line.trim()) {
        throw new ImportValidationError([
          `Unexpected text before a known field in ${options.sectionLabel}.`
        ]);
      }
      continue;
    }

    values.get(currentField)?.push(line);
  }

  const fields: Record<string, string> = {};

  for (const field of options.allowedFields) {
    fields[field] = (values.get(field) ?? []).join("\n").trim();
  }

  for (const requiredField of options.requiredFields) {
    // Marker presence is a structural check only. Whether the value itself
    // is empty or exceeds a limit is field-specific content validation left
    // to the caller's schema, so the user sees the same field-named message
    // ("Defendant is required.") regardless of import path.
    if (!seen.has(requiredField)) {
      throw new ImportValidationError([
        `${requiredField}: is required in ${options.sectionLabel}.`
      ]);
    }
  }

  return fields;
}

function validateChargeSheetFields(fields: Record<string, string>) {
  const result = chargeSheetSchema.safeParse({
    defendant: fields.DEFENDANT,
    act: fields.ACT,
    exactQuestion: fields.QUESTION
  });

  if (!result.success) {
    throw new ImportValidationError(
      result.error.issues.map((issue) => issue.message)
    );
  }

  return result.data;
}

function parsePackageSections(text: string) {
  const lines = text.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim() !== "");

  if (firstContentIndex === -1) {
    throw new ImportValidationError(["Tribunal package is empty."]);
  }

  if (lines[firstContentIndex].trim() !== "TRIBUNAL_PACKAGE_V1") {
    throw new ImportValidationError([
      "Tribunal package must start with TRIBUNAL_PACKAGE_V1."
    ]);
  }

  if (
    lines.filter((line) => line.trim() === "TRIBUNAL_PACKAGE_V1").length !== 1
  ) {
    throw new ImportValidationError(["Duplicate TRIBUNAL_PACKAGE_V1 header."]);
  }

  const knownSections = new Set(["CHARGE_SHEET", ...packageSeats]);
  const requiredSections = new Set(["CHARGE_SHEET", ...packageSeats]);
  const sections: Partial<Record<"CHARGE_SHEET" | PackageSeat, string>> = {};
  const seenSections = new Set<string>();
  let currentSection: "CHARGE_SHEET" | PackageSeat | "" = "";
  let currentLines: string[] = [];

  function closeSection() {
    if (!currentSection) {
      return;
    }

    sections[currentSection] = currentLines.join("\n").trim();
    currentLines = [];
  }

  for (const line of lines.slice(firstContentIndex + 1)) {
    const section = line.trim().match(/^\[([A-Z0-9_]+)\]$/u);

    if (section) {
      const sectionName = section[1];

      if (!knownSections.has(sectionName)) {
        throw new ImportValidationError([
          `Unknown package section [${sectionName}].`
        ]);
      }

      if (seenSections.has(sectionName)) {
        throw new ImportValidationError([
          `Duplicate package section [${sectionName}].`
        ]);
      }

      closeSection();
      seenSections.add(sectionName);
      currentSection = sectionName as "CHARGE_SHEET" | PackageSeat;
      continue;
    }

    if (!currentSection) {
      if (line.trim()) {
        throw new ImportValidationError([
          "Unexpected package text before the first section."
        ]);
      }
      continue;
    }

    currentLines.push(line);
  }

  closeSection();

  const missing = [...requiredSections].filter(
    (section) => sections[section as "CHARGE_SHEET" | PackageSeat] === undefined
  );

  if (missing.length > 0) {
    throw new ImportValidationError(
      missing.map((section) => `Missing package section [${section}].`)
    );
  }

  return sections as Record<"CHARGE_SHEET" | PackageSeat, string>;
}

function parseParticipantSection(
  text: string,
  seat: PackageSeat,
  safeFilename: string
): ParticipantDraft {
  const fields = parseMarkerFields(text, {
    allowedFields: ["PROFILE_NAME", "PERSONALITY"],
    requiredFields: ["PERSONALITY"],
    sectionLabel: `[${seat}]`
  });
  const profileName = fields.PROFILE_NAME;
  const errors: string[] = [];

  if (profileName.length > profileNameLimit) {
    errors.push(`Profile name exceeds ${profileNameLimit} characters.`);
  }

  if (fields.PERSONALITY.length > personalityLimit) {
    errors.push(`Personality exceeds ${personalityLimit} characters.`);
  }

  if (errors.length > 0) {
    throw new ImportValidationError(errors);
  }

  return {
    profileName: profileName || undefined,
    personality: fields.PERSONALITY,
    personalitySource: "tribunal_package",
    personalitySourceFilename: safeFilename
  };
}
