// Copyright (c) 2026 OpenBKN. All rights reserved.
// Licensed under the Apache License, Version 2.0. See the LICENSE file in the project root.

/**
 * EACP password crypto. The UserManagement / EACP `modifypassword` endpoint
 * wants the password RSA-PKCS1-encrypted with a fixed 1024-bit public key, then
 * base64-encoded. That keypair is hard-coded in the ShareServer C++ binary
 * (`ncEACHttpServerUtil::RSADecrypt`) and shipped to every customer — it is NOT
 * a secret, just the agreed transport encoding. Only the public half is embedded
 * here; the SDK never decrypts.
 *
 * The 1024-bit modulus and PKCS#1 v1.5 padding are both below current guidance,
 * but they are dictated by the server's fixed decrypt path and cannot be changed
 * client-side.
 */
import { constants, type KeyObject, createPublicKey, publicEncrypt } from "node:crypto";

const EACP_MODIFYPWD_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDB2fhLla9rMx+6LWTXajnK11Kd
p520s1Q+TfPfIXI/7G9+L2YC4RA3M5rgRi32s5+UFQ/CVqUFqMqVuzaZ4lw/uEdk
1qHcP0g6LB3E9wkl2FclFR0M+/HrWmxPoON+0y/tFQxxfNgsUodFzbdh0XY1rIVU
IbPLvufUBbLKXHDPpwIDAQAB
-----END PUBLIC KEY-----`;

let cachedKey: KeyObject | undefined;
function publicKey(): KeyObject {
  if (!cachedKey) cachedKey = createPublicKey(EACP_MODIFYPWD_PUBLIC_KEY_PEM);
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
