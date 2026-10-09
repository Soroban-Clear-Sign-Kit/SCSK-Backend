import { ClearSignPreview, Intent, AuthEntry, Invocation, BalanceDelta } from './types.js';
import { rpc } from '@stellar/stellar-sdk';
import { SimulationResult } from './simulate.js';
import { WarningCode, WARNING_SEVERITY } from './errors.js';
import { parseEnvelope } from './envelope.js';
import { decodeInvocation } from './invocation.js';
import { decodeAuthEntries } from './auth.js';
import { simulateTransaction } from './simulate.js';
import { extractTokenEffects } from './effects.js';
import { resolveTokenMetadata } from './tokens.js';
import { verifyIntent } from './intent.js';
import { computeRisk } from './risk.js';
import { sanitizeRecursive } from './sanitize.js';
import { generateSummary } from './summary.js';
import { LocaleStrings } from './locales/en.js';

export interface BuildPreviewInput {
  xdr: string;
  rpcUrl: string;
  networkPassphrase: string;
  signerAddress?: string;
  intent?: Intent;
  specs?: Record<string, Buffer | Uint8Array>;
  options?: {
    minAuthValidityLedgers?: number;
    feeWarningMultiplier?: number;
    rpcTimeoutMs?: number;
    debug?: boolean;
    localeStrings?: LocaleStrings;
  };
}

