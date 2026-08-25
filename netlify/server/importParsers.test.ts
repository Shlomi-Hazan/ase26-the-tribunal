import { describe, expect, it } from "vitest";
import {
  ImportValidationError,
  importFileLimits,
  parseChargeSheetImport,
  parsePersonalityImport,
  parseTribunalPackageImport
} from "./importParsers";

const encoder = new TextEncoder();

function bytes(text: string) {
  return encoder.encode(text);
}

function validChargeSheetText() {
  return [
    "DEFENDANT: Alex Rowan",
    "ACT: Entered a restricted laboratory after receiving a written warning.",
    "QUESTION: Did Alex knowingly violate the laboratory access rule?"
  ].join("\n");
}

function validPackageText() {
  return [
    "TRIBUNAL_PACKAGE_V1",
    "",
    "[CHARGE_SHEET]",
    validChargeSheetText(),
    "",
    "[PRO_1]",
    "PROFILE_NAME: Evidence-first advocate",
    "PERSONALITY: Precise and calm.",
    "",
    "[PRO_2]",
    "PROFILE_NAME: Narrative advocate",
    "PERSONALITY: Story-driven and persuasive.",
    "",
    "[CON_1]",
    "PROFILE_NAME: Procedure advocate",
    "PERSONALITY: Skeptical and careful.",
    "",
    "[CON_2]",
    "PROFILE_NAME: Practical advocate",
    "PERSONALITY: Plainspoken and pragmatic.",
    "",
    "[JUDGE_1]",
    "PROFILE_NAME: Methodical judge",
    "PERSONALITY: Methodical and concise.",
    "",
    "[JUDGE_2]",
    "PROFILE_NAME: Fairness judge",
    "PERSONALITY: Contextual and fairness-oriented.",
    "",
    "[JUDGE_3]",
    "PROFILE_NAME: Evidence judge",
    "PERSONALITY: Strict about evidence quality."
  ].join("\n");
}

