import { afterEach, describe, expect, it, vi } from "vitest";
import { getLetterImage } from "./letters";

function imageResponse(type: string, body = "x") {
  return new Response(body, { status: 200, headers: { "Content-Type": type } });
}

afterEach(() => vi.unstubAllGlobals());

describe("getLetterImage", () => {
  it("returns a PNG logo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(imageResponse("image/png")));

    const blob = await getLetterImage("logo");

    expect(blob.size).toBe(1);
  });

  it("returns a JPEG logo, which used to be refused as 'not a PDF'", async () => {
    // The server answers in the type the picture was uploaded in, so the PNG request is refused and the JPEG one succeeds.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(imageResponse("image/jpeg"))
      .mockResolvedValueOnce(imageResponse("image/jpeg"));
    vi.stubGlobal("fetch", fetchMock);

    const blob = await getLetterImage("logo");

    expect(blob.size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/letters/images/logo");
  });

  it("fails when there is no picture", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ title: "No picture has been uploaded." }), { status: 404, headers: { "Content-Type": "application/problem+json" } }))),
    );

    await expect(getLetterImage("seal")).rejects.toThrow("No picture has been uploaded.");
  });
});
