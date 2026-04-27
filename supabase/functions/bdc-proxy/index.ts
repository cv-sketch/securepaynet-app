// Edge Function: bdc-proxy
// Proxy a la API de Banco de Comercio (BDC Conecta).
// Modo mock: genera respuestas con la forma del contrato real usando secuencias internas.
// Modo live: hace fetch real a la API de BDC con auth (Bearer + HMAC).
// Loggea cada request/response en bdc_logs para auditoria de homologacion.
// Si el endpoint es sub-account.create y se provee cliente_id, persiste la wallet automaticamente.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BDC_MODE = (Deno.env.get("BDC_MODE") ?? "mock").toLowerCase();
const BDC_API_URL = Deno.env.get("BDC_API_URL") ?? "";
const BDC_TOKEN = Deno.env.get("BDC_TOKEN") ?? "";
const BDC_HMAC_SECRET = Deno.env.get("BDC_HMAC_SECRET") ?? "";
const BDC_CBU_RECAUDADORA = Deno.env.get("BDC_CBU_RECAUDADORA") ?? "4320001010003138730019";
const BDC_ENTITY_CODE = Deno.env.get("BDC_ENTITY_CODE") ?? "00432";
const BDC_CVU_PREFIX = Deno.env.get("BDC_CVU_PREFIX") ?? "0000115701";

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

type Endpoint =
  | "sub-account.create"
  | "sub-account.list"
  | "sub-account.update-label"
  | "transfer.create"
  | "transfer.list";

interface ProxyRequest {
  endpoint: Endpoint;
  payload: Record<string, unknown>;
  cliente_id?: string | null;
}

async function bdcNextval(seq: string): Promise<number> {
  const { data, error } = await admin.rpc("bdc_nextval", { seq_name: seq });
  if (error) throw new Error(`bdc_nextval(${seq}) failed: ${error.message}`);
  return Number(data);
}

async function logCall(entry: {
  endpoint: string;
  mode: string;
  method: string;
  request_body: unknown;
  response_status: number;
  response_body: unknown;
  cliente_id?: string | null;
  error_message?: string | null;
}) {
  try {
    await admin.from("bdc_logs").insert({
      endpoint: entry.endpoint,
      mode: entry.mode,
      method: entry.method,
      request_body: entry.request_body ?? null,
      response_status: entry.response_status,
      response_body: entry.response_body ?? null,
      cliente_id: entry.cliente_id ?? null,
      error_message: entry.error_message ?? null,
    });
  } catch (_e) { /* never break the response on log failure */ }
}

function pad(n: string | number, len: number): string {
  return String(n).padStart(len, "0");
}

async function mockCreateSubAccount(payload: any) {
  const cvuTail = pad(await bdcNextval("bdc_mock_cvu_seq"), 12);
  const accTail = pad(await bdcNextval("bdc_mock_account_seq"), 11);
  const cvu = (BDC_CVU_PREFIX + cvuTail).slice(0, 22);
  const accountId = `ARG-${BDC_ENTITY_CODE}-${accTail}`;
  return {
    status: "OK",
    data: {
      accountId,
      originId: payload.originId ?? null,
      label: payload.label ?? null,
      currency: payload.currency ?? "032",
      status: "ACTIVE",
      entityCode: BDC_ENTITY_CODE,
      entityName: "Banco de Comercio S.A.",
      owner: payload.owner ?? null,
      cbu: payload.cbu ?? BDC_CBU_RECAUDADORA,
      accountRouting: [{ type: "CVU", address: cvu }],
      createdAt: new Date().toISOString(),
    },
  };
}

function mockUpdateLabel(payload: any) {
  return {
    status: "OK",
    data: {
      accountId: payload.accountId,
      label: payload.label,
      updatedAt: new Date().toISOString(),
    },
  };
}

function mockCreateTransfer(payload: any) {
  return {
    status: "OK",
    data: {
      transferId: crypto.randomUUID(),
      originAccountId: payload.originAccountId,
      destination: payload.destination,
      amount: payload.amount,
      currency: payload.currency ?? "032",
      status: "PROCESSED",
      processedAt: new Date().toISOString(),
    },
  };
}

function mockListSubAccounts(_p: any) {
  return { status: "OK", data: { items: [], total: 0 } };
}

function mockListTransfers(_p: any) {
  return { status: "OK", data: { items: [], total: 0 } };
}

