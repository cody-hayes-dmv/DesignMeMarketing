import test from "node:test";
import assert from "node:assert/strict";
import {
  generateDomainVerificationToken,
  getDomainVerificationInstructions,
  normalizeDomainHost,
} from "./domainProvisioning.js";

test("normalizes valid custom domains", () => {
  assert.equal(normalizeDomainHost("Portal.Example.com"), "portal.example.com");
  assert.equal(normalizeDomainHost("https://portal.example.com/path"), "portal.example.com");
  assert.equal(normalizeDomainHost("portal.example.com."), "portal.example.com");
});

test("rejects invalid custom domains", () => {
  assert.equal(normalizeDomainHost("localhost"), null);
  assert.equal(normalizeDomainHost("bad domain.com"), null);
  assert.equal(normalizeDomainHost("https://"), null);
  assert.equal(normalizeDomainHost("example"), null);
});

test("creates deterministic DNS instruction shape", () => {
  const instructions = getDomainVerificationInstructions("portal.example.com", "abc123");
  assert.equal(instructions.txtHost, "_ymd-verify.portal.example.com");
  assert.equal(instructions.txtValue, "ymd-verification=abc123");
  assert.equal(instructions.cnameHost, "_ymd-ssl.portal.example.com");
  assert.ok(instructions.cnameTarget.length > 0);
});

test("verification tokens are random-looking hex strings", () => {
  const tokenA = generateDomainVerificationToken();
  const tokenB = generateDomainVerificationToken();
  assert.match(tokenA, /^[a-f0-9]{32}$/);
  assert.match(tokenB, /^[a-f0-9]{32}$/);
  assert.notEqual(tokenA, tokenB);
});

