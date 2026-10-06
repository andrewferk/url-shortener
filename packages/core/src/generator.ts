import type { ShortCodeGenerator } from "./ports.ts";
import { BASE62_ALPHABET, GENERATED_LENGTH } from "./short-code.ts";

/**
 * Draws 7 base62 characters from the platform's CSPRNG (ADR 0002). Web Crypto
 * exists in Workers, Node and browsers alike, so this is the production
 * generator everywhere. Each character is drawn without modulo bias.
 */
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
