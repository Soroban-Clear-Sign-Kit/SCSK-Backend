import {
  TransactionBuilder,
  Keypair,
  Contract,
  nativeToScVal,
  Account,
  rpc,
} from "@stellar/stellar-sdk";

async function main() {
  const admin = Keypair.random();
  const toUser = Keypair.random();
  const contract = new Contract(
    "CBCPBJRLCRZZ3C4EHZPU4WWCYJVIP24XEKRQQKF2CDK7PKAUHEHQBXWL",
  );

  const tx = new TransactionBuilder(new Account(admin.publicKey(), "0"), {
    fee: "10000",
    networkPassphrase: "Test SDF Network ; September 2015",
  })
    .addOperation(
      contract.call(
        "transfer_auth",
        nativeToScVal(admin.publicKey(), { type: "address" }),
        nativeToScVal(toUser.publicKey(), { type: "address" }),
        nativeToScVal(500, { type: "i128" }),
      ),
    )
    .setTimeout(300)
    .build();

  const server = new rpc.Server("https://soroban-testnet.stellar.org");
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationSuccess(sim)) {
    console.dir(sim.events[0], { depth: 4 });
  } else {
    console.log("sim failed:", sim);
  }
}
main().catch(console.error);
