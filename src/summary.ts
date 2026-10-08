import { Invocation, AuthEntry, BalanceDelta } from './types.js';
import { SimulationResult } from './simulate.js';
import { en, LocaleStrings } from './locales/en.js';

export function generateSummary(
  invocation: Invocation | undefined,
  auth: AuthEntry[],
  effects: BalanceDelta[],
  simulation: SimulationResult,
  signerAddress?: string,
  locales: LocaleStrings = en
): string[] {
  const summary: string[] = [];

  if (invocation) {
    if (invocation.contractId === 'Deploy') {
       summary.push(locales.deployContract);
    } else if (invocation.contractId === 'Upload') {
       summary.push(locales.uploadContractCode);
    } else {
       const fn = invocation.functionName;
       const arg0 = invocation.args[0];
       const arg1 = invocation.args[1];
       if (fn === 'balance' && arg0 && arg0.value.kind === 'address') {
         summary.push(locales.readsBalance(arg0.value.value, invocation.contractId));
       } else if (fn === 'allowance' && arg0 && arg1 && arg0.value.kind === 'address' && arg1.value.kind === 'address') {
         summary.push(locales.readsAllowance(arg0.value.value, arg1.value.value, invocation.contractId));
       } else if (fn === 'decimals') {
         summary.push(locales.readsDecimals(invocation.contractId));
       } else if (fn === 'name') {
         summary.push(locales.readsName(invocation.contractId));
       } else if (fn === 'symbol') {
         summary.push(locales.readsSymbol(invocation.contractId));
       } else {
         summary.push(locales.callFunction(fn, invocation.contractId));
       }
    }
  }

  if (signerAddress) {
    for (const effect of effects) {
      if (effect.account === signerAddress) {
         const isNegative = effect.delta.startsWith('-');
         const amount = effect.formatted || effect.delta.replace('-', '');
         const symbol = effect.symbol || effect.tokenContractId;
         
         if (isNegative) {
            summary.push(locales.spendToken(amount, symbol));
         } else {
            summary.push(locales.receiveToken(amount, symbol));
         }
      }
    }
  }

  if (auth && auth.length > 0) {
    let callCount = 0;
    const contractSet = new Set<string>();
    
    for (const entry of auth) {
       const walk = (node: any) => {
          if (node.kind === 'contract-fn') {
             callCount++;
             if (node.contractId) contractSet.add(node.contractId);
          }
          for (const child of node.children || []) walk(child);
       };
       walk(entry.root);
    }
    
    if (callCount > 0) {
      summary.push(locales.authorizeCalls(callCount, contractSet.size));
    }
  }

  if (simulation.status === 'failed') {
    summary.push(locales.simulationFailed(simulation.error || 'Unknown error'));
  } else if (simulation.status === 'unavailable') {
    summary.push(locales.simulationUnavailable);
  }

  return summary;
}
