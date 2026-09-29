import { afterEach, describe, expect, it } from "vitest";

import { PATCH as updateSessionLeadAlias } from "@/app/api/sessions/lead/route";
import { PATCH as updateSessionLead, POST as createSession } from "@/app/api/sessions/route";
import { prisma } from "@/lib/prisma";

const createdSessionIds = new Set<string>();

afterEach(async () => {
  for (const sessionId of createdSessionIds) {
    await prisma.user.deleteMany({ where: { id: sessionId } });
  }
  createdSessionIds.clear();
});

describe("sessions API", () => {
  it("persists_lead_contact_after_report_generation", async () => {
    const sessionId = await createSessionId();

    const response = await updateSessionLead(
      jsonRequest("PATCH", "/api/sessions", {
        sessionId,
        name: "  Plan Reader  ",
        email: "  READER@example.com  ",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      sessionId,
      name: "Plan Reader",
      email: "reader@example.com",
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionId } });
    expect(user.name).toBe("Plan Reader");
    expect(user.email).toBe("reader@example.com");
  });

  it("rejects_invalid_lead_email", async () => {
    const sessionId = await createSessionId();

    const response = await updateSessionLead(
      jsonRequest("PATCH", "/api/sessions", {
        sessionId,
        name: "Plan Reader",
        email: "not-an-email",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("bad_request");
    expect(body.details.map((detail: { path: string }) => detail.path)).toContain("email");
  });

  it("persists_lead_contact_through_semantic_lead_alias", async () => {
    const sessionId = await createSessionId();

    const response = await updateSessionLeadAlias(
      jsonRequest("PATCH", "/api/sessions/lead", {
        sessionId,
        name: "Plan Reader",
        email: "reader@example.com",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      sessionId,
      name: "Plan Reader",
      email: "reader@example.com",
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: sessionId } });
    expect(user.name).toBe("Plan Reader");
    expect(user.email).toBe("reader@example.com");
  });

  it("rejects_malformed_lead_session_id_before_database_lookup", async () => {
    const response = await updateSessionLeadAlias(
      jsonRequest("PATCH", "/api/sessions/lead", {
        sessionId: "missing-session",
        name: "Plan Reader",
        email: "reader@example.com",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("bad_request");
    expect(body.details.map((detail: { path: string }) => detail.path)).toContain("sessionId");
  });
});

async function createSessionId() {
  const response = await createSession(jsonRequest("POST", "/api/sessions", {}));
  const body = await response.json();
  createdSessionIds.add(body.sessionId);
  return body.sessionId as string;
}

function jsonRequest(method: string, path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
