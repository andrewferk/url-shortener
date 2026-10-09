import type { ShortCodeGenerator } from "./ports.ts";
import { BASE62_ALPHABET, GENERATED_LENGTH } from "./short-code.ts";

export class RandomShortCodeGenerator implements ShortCodeGenerator {
  generate(): string {
    let shortCode = "";
    while (shortCode.length < GENERATED_LENGTH) {
      for (const byte of crypto.getRandomValues(new Uint8Array(GENERATED_LENGTH * 2))) {
        // 248 is the largest multiple of 62 a byte holds; a higher byte would skew the draw.
        if (byte < UNBIASED_BYTE_LIMIT && shortCode.length < GENERATED_LENGTH) {
          shortCode += BASE62_ALPHABET.charAt(byte % 62);
        }
      }
    }
    return shortCode;
  }
}

const UNBIASED_BYTE_LIMIT = 248;