export async function buildPreview(input: BuildPreviewInput): Promise<ClearSignPreview> {
  const warnings: { code: WarningCode; message: string; path?: string; severity: 'review'|'blocked' }[] = [];
  
  const addWarning = (warns: { code: WarningCode; message: string; path?: string }[]) => {
     for (const w of warns) {
        warnings.push({ ...w, severity: w.code === 'INTERNAL_ERROR' ? 'blocked' : 'review' }); // Risk will map properly, we'll fix severity in risk.ts or here.
        // Actually WARNING_SEVERITY should be imported.
     }
  };

  try {
     const server = new rpc.Server(input.rpcUrl, { allowHttp: input.rpcUrl.startsWith('http://') });
     let networkVerified = false;
     let rpcNetwork: rpc.Api.GetNetworkResponse;
     try {
       rpcNetwork = await server.getNetwork();
       if (rpcNetwork.passphrase && rpcNetwork.passphrase !== input.networkPassphrase) {
          addWarning([{ code: 'NETWORK_MISMATCH', message: 'RPC network does not match configured network' }]);
          return {
             version: 1,
             risk: 'blocked',
             warnings: warnings.map(w => ({ ...w, severity: 'blocked' })),
             network: { passphrase: input.networkPassphrase, verified: false },
             envelope: { source: '', sequence: '', fee: '', operations: [] },
             auth: [],
             simulation: { status: 'skipped' },
             effects: [],
             summary: [],
             raw: { xdr: input.xdr }
          };
       } else if (rpcNetwork.passphrase === input.networkPassphrase) {
          networkVerified = true;
       }
     } catch(e) {
       // ignore if getNetwork fails, rely on simulation
     }

     const envResult = parseEnvelope(input.xdr, input.networkPassphrase);
     if (!envResult.success) {
        addWarning([envResult.error]);
        return {
           version: 1,
           risk: 'blocked',
           warnings: warnings.map(w => ({ ...w, severity: 'blocked' })),
           network: { passphrase: input.networkPassphrase, verified: false },
           envelope: { source: '', sequence: '', fee: '', operations: [] },
           auth: [],
           simulation: { status: 'skipped' },
           effects: [],
           summary: [],
           raw: { xdr: input.xdr }
        };
     }
     
     addWarning(envResult.warnings);

     if (envResult.warnings.some(w => w.code === 'NETWORK_MISMATCH')) {
        return {
           version: 1,
           risk: 'blocked',
           warnings: warnings.map(w => ({ ...w, severity: 'blocked' })),
           network: { passphrase: input.networkPassphrase, verified: false },
           envelope: { source: '', sequence: '', fee: '', operations: [] },
           auth: [],
           simulation: { status: 'skipped' },
           effects: [],
           summary: [],
           raw: { xdr: input.xdr }
        };
     }

     const innerTx = envResult.innerTransaction;
     const tx = innerTx; // For `simulateTransaction` which accepts Transaction or FeeBumpTransaction, wait simulateTransaction accepts FeeBumpTransaction directly? Yes but actually innerTx is enough to simulate. Wait, if it's a fee bump, simulateTransaction accepts fee bump but innerTransaction is passed. `simulateTransaction` handles it.
     
     let invocation: Invocation | undefined;
     const op = innerTx.operations[0];
     if (op) {
        const invOpts: any = { networkPassphrase: input.networkPassphrase, rpcUrl: input.rpcUrl, specs: input.specs };
        Object.keys(invOpts).forEach(k => invOpts[k] === undefined && delete invOpts[k]);
        const invResult = await decodeInvocation(op, invOpts);
        invocation = invResult.invocation;
        addWarning(invResult.warnings);
     }

     let simulation: SimulationResult = { status: 'skipped', warnings: [] };
     let latestLedger = 0;
     let effects: BalanceDelta[] = [];
     let auth: AuthEntry[] = [];
     
     const hasInvoke = innerTx.operations.some(o => o.type === 'invokeHostFunction');

     if (hasInvoke) {
         const simOpts: any = {
            rpcUrl: input.rpcUrl,
            networkPassphrase: input.networkPassphrase,
            feeWarningMultiplier: input.options?.feeWarningMultiplier,
            specs: input.specs
         };
         Object.keys(simOpts).forEach(k => simOpts[k] === undefined && delete simOpts[k]);
         
         simulation = await simulateTransaction(tx, simOpts);
         addWarning(simulation.warnings);
     }
     
     if (simulation.latestLedger) {
        latestLedger = simulation.latestLedger;
     }
     
     if (!latestLedger) {
        try {
            const server = new rpc.Server(input.rpcUrl, { allowHttp: input.rpcUrl.startsWith('http://') });
            const info = await server.getLatestLedger();
            latestLedger = info.sequence;
        } catch (e) {
            // fallback
        }
     }

     if (simulation.status === 'success') {
        const effResult = extractTokenEffects(simulation.events);
        effects = effResult.effects;
        addWarning(effResult.warnings);

        const metaResult = await resolveTokenMetadata(effects, { rpcUrl: input.rpcUrl, networkPassphrase: input.networkPassphrase, sourceAccount: tx.source });
        addWarning(metaResult.warnings);
     }

     // Auth
     let authXdr = simulation.auth || [];
     if (authXdr.length === 0) {
        for (const op of innerTx.operations) {
           if (op.type === 'invokeHostFunction' && (op as any).auth) {
               authXdr = authXdr.concat((op as any).auth);
           }
        }
     }
     const authOpts: any = {
        rpcUrl: input.rpcUrl,
        networkPassphrase: input.networkPassphrase,
        minAuthValidityLedgers: input.options?.minAuthValidityLedgers,
        signerAddress: input.signerAddress,
        topLevelContractId: invocation?.contractId,
        specs: input.specs
     };
     Object.keys(authOpts).forEach(k => authOpts[k] === undefined && delete authOpts[k]);
     
     const authResult = await decodeAuthEntries(authXdr, latestLedger, authOpts);
     auth = authResult.auth;
     addWarning(authResult.warnings);

     // Intent
     const intentResult = verifyIntent(input.intent, invocation, auth, effects, input.signerAddress);
     addWarning(intentResult.warnings);

     const summary = generateSummary(invocation, auth, effects, simulation, input.signerAddress, input.options?.localeStrings);

     // Fix severities
     for (const w of warnings) {
        w.severity = WARNING_SEVERITY[w.code];
     }

     const risk = computeRisk(warnings);

     const preview = {
        version: 1 as const,
        risk,
        warnings: warnings.map(w => ({ ...w, severity: w.severity || 'blocked' })), // wait, dynamic import is async... I should import statically
        network: { passphrase: input.networkPassphrase, verified: networkVerified && envResult.warnings.every(w => w.code !== 'NETWORK_MISMATCH') },
        envelope: {
           source: tx.source,
           sequence: tx.sequence,
           fee: tx.fee,
           operations: innerTx.operations.map(o => ({ type: o.type, decoded: o.type === 'invokeHostFunction' }))
        },
        invocation,
        auth,
        simulation: {
           status: simulation.status,
           minResourceFee: simulation.minResourceFee,
           error: simulation.error,
           returnValue: simulation.returnValue,
           latestLedger: simulation.latestLedger
        },
        effects,
        summary,
        raw: { xdr: input.xdr }
     };

     return sanitizeRecursive(preview) as ClearSignPreview;

  } catch (err: any) {
     console.error('INTERNAL_ERROR Stack:', err.stack);
     const w = { code: 'INTERNAL_ERROR' as WarningCode, message: err.message || 'Unknown error', severity: 'blocked' as const };
     return {
        version: 1,
        risk: 'blocked',
        warnings: [w],
        network: { passphrase: input.networkPassphrase, verified: false },
        envelope: { source: '', sequence: '', fee: '', operations: [] },
        auth: [],
        simulation: { status: 'skipped' },
        effects: [],
        summary: [],
        raw: { xdr: input.xdr } // In PDF it says: "Log nothing that contains the XDR unless debug is enabled by the caller." We don't log, we return it.
     };
  }
}
