import { generateKeyPairSync } from "node:crypto";

const { privateKey } = generateKeyPairSync("ed25519");
const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");

process.stdout.write(`ONECOMPUTER_OPENVTC_EXECUTOR_PRIVATE_KEY_B64=${pkcs8}\n`);
