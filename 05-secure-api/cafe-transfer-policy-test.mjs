import assert from "node:assert/strict";
import { cafeRosterMatchLabel, evaluateCafeRoster } from "./src/cafe-transfer-policy.mjs";

const rows = [
  { nickname_norm: "앤", id_prefix: "abcd" },
  { nickname_norm: "키다리", id_prefix: "xy" },
  { nickname_norm: "작은아씨들", id_prefix: "same" },
  { nickname_norm: "다른회원", id_prefix: "same" },
];

assert.deepEqual(
  evaluateCafeRoster({ rows, campaign: "anne", cafeNickname: "앤", naverId: "abcd1234" }),
  { rosterMatch: "exact", autoOk: true, rosterKey: "anne:앤" },
);

assert.deepEqual(
  evaluateCafeRoster({ rows, campaign: "anne", cafeNickname: "변경된별명", naverId: "abcd1234" }),
  { rosterMatch: "id_unique", autoOk: true, rosterKey: "anne:앤" },
);

assert.deepEqual(
  evaluateCafeRoster({ rows, campaign: "kidari", cafeNickname: "변경된별명", naverId: "xy9999" }),
  { rosterMatch: "id_short", autoOk: false, rosterKey: "kidari:키다리" },
);

assert.deepEqual(
  evaluateCafeRoster({ rows, campaign: "littlewomen", cafeNickname: "작은아씨들", naverId: "same9999" }),
  { rosterMatch: "ambiguous", autoOk: false, rosterKey: "littlewomen:작은아씨들" },
);

assert.deepEqual(
  evaluateCafeRoster({ rows, campaign: "anne", cafeNickname: "앤", naverId: "unknown" }),
  { rosterMatch: "nickname_only", autoOk: false, rosterKey: null },
);

assert.deepEqual(
  evaluateCafeRoster({ rows, campaign: "anne", cafeNickname: "없음", naverId: "unknown" }),
  { rosterMatch: "none", autoOk: false, rosterKey: null },
);

assert.equal(cafeRosterMatchLabel("id_unique"), "ID 단일 일치 ✅");
assert.match(cafeRosterMatchLabel("ambiguous"), /수동 확인/);

console.log("cafe-transfer-policy-test: ok");
