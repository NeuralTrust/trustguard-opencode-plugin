import { test } from "node:test"
import assert from "node:assert/strict"
import { loadConfig } from "../src/config.ts"

const files = (map: Record<string, object>) => (p: string) => map[p] as any

test("defaults match the other TrustGuard hooks", () => {
  const cfg = loadConfig({ env: { TRUSTGUARD_OPENCODE_CONFIG: "/u", TRUSTGUARD_OPENCODE_SYSTEM_CONFIG: "/s" }, readFile: () => undefined })
  assert.equal(cfg.dataURL, "http://localhost:8081")
  assert.equal(cfg.apiKey, "")
  assert.equal(cfg.failMode, "open")
  assert.equal(cfg.transformAction, "ask")
  assert.equal(cfg.timeoutMs, 5000)
  assert.equal(cfg.maxContentBytes, 256 * 1024)
  assert.equal(cfg.managed, false)
})

test("env overrides user file and plugin options", () => {
  const cfg = loadConfig({
    env: {
      TRUSTGUARD_OPENCODE_CONFIG: "/u",
      TRUSTGUARD_OPENCODE_SYSTEM_CONFIG: "/s",
      TRUSTGUARD_API_KEY: "tgk_env",
      TRUSTGUARD_FAIL_MODE: "closed",
      TRUSTGUARD_TIMEOUT_MS: "1500",
      TRUSTGUARD_TRANSFORM_ACTION: "deny",
    },
    options: { apiKey: "tgk_opt", data_url: "https://opt.example/" },
    readFile: files({ "/u": { api_key: "tgk_user", data_url: "https://user.example" } }),
  })
  assert.equal(cfg.apiKey, "tgk_env")
  assert.equal(cfg.dataURL, "https://opt.example")
  assert.equal(cfg.failMode, "closed")
  assert.equal(cfg.timeoutMs, 1500)
  assert.equal(cfg.transformAction, "deny")
})

test("managed system file locks api_key, data_url and fail_mode", () => {
  const cfg = loadConfig({
    env: {
      TRUSTGUARD_OPENCODE_CONFIG: "/u",
      TRUSTGUARD_OPENCODE_SYSTEM_CONFIG: "/s",
      TRUSTGUARD_API_KEY: "tgk_dev",
      TRUSTGUARD_DATA_URL: "http://evil",
      TRUSTGUARD_FAIL_MODE: "open",
      TRUSTGUARD_TIMEOUT_MS: "900",
    },
    readFile: files({ "/s": { api_key: "tgk_org", data_url: "https://org.example", fail_mode: "closed" } }),
  })
  assert.equal(cfg.managed, true)
  assert.equal(cfg.apiKey, "tgk_org")
  assert.equal(cfg.dataURL, "https://org.example")
  assert.equal(cfg.failMode, "closed")
  assert.equal(cfg.timeoutMs, 900, "soft prefs still layer")
})

test("invalid values fall back to defaults", () => {
  const cfg = loadConfig({
    env: { TRUSTGUARD_OPENCODE_CONFIG: "/u", TRUSTGUARD_OPENCODE_SYSTEM_CONFIG: "/s", TRUSTGUARD_FAIL_MODE: "maybe", TRUSTGUARD_TIMEOUT_MS: "-3", TRUSTGUARD_TRANSFORM_ACTION: "x" },
    readFile: () => undefined,
  })
  assert.equal(cfg.failMode, "open")
  assert.equal(cfg.timeoutMs, 5000)
  assert.equal(cfg.transformAction, "ask")
})
