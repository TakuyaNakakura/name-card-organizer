import { describe, expect, it } from "vitest";
import { contactFieldErrors, readContactFields } from "@/lib/contact-fields";
describe("team contact validation", () => {
  it("preserves incomplete email input in private drafts, not confirmed contacts", () => {
    const fields = {
      fullName: "山田",
      organization: "",
      jobTitle: "",
      email: "incomplete@",
    };
    expect(contactFieldErrors(fields, false)).toEqual({});
    expect(contactFieldErrors(fields).email).toBeTruthy();
  });
  it("ignores non-contact properties on durable draft objects", () => {
    expect(
      contactFieldErrors({
        fullName: "山田",
        organization: "",
        jobTitle: "",
        email: "",
        errorMessage: null,
        warnings: [],
        version: 1,
      } as Parameters<typeof contactFieldErrors>[0]),
    ).toEqual({});
  });
  it("allows a missing email when a name or organization exists", () => {
    expect(
      contactFieldErrors({
        fullName: "山田 花子",
        organization: "",
        jobTitle: "",
        email: "",
      }),
    ).toEqual({});
  });
  it("requires at least one identifying field", () => {
    expect(
      contactFieldErrors({
        fullName: "",
        organization: "",
        jobTitle: "担当",
        email: "",
      }).fullName,
    ).toBeTruthy();
  });
  it("validates optional email and string bounds", () => {
    expect(
      contactFieldErrors({
        fullName: "x",
        organization: "",
        jobTitle: "",
        email: "bad",
      }).email,
    ).toBeTruthy();
    expect(readContactFields({ fullName: 42 })).toBeNull();
  });
});
