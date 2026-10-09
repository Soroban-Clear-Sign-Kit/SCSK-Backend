export const en = {
  deployContract: "Deploy contract",
  uploadContractCode: "Upload contract code",
  readsBalance: (account: string, token: string) =>
    `Reads the balance of ${account} on token ${token}`,
  readsAllowance: (account: string, spender: string, token: string) =>
    `Reads the allowance from ${account} for spender ${spender} on token ${token}`,
  readsDecimals: (token: string) => `Reads the decimals of token ${token}`,
  readsName: (token: string) => `Reads the name of token ${token}`,
  readsSymbol: (token: string) => `Reads the symbol of token ${token}`,
  callFunction: (fn: string, contract: string) =>
    `Call ${fn} on contract ${contract}`,
  spendToken: (amount: string, symbol: string) =>
    `You spend ${amount} ${symbol}`,
  receiveToken: (amount: string, symbol: string) =>
    `You receive ${amount} ${symbol}`,
  authorizeCalls: (calls: number, contracts: number) =>
    `You authorize ${calls} call${calls === 1 ? "" : "s"} across ${contracts} contract${contracts === 1 ? "" : "s"}`,
  simulationFailed: (error: string) => `Simulation failed: ${error}`,
  simulationUnavailable:
    "Simulation unavailable. The summary may be incomplete.",
};

export type LocaleStrings = typeof en;
