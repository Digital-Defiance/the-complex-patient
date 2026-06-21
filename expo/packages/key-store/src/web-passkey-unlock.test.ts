import { describe, expect, it } from 'vitest';
import { wrapKey } from '@complex-patient/crypto-engine';
import { unwrapKekWithPrfKey, wrapKekWithPrfKey } from './web-passkey-unlock';

describe('web passkey KEK wrap', () => {
  it('round-trips KEK bytes with a PRF output', async () => {
    const kek = wrapKey(new Uint8Array(32).fill(9));
    const prfOutput = new Uint8Array(32).fill(7).buffer;

    const wrapped = await wrapKekWithPrfKey(prfOutput, kek);
    const restored = await unwrapKekWithPrfKey(prfOutput, wrapped);

    expect((restored._inner as Uint8Array).slice()).toEqual(
      (kek._inner as Uint8Array).slice(),
    );
  });
});