describe("deterministic import parsers", () => {
  it("parses a supported Charge Sheet file into normalized fields", () => {
    const result = parseChargeSheetImport("charge.md", bytes(validChargeSheetText()));
    const txtResult = parseChargeSheetImport(
      "charge.txt",
      bytes(validChargeSheetText())
    );

    expect(result).toEqual({
      defendant: "Alex Rowan",
      act: "Entered a restricted laboratory after receiving a written warning.",
      exactQuestion: "Did Alex knowingly violate the laboratory access rule?"
    });
    expect(txtResult.defendant).toBe("Alex Rowan");
  });

  it("rejects missing, duplicate, unsupported, oversized, and path-like Charge Sheet input", () => {
    expect(() =>
      parseChargeSheetImport("charge.txt", bytes("DEFENDANT: Alex\nACT: One"))
    ).toThrow(ImportValidationError);
    expect(() =>
      parseChargeSheetImport(
        "charge.txt",
        bytes(
          [
            "DEFENDANT: Alex",
            "ACT: ",
            "QUESTION: Did Alex knowingly violate the rule?"
          ].join("\n")
        )
      )
    ).toThrow(/Act is required/);
    expect(() =>
      parseChargeSheetImport(
        "charge.txt",
        bytes(
          [
            "DEFENDANT: Alex",
            `ACT: ${"x".repeat(6001)}`,
            "QUESTION: Did Alex knowingly violate the rule?"
          ].join("\n")
        )
      )
    ).toThrow(/Act exceeds/);
    expect(() =>
      parseChargeSheetImport(
        "charge.txt",
        bytes(
          [
            `DEFENDANT: ${"x".repeat(201)}`,
            "ACT: One",
            "QUESTION: Did Alex knowingly violate the rule?"
          ].join("\n")
        )
      )
    ).toThrow(/Defendant exceeds/);
    expect(() =>
      parseChargeSheetImport(
        "charge.txt",
        bytes(
          [
            "DEFENDANT: Alex",
            "ACT: One",
            `QUESTION: ${"x".repeat(1001)}`
          ].join("\n")
        )
      )
    ).toThrow(/Exact Question exceeds/);

    expect(() =>
      parseChargeSheetImport(
        "charge.txt",
        bytes(`${validChargeSheetText()}\nQUESTION: Duplicate?`)
      )
    ).toThrow(/Duplicate field QUESTION/);

    expect(() =>
      parseChargeSheetImport(
        "charge.txt",
        bytes(`${validChargeSheetText()}\nMODEL: forbidden`)
      )
    ).toThrow(/Unsupported field MODEL/);

    expect(() =>
      parseChargeSheetImport("../charge.txt", bytes(validChargeSheetText()))
    ).toThrow(/Invalid filename/);
    expect(() =>
      parseChargeSheetImport("charge.pdf", bytes(validChargeSheetText()))
    ).toThrow(/Unsupported file type/);
    expect(() =>
      parseChargeSheetImport(
        "charge.md",
        new Uint8Array(importFileLimits.chargeSheetBytes + 1)
      )
    ).toThrow(/exceeds 64 KiB/);
    expect(() =>
      parseChargeSheetImport("charge.md", new Uint8Array([0xff]))
    ).toThrow(/Invalid UTF-8 text/);
  });

  it("parses and validates an individual personality file", () => {
    const result = parsePersonalityImport(
      "personality.txt",
      bytes("\nCalm, rigorous, and skeptical.\n")
    );
    const markdownResult = parsePersonalityImport(
      "personality.md",
      bytes("Contextual and direct.")
    );

    expect(result).toEqual({
      personality: "Calm, rigorous, and skeptical.",
      filename: "personality.txt"
    });
    expect(markdownResult.personality).toBe("Contextual and direct.");

    expect(() => parsePersonalityImport("empty.md", bytes("   \n"))).toThrow(
      /Personality text is required/
    );
    expect(() =>
      parsePersonalityImport("too-long.md", bytes("x".repeat(4001)))
    ).toThrow(/Personality exceeds/);
    expect(() =>
      parsePersonalityImport("personality.pdf", bytes("Careful."))
    ).toThrow(/Unsupported file type/);
    expect(() =>
      parsePersonalityImport(
        "personality.md",
        new Uint8Array(importFileLimits.personalityBytes + 1)
      )
    ).toThrow(/exceeds 16 KiB/);
    expect(() =>
      parsePersonalityImport("personality.md", new Uint8Array([0xff]))
    ).toThrow(/Invalid UTF-8 text/);
  });

  it("parses a complete Tribunal package with exactly seven participants", () => {
    const result = parseTribunalPackageImport(
      "tribunal-package.md",
      bytes(validPackageText())
    );

    expect(result.chargeSheet.defendant).toBe("Alex Rowan");
    expect(Object.keys(result.participants)).toHaveLength(7);
    expect(result.participants["advocate-pro-1"]).toMatchObject({
      profileName: "Evidence-first advocate",
      personality: "Precise and calm.",
      personalitySource: "tribunal_package",
      personalitySourceFilename: "tribunal-package.md"
    });
    expect(result.participants["judge-3"].profileName).toBe("Evidence judge");
    expect(result.importSource).toEqual({
      type: "TRIBUNAL_PACKAGE_FILE",
      filename: "tribunal-package.md"
    });
  });

  it("rejects incomplete or structurally unsupported Tribunal packages", () => {
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(validPackageText().replace("TRIBUNAL_PACKAGE_V1", ""))
      )
    ).toThrow(/must start with TRIBUNAL_PACKAGE_V1/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(`${validPackageText()}\nTRIBUNAL_PACKAGE_V1`)
      )
    ).toThrow(/Duplicate TRIBUNAL_PACKAGE_V1 header/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(
          validPackageText().replace(
            `[CHARGE_SHEET]\n${validChargeSheetText()}`,
            ""
          )
        )
      )
    ).toThrow(/Missing package section \[CHARGE_SHEET\]/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(validPackageText().replace("[JUDGE_3]", "[PRO_3]"))
      )
    ).toThrow(/Unknown package section \[PRO_3\]/);

    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(validPackageText().replace("[CON_2]", ""))
      )
    ).toThrow(/Missing package section \[CON_2\]/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(validPackageText().replace("[JUDGE_2]", ""))
      )
    ).toThrow(/Missing package section \[JUDGE_2\]/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(`${validPackageText()}\n[PRO_1]\nPERSONALITY: duplicate`)
      )
    ).toThrow(/Duplicate package section \[PRO_1\]/);

    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(validPackageText().replace("PERSONALITY: Precise", "MODEL: mock"))
      )
    ).toThrow(/Unsupported field MODEL/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(validPackageText().replace("PERSONALITY: Precise", "SIDE: PRO"))
      )
    ).toThrow(/Unsupported field SIDE/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(validPackageText().replace("PERSONALITY: Precise and calm.", ""))
      )
    ).toThrow(/PERSONALITY: is required/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(
          validPackageText().replace("PERSONALITY: Precise and calm.", "PERSONALITY: ")
        )
      )
    ).toThrow(/Personality is required/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(
          validPackageText().replace(
            "Precise and calm.",
            "x".repeat(4001)
          )
        )
      )
    ).toThrow(/Personality exceeds/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(
          validPackageText().replace(
            "Evidence-first advocate",
            "x".repeat(121)
          )
        )
      )
    ).toThrow(/Profile name exceeds/);
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        bytes(validPackageText().replace("DEFENDANT: Alex Rowan", "DEFENDANT: "))
      )
    ).toThrow(/Defendant is required/);
  });

  it("enforces package file size and text type limits", () => {
    expect(() =>
      parseTribunalPackageImport(
        "package.md",
        new Uint8Array(importFileLimits.tribunalPackageBytes + 1)
      )
    ).toThrow(/exceeds 192 KiB/);

    expect(() =>
      parseTribunalPackageImport("package.pdf", bytes(validPackageText()))
    ).toThrow(/Unsupported file type/);
    expect(() =>
      parseTribunalPackageImport("package.md", new Uint8Array([0xff]))
    ).toThrow(/Invalid UTF-8 text/);
  });
});