async function liveCall(path: string, method: string, body: unknown) {
  if (!BDC_API_URL || !BDC_TOKEN) {
    throw new Error("BDC_MODE=live pero faltan BDC_API_URL o BDC_TOKEN");
  }
  const bodyStr = body ? JSON.stringify(body) : "";
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(BDC_HMAC_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(bodyStr));
  const signature = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const res = await fetch(`${BDC_API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${BDC_TOKEN}`,
      "X-SIGNATURE": signature,
    },
    body: bodyStr || undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

async function dispatch(endpoint: Endpoint, payload: any) {
  if (BDC_MODE === "mock") {
    switch (endpoint) {
      case "sub-account.create":
        return { status: 200, body: await mockCreateSubAccount(payload) };
      case "sub-account.update-label":
        return { status: 200, body: mockUpdateLabel(payload) };
      case "sub-account.list":
        return { status: 200, body: mockListSubAccounts(payload) };
      case "transfer.create":
        return { status: 200, body: mockCreateTransfer(payload) };
      case "transfer.list":
        return { status: 200, body: mockListTransfers(payload) };
      default:
        return { status: 400, body: { status: "ERROR", error: { code: "UNKNOWN_ENDPOINT", message: endpoint } } };
    }
  }
  const map: Record<Endpoint, { path: string; method: string }> = {
    "sub-account.create": { path: "/sub-account", method: "POST" },
    "sub-account.list": { path: "/sub-account", method: "GET" },
    "sub-account.update-label": { path: "/sub-account/label", method: "PATCH" },
    "transfer.create": { path: "/transfer", method: "POST" },
    "transfer.list": { path: "/transfer", method: "GET" },
  };
  const route = map[endpoint];
  if (!route) {
    return { status: 400, body: { status: "ERROR", error: { code: "UNKNOWN_ENDPOINT", message: endpoint } } };
  }
  return await liveCall(route.path, route.method, payload);
}

// Persiste la wallet en public.wallets cuando bdc-proxy genera una sub-cuenta para un cliente_id conocido.
// Idempotente: si ya existe wallet para ese cliente_id, no inserta otra.
async function persistWalletForClient(
  clienteId: string,
  bdcResponseData: any,
  payload: any,
): Promise<{ inserted: boolean; wallet_id?: string; reason?: string }> {
  const { data: cliente, error: cErr } = await admin
    .from("clientes")
    .select("id, nombre, apellido, cuit")
    .eq("id", clienteId)
    .maybeSingle();
  if (cErr) return { inserted: false, reason: `cliente lookup failed: ${cErr.message}` };
  if (!cliente) return { inserted: false, reason: "cliente not found" };

  const { data: existing } = await admin
    .from("wallets")
    .select("id")
    .eq("cliente_id", clienteId)
    .maybeSingle();
  if (existing?.id) return { inserted: false, wallet_id: existing.id, reason: "wallet already exists" };

  const cvu: string | undefined = bdcResponseData?.accountRouting?.find((r: any) => r.type === "CVU")?.address;
  const accountId: string | undefined = bdcResponseData?.accountId;
  const alias: string | undefined = bdcResponseData?.label ?? payload?.label ?? undefined;
  const titular = [cliente.nombre, cliente.apellido].filter(Boolean).join(" ").trim() || null;

  if (!cvu || !accountId) {
    return { inserted: false, reason: "missing cvu or accountId in BDC response" };
  }

  const { data: ins, error: iErr } = await admin
    .from("wallets")
    .insert({
      cliente_id: clienteId,
      cvu,
      alias,
      saldo: 0,
      moneda: "ARS",
      cuit: cliente.cuit,
      titular,
      estado: "activa",
      tipo: "cvu",
      banco: "Banco de Comercio",
      bank_origin_id: payload?.originId ?? null,
      bank_subaccount_id: accountId,
      bank_response: bdcResponseData,
    })
    .select("id")
    .single();
  if (iErr) return { inserted: false, reason: `wallet insert failed: ${iErr.message}` };
  return { inserted: true, wallet_id: ins.id };
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  }
  let body: ProxyRequest;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: cors });
  }
  const { endpoint, payload, cliente_id } = body;
  if (!endpoint || !payload) {
    return new Response(JSON.stringify({ error: "Missing endpoint or payload" }), { status: 400, headers: cors });
  }
  try {
    const result = await dispatch(endpoint, payload);
    let walletPersist: any = undefined;
    if (
      endpoint === "sub-account.create" &&
      cliente_id &&
      result.status >= 200 &&
      result.status < 300 &&
      (result.body as any)?.data
    ) {
      walletPersist = await persistWalletForClient(cliente_id, (result.body as any).data, payload);
    }
    await logCall({
      endpoint,
      mode: BDC_MODE,
      method: "POST",
      request_body: payload,
      response_status: result.status,
      response_body: walletPersist ? { ...(result.body as any), _wallet: walletPersist } : result.body,
      cliente_id: cliente_id ?? null,
    });
    return new Response(
      JSON.stringify(walletPersist ? { ...(result.body as any), _wallet: walletPersist } : result.body),
      { status: result.status, headers: { ...cors, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await logCall({
      endpoint,
      mode: BDC_MODE,
      method: "POST",
      request_body: payload,
      response_status: 500,
      response_body: null,
      cliente_id: cliente_id ?? null,
      error_message: msg,
    });
    return new Response(
      JSON.stringify({ status: "ERROR", error: { code: "PROXY_FAILURE", message: msg } }),
      { status: 500, headers: { ...cors, "Content-Type": "application/json" } },
    );
  }
});
