import { Invocation, AuthEntry, BalanceDelta } from './types.js';
import { SimulationResult } from './simulate.js';
export function generateSummary(
  invocation: Invocation | undefined,
  auth: AuthEntry[],
  effects: BalanceDelta[],
  simulation: SimulationResult,
  signerAddress?: string
): string[] {
  const summary: string[] = [];

  if (invocation) {
    if (invocation.contractId === 'Deploy') {
       summary.push('Deploy contract');
    } else if (invocation.contractId === 'Upload') {
       summary.push('Upload contract code');
    } else {
       const fn = invocation.functionName;
       if (fn === 'balance' && invocation.args.length > 0 && invocation.args[0].value.kind === 'address') {
         summary.push(`Reads the balance of ${invocation.args[0].value.value} on token ${invocation.contractId}`);
       } else if (fn === 'allowance' && invocation.args.length > 1 && invocation.args[0].value.kind === 'address' && invocation.args[1].value.kind === 'address') {
         summary.push(`Reads the allowance from ${invocation.args[0].value.value} for spender ${invocation.args[1].value.value} on token ${invocation.contractId}`);
       } else if (fn === 'decimals') {
         summary.push(`Reads the decimals of token ${invocation.contractId}`);
       } else if (fn === 'name') {
         summary.push(`Reads the name of token ${invocation.contractId}`);
       } else if (fn === 'symbol') {
         summary.push(`Reads the symbol of token ${invocation.contractId}`);
       } else {
         summary.push(`Call ${fn} on contract ${invocation.contractId}`);
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
            summary.push(`You spend ${amount} ${symbol}`);
         } else {
            summary.push(`You receive ${amount} ${symbol}`);
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
      summary.push(`You authorize ${callCount} call${callCount === 1 ? '' : 's'} across ${contractSet.size} contract${contractSet.size === 1 ? '' : 's'}`);
    }
  }

  if (simulation.status === 'failed') {
    summary.push(`Simulation failed: ${simulation.error || 'Unknown error'}`);
  } else if (simulation.status === 'unavailable') {
    summary.push('Simulation unavailable');
  }

  return summary;
}
