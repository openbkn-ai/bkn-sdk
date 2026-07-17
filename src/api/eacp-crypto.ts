// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * EACP password crypto. The UserManagement / EACP `modifypassword` endpoint
 * wants the password RSA-PKCS1-encrypted with a fixed 1024-bit public key, then
 * base64-encoded. That keypair is hard-coded in the ShareServer C++ binary
 * (`ncEACHttpServerUtil::RSADecrypt`) and shipped to every customer — it is NOT
 * a secret, just the agreed transport encoding. We embed the keypair and derive
 * the public half so the CLI can encrypt without a round-trip.
 */
import {
  constants,
  type KeyObject,
  createPrivateKey,
  createPublicKey,
  publicEncrypt,
} from "node:crypto";

const EACP_MODIFYPWD_PRIVATE_KEY_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIICXgIBAAKBgQDB2fhLla9rMx+6LWTXajnK11Kdp520s1Q+TfPfIXI/7G9+L2YC
4RA3M5rgRi32s5+UFQ/CVqUFqMqVuzaZ4lw/uEdk1qHcP0g6LB3E9wkl2FclFR0M
+/HrWmxPoON+0y/tFQxxfNgsUodFzbdh0XY1rIVUIbPLvufUBbLKXHDPpwIDAQAB
AoGBALCM/H6ajXFs1nCR903aCVicUzoS9qckzI0SIhIOPCfMBp8+PAJTSJl9/ohU
YnhVj/kmVXwBvboxyJAmOcxdRPWL7iTk5nA1oiVXMer3Wby+tRg/ls91xQbJLVv3
oGSt7q0CXxJpRH2oYkVVlMMlZUwKz3ovHiLKAnhw+jEsdL2BAkEA9hA97yyeA2eq
f9dMu/ici99R3WJRRtk4NEI4WShtWPyziDg48d3SOzYmhEJjPuOo3g1ze01os70P
ApE7d0qcyQJBAMmt+FR8h5MwxPQPAzjh/fTuTttvUfBeMiUDrIycK1I/L96lH+fU
i4Nu+7TPOzExnPeGO5UJbZxrpIEUB7Zs8O8CQQCLzTCTGiNwxc5eMgH77kVrRudp
Q7nv6ex/7Hu9VDXEUFbkdyULbj9KuvppPJrMmWZROw04qgNp02mayM8jeLXZAkEA
o+PM/pMn9TPXiWE9xBbaMhUKXgXLd2KEq1GeAbHS/oY8l1hmYhV1vjwNLbSNrH9d
yEP73TQJL+jFiONHFTbYXwJAU03Xgum5mLIkX/02LpOrz2QCdfX1IMJk2iKi9osV
KqfbvHsF0+GvFGg18/FXStG9Kr4TjqLsygQJT76/MnMluw==
-----END RSA PRIVATE KEY-----`;

let cachedKey: KeyObject | undefined;
function publicKey(): KeyObject {
  if (!cachedKey) cachedKey = createPublicKey(createPrivateKey(EACP_MODIFYPWD_PRIVATE_KEY_PEM));
  return cachedKey;
}

/** RSA-PKCS1 encrypt a password and base64-encode it for EACP/UserManagement. */
export function encryptModifyPwd(plain: string): string {
  const buf = publicEncrypt(
    { key: publicKey(), padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(plain, "utf8"),
  );
  return buf.toString("base64");
}
