import { describe, it, expect, beforeAll } from 'vitest';
import { rpc, TransactionBuilder, Keypair, nativeToScVal, Contract, Account } from '@stellar/stellar-sdk';
import { buildPreview } from '../../src/preview';
import fs from 'fs';
import path from 'path';

describe('Live Testnet Integration', () => {
    let testnetConfig: any = null;
    let server: rpc.Server;

    beforeAll(() => {
        try {
            const configPath = path.join(__dirname, '../fixtures/testnet.json');
            if (fs.existsSync(configPath)) {
                testnetConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
                server = new rpc.Server(testnetConfig.rpcUrl);
            }
        } catch (e) {
            console.warn('Could not load testnet.json, skipping live integration tests');
        }
    });

    it('simulates a transfer_auth and decodes properly', async () => {
        if (!testnetConfig) {
            console.log('Skipping live testnet test, no secrets available');
            return;
        }

        const admin = Keypair.fromSecret(testnetConfig.adminSecret);
        const contract = new Contract(testnetConfig.contractId);
        
        const accInfo = await server.getAccount(admin.publicKey());
        const source = new Account(accInfo.accountId(), accInfo.sequenceNumber());
        const toUser = Keypair.random();

        const tx = new TransactionBuilder(source, { fee: '10000', networkPassphrase: testnetConfig.networkPassphrase })
            .addOperation(contract.call('transfer_auth', 
               nativeToScVal(admin.publicKey(), { type: 'address' }), 
               nativeToScVal(toUser.publicKey(), { type: 'address' }), 
               nativeToScVal(500, { type: 'i128' })))
            .setTimeout(300)
            .build();

        const sim = await server.simulateTransaction(tx);
        
        const preview = await buildPreview({
            xdr: tx.toXDR(),
            rpcUrl: testnetConfig.rpcUrl,
            networkPassphrase: testnetConfig.networkPassphrase,
            signerAddress: admin.publicKey()
        });
        if (preview.simulation.status === 'skipped') {
           console.log(preview.warnings);
        }
        expect(preview.simulation.status).toBe('success');
        expect(preview.effects.length).toBeGreaterThanOrEqual(0);
        // We expect require_auth from the admin
        const hasAuth = preview.auth.some(a => a.credentials.type === 'source-account' || (a.credentials as any).address === admin.publicKey());
        expect(hasAuth).toBe(true);
    }, 15000); // 15s timeout
});
