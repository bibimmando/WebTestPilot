import { createServer, type Server } from "node:http";
import { afterEach, expect, test, vi } from "vitest";

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close(e => e ? reject(e) : resolve()));
  server = undefined;
  vi.unstubAllEnvs();
});

// Every run imports a fresh in-memory store; no existing server or reset endpoint is touched.
test.each(["off", "V1", "V2", "V3", "V4", "V5", "all", "off"])(
  "isolated API, registry, boundaries and normal controls: %s", async mode => {
    vi.resetModules();
    vi.stubEnv("BUGS_ON", mode === "all" ? "all" : "");
    vi.stubEnv("API_DELAY_MS", "0");
    for (const id of ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V9", "V11"]) {
      vi.stubEnv(`BUG_${id}`, mode === id ? "1" : "");
    }
    const { handleApi } = await import("../../server/api");
    const { allBugs, enabledIds } = await import("../../server/bugs");
    expect(new Set(allBugs.map(b => b.id)).size).toBe(allBugs.length);
    expect(allBugs.filter(b => b.area === "validation").map(b => b.id)).toEqual(["V1", "V2", "V3", "V4", "V5"]);
    expect(enabledIds()).toEqual(mode === "all" ? allBugs.map(b => b.id) : mode === "off" ? [] : [mode]);
    server = createServer((req, res) => {
      handleApi(req, res).then(handled => { if (!handled) res.end(); }).catch(() => { res.statusCode = 500; res.end(); });
    });
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    const base = `http://127.0.0.1:${address.port}`;
    const request = (path: string, body?: unknown, cookie?: string, method = "POST") => fetch(base + path, {
      method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const [length, password] of [[7, "Ab12!xy"], [8, "Ab12!xyz"], [9, "Ab12!xyzQ"]] as const) {
      const result = await request("/api/auth/signup", { name: "Pilot", email: `length${length}@example.test`, password });
      expect(result.status).toBe(length === 7 || (length === 8 && ["V5", "all"].includes(mode)) ? 400 : 201);
    }
    const signup = await request("/api/auth/signup", { name: "Pilot", email: "name@example.test", password: "Ab12!xyzQ" });
    expect(signup.status).toBe(201);
    const cookie = signup.headers.get("set-cookie")!.split(";")[0];
    const spaces = await request("/api/auth/me", { name: "   " }, cookie, "PATCH");
    expect(spaces.status).toBe(["V2", "all"].includes(mode) ? 200 : 400);
    const me = await request("/api/auth/me", undefined, cookie, "GET");
    expect((await me.json()).user.name).toBe(["V2", "all"].includes(mode) ? "" : "Pilot");
    expect((await request("/api/auth/me", { name: "" }, cookie, "PATCH")).status).toBe(400);
    const normal = await request("/api/auth/me", { name: " Normal Pilot " }, cookie, "PATCH");
    expect((await normal.json()).user.name).toBe("Normal Pilot");
    const forgot = await request("/api/auth/forgot", { email: "name@example.test" });
    const token = new URL((await forgot.json()).resetUrl, base).searchParams.get("token");
    expect((await request("/api/auth/reset", { token, password: "FirstPass!123" })).status).toBe(200);
    expect((await request("/api/auth/reset", { token, password: "OtherPass!456" })).status).toBe(400);
    expect((await request("/api/auth/login", { email: "name@example.test", password: "FirstPass!123" })).status).toBe(200);
    expect((await request("/api/auth/login", { email: "name@example.test", password: "OtherPass!456" })).status).toBe(401);
    const order = await request("/api/orders", { items: [{ productId: "arc-pendant", quantity: 1 }], customer: {
      firstName: "Pilot", lastName: "Tester", email: "pilot@example.test", address: "123 Test Street", city: "Seoul", postalCode: "04524", country: "South Korea",
    } });
    expect(order.status).toBe(201);
    const detail = await request(`/api/orders/${(await order.json()).orderId}`, undefined, undefined, "GET");
    expect((await detail.json()).customer.city).toBe("Seoul");
  }, 20000,
);
