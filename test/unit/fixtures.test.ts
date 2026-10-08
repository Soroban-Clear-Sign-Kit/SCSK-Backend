import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseEnvelope } from '../../src/envelope';
import { decodeInvocation } from '../../src/invocation';

describe('Mainnet Complex Fixtures', () => {
    const fixturesDir = path.join(__dirname, '../fixtures');
    const fixtures = fs.readdirSync(fixturesDir).filter(f => f.startsWith('mainnet_complex_') && f.endsWith('.json'));

    for (const fixtureFile of fixtures) {
        it(`parses and decodes ${fixtureFile}`, async () => {
            const raw = fs.readFileSync(path.join(fixturesDir, fixtureFile), 'utf8');
            const data = JSON.parse(raw);
            
            expect(data.xdr).toBeDefined();

            // 1. Parse envelope
            const parsed = parseEnvelope(data.xdr, 'Public Global Stellar Network ; September 2015');
            expect(parsed.success).toBe(true);
            if (!parsed.success) return; // For TS narrow

            expect(parsed.envelope.source).toBeDefined();
            expect(parsed.warnings).toBeDefined();

            // 2. Decode invocation
            if (parsed.innerTransaction.operations.length > 0) {
                for (const op of parsed.innerTransaction.operations) {
                    if (op.type === 'invokeHostFunction') {
                        const decoded = decodeInvocation((op as any).invokeHostFunctionOp || (op as any).func || op.hostFunction);
                        expect(decoded).toBeDefined();
                    }
                }
            }
        });
    }
});
