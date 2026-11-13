import { describe, expect, it } from "vitest";
import { semPooler, urlDoPrismaCli } from "@/lib/db/url-direta";

const POOLER = "postgresql://dono:s3nha@ep-frio-lago-123456-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
const DIRETA = "postgresql://dono:s3nha@ep-frio-lago-123456.sa-east-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";

describe("URL do Prisma CLI (conexão direta do Neon)", () => {
  it("tira o -pooler. do host e mantém o resto", () => {
    expect(semPooler(POOLER)).toBe(DIRETA);
  });

  it("não mexe em URL que já é direta nem em banco local", () => {
    expect(semPooler(DIRETA)).toBe(DIRETA);
    expect(semPooler("postgresql://postgres:postgres@localhost:5432/opi")).toBe("postgresql://postgres:postgres@localhost:5432/opi");
    expect(semPooler("nao-e-url")).toBe("nao-e-url");
  });

  it("só mexe no host: senha, banco e parâmetros com '-pooler.' ficam como estão", () => {
    const url = "postgresql://u:se-pooler.nha@ep-x-pooler.neon.tech/banco-pooler.db?options=a-pooler.b";
    expect(semPooler(url)).toBe("postgresql://u:se-pooler.nha@ep-x.neon.tech/banco-pooler.db?options=a-pooler.b");
    expect(semPooler("postgresql://u:a@b@ep-x-pooler.neon.tech/db")).toBe("postgresql://u:a@b@ep-x.neon.tech/db");
  });

  it("prefere DIRECT_URL; sem ela usa DATABASE_URL; nos dois casos sem pooler", () => {
    expect(urlDoPrismaCli({ DIRECT_URL: DIRETA, DATABASE_URL: POOLER })).toBe(DIRETA);
    expect(urlDoPrismaCli({ DIRECT_URL: POOLER, DATABASE_URL: "postgresql://x@y/z" })).toBe(DIRETA);
    expect(urlDoPrismaCli({ DATABASE_URL: POOLER })).toBe(DIRETA);
    expect(urlDoPrismaCli({ DIRECT_URL: "  ", DATABASE_URL: POOLER })).toBe(DIRETA);
    expect(urlDoPrismaCli({})).toBeUndefined();
  });
});
