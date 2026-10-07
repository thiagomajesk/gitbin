import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
export const hashText = (text: string): string => bytesToHex(sha256(utf8ToBytes(text)));
